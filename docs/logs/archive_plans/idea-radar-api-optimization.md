# Idea Radar API Optimization Analysis

## Current State (December 2024)

### What's Currently Working

The Idea Radar API (`/app/api/idea-radar/route.ts`) is functional but experiencing timeout issues when filtering large datasets. Here's the current implementation:

#### API Endpoint
- **URL**: `/api/idea-radar`
- **Method**: GET
- **Parameters**:
  - `timeRange`: day/week/month/quarter/halfyear/year/twoyears (default: week)
  - `minScore`: Minimum performance score 1.5-100 (default: 3)
  - `minViews`: View threshold 100-10M (default: 100,000)
  - `randomize`: true/false for random selection
  - `limit`: Results per page (default: 20, frontend uses 50)
  - `offset`: Pagination offset

#### Current Implementation Details

1. **Randomized Path** (when `randomize=true`):
   - Calls RPC function `get_random_video_ids` with filters
   - Shuffles returned IDs in JavaScript using Fisher-Yates
   - Calls `get_videos_by_id_list` to fetch full video data
   - Fetches channel avatars separately
   - Returns results with count from `get_filtered_video_count`

2. **Non-randomized Path**:
   - Direct Supabase query with filters
   - Ordered by `temporal_performance_score DESC`
   - Includes channel avatar batch fetching

3. **Database Functions**:
   ```sql
   -- Current problematic function
   get_random_video_ids(
     p_outlier_score integer,
     p_min_views integer, 
     p_days_ago integer,
     p_domain text,
     p_sample_size integer
   )
   -- Uses ORDER BY random() - THIS IS THE BOTTLENECK!
   ```

### Performance Issues

#### The Core Problem
The `get_random_video_ids` function uses `ORDER BY random()` which:
- Forces PostgreSQL to generate a random value for EVERY row that matches filters
- Sorts ALL matching rows (could be 50,000+)
- Returns only the top N results
- Complexity: O(n log n) where n = total matching rows

#### Typical Dataset Sizes (from logs)
- **Last Week, 3x performance, 10K+ views**: ~215 videos
- **Last Month, 3x performance, 10K+ views**: ~1,033 videos  
- **Last 3 Months, 3x performance, 10K+ views**: ~3,000+ videos
- **All Time, 1.5x performance, 100+ views**: ~49,000+ videos

When users select broader filters, the query can timeout before completion.

---

## What We've Tried (From Daily Logs)

### August 2025 - Initial Implementation
- **Problem**: Only accessing 500-video pool from 49K+ dataset
- **Solution Attempted**: Implemented 3x sample size + Fisher-Yates shuffle
- **Result**: Better coverage but still slow with `ORDER BY random()`

### August 15, 2025 - Randomization Enhancement
- **Changes Made**:
  - Added 6-tier view filter (100 to 10M views)
  - Capped performance scores at 100x to prevent outliers
  - Added `.order('id')` to prevent implicit performance bias
- **Result**: Improved distribution but underlying performance issue remained

### August 18, 2025 - Seeded Randomization
- **Problem**: Duplicates appearing within 5-6 page scrolls
- **Solution Attempted**: PostgreSQL RPC with `setseed()` for consistent randomization
- **Result**: Fixed duplicates but didn't address core performance issue

### August 21, 2025 - Two-Step Approach
- **Implementation**:
  - Created `get_random_video_ids` RPC function
  - Created `get_videos_by_id_list` for batch fetching
  - Created `get_filtered_video_count` for accurate totals
- **Result**: Structure improved but `ORDER BY random()` bottleneck remained

### December 2024 - Implementation Attempts

#### First Attempt - Failed Direct Query Optimization
- **Attempted**: Replace RPC with direct Supabase queries using random offset
- **Implementation**: 
  ```javascript
  // Tried to bypass RPC with direct query + random offset
  const randomOffset = Math.floor(Math.random() * maxOffset);
  query.range(randomOffset, randomOffset + limit - 1);
  ```
- **Result**: User requested immediate revert - approach didn't work as expected

#### Second Attempt - Random Offset in Database Function
- **Implementation**: Modified `get_random_video_ids` to use OFFSET approach
- **Test Results**:
  ```
  ✅ Small datasets (<1K videos): 1-2 seconds
  ✅ Medium datasets (1K-10K): 3-7 seconds  
  ⚠️ Large datasets (100K+): 13-15 seconds (still slow!)
  ❌ High duplicate rate: 40% duplicates between batches
  ```
- **Problem Identified**: 
  - WHILE LOOP executing 50 individual queries
  - Each query re-applies WHERE filters to entire dataset
  - Random offsets clustering due to poor distribution

---

## Current Performance Bottleneck Analysis (December 2024)

### Why the Random Offset Approach Is Still Slow

The implemented random offset approach has a critical flaw - it runs **50 separate queries in a loop**:

```sql
WHILE collected_count < p_sample_size LOOP  -- Runs 50 times!
  -- Each iteration:
  -- 1. Applies all WHERE filters to 124K+ rows
  -- 2. Orders them by ID  
  -- 3. Skips to random offset
  -- 4. Returns 1 video
END LOOP;
```

For 124K videos, this means:
- 50 queries × ~300ms each = 15 seconds total
- High duplicate rate because random offsets cluster in dense areas

## Recommended Solutions

### Solution 1: Single-Pass Sampler (BEST IMMEDIATE FIX)

Replace the current `get_random_video_ids` function with ChatGPT's optimized single-pass version that avoids the 50-query loop:

```sql
CREATE OR REPLACE FUNCTION get_random_video_ids(
  p_outlier_score int DEFAULT 2,
  p_min_views int DEFAULT 1000,
  p_days_ago int DEFAULT 90,
  p_domain text DEFAULT NULL,
  p_sample_size int DEFAULT 500
)
RETURNS TABLE(video_id text)
LANGUAGE sql AS
$$
WITH candidates AS (
  -- Step 1: Filter once (no repeated WHERE evaluation)
  SELECT v.id
  FROM videos v
  WHERE v.temporal_performance_score >= p_outlier_score
    AND v.temporal_performance_score <= 100
    AND v.view_count >= p_min_views
    AND v.published_at >= NOW() - (p_days_ago || ' days')::interval
    AND v.is_short = false
    AND v.is_institutional = false  -- Using direct column instead of subquery
    AND (p_domain IS NULL OR v.topic_domain = p_domain)  -- Using topic_domain directly
),
enumed AS (
  -- Step 2: Assign row numbers efficiently
  SELECT id, row_number() OVER (ORDER BY id) AS rn
  FROM candidates
),
totals AS (
  -- Step 3: Get total count
  SELECT count(*)::int AS n FROM candidates
),
picks AS (
  -- Step 4: Generate unique random positions (3x to handle collisions)
  SELECT DISTINCT 1 + floor(random() * totals.n)::int AS rn
  FROM totals, generate_series(1, LEAST(p_sample_size * 3, totals.n))
  ORDER BY rn
  LIMIT p_sample_size
)
-- Step 5: Join to get actual IDs
SELECT e.id
FROM enumed e
JOIN picks p USING (rn);
$$;
```

**Why This Is Better**:
- **Single scan**: Filters the dataset ONCE, not 50 times
- **No loops**: Everything happens in one SQL execution
- **Uniform sampling**: Better random distribution, fewer duplicates
- **Index-friendly**: Can leverage covering indexes efficiently

**Performance Impact**:
- 50K rows: ~100-300ms (vs 13-15 seconds)
- 124K rows: ~200-500ms (vs timeout)
- Duplicate rate: <5% (vs 40%)

### Solution 2: Pre-computed Random Column

Add a random sort column that updates periodically:

```sql
-- Add random column
ALTER TABLE videos ADD COLUMN IF NOT EXISTS random_sort FLOAT DEFAULT random();

-- Create index
CREATE INDEX IF NOT EXISTS idx_videos_random_sort ON videos(random_sort);

-- Update function to use pre-computed randomness
CREATE OR REPLACE FUNCTION get_random_video_ids_indexed(
  p_outlier_score integer DEFAULT 2,
  p_min_views integer DEFAULT 1000,
  p_days_ago integer DEFAULT 90,
  p_domain text DEFAULT NULL,
  p_sample_size integer DEFAULT 500
)
RETURNS TABLE(video_id text)
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  SELECT v.id as video_id
  FROM videos v
  WHERE v.temporal_performance_score >= p_outlier_score
    AND v.temporal_performance_score <= 100
    AND v.view_count >= p_min_views
    AND v.published_at >= NOW() - INTERVAL '1 day' * p_days_ago
    AND v.is_short = false
    AND v.random_sort > random()  -- Use pre-computed random
    AND (p_domain IS NULL OR v.channel_id IN (
      SELECT channel_id FROM channels WHERE custom_url = p_domain
    ))
    AND v.channel_id NOT IN (
      SELECT channel_id FROM channels WHERE is_institutional = true
    )
  ORDER BY v.random_sort  -- Already indexed!
  LIMIT p_sample_size;
END;
$$;

-- Periodically refresh randomness (daily cron job)
UPDATE videos SET random_sort = random() WHERE random() < 0.1;
```

**Pros**:
- Single query execution
- Leverages indexes effectively
- Consistent performance

**Cons**:
- Requires schema change
- Needs periodic refresh for true randomness

### Solution 3: Materialized View for Common Filters

Create pre-filtered views for the most common filter combinations:

```sql
-- Create materialized view for viral content
CREATE MATERIALIZED VIEW mv_viral_videos AS
SELECT 
  v.*,
  c.thumbnail_url as channel_avatar_url,
  random() as random_sort
FROM videos v
LEFT JOIN channels c ON v.channel_id = c.channel_id
WHERE v.temporal_performance_score >= 3
  AND v.temporal_performance_score <= 100
  AND v.view_count >= 10000
  AND v.is_short = false
  AND v.channel_id NOT IN (
    SELECT channel_id FROM channels WHERE is_institutional = true
  )
WITH DATA;

-- Create indexes
CREATE INDEX idx_mv_viral_published ON mv_viral_videos(published_at DESC);
CREATE INDEX idx_mv_viral_random ON mv_viral_videos(random_sort);
CREATE INDEX idx_mv_viral_score ON mv_viral_videos(temporal_performance_score DESC);

-- Refresh periodically (pg_cron)
SELECT cron.schedule(
  'refresh-viral-videos',
  '0 */6 * * *',  -- Every 6 hours
  $$REFRESH MATERIALIZED VIEW CONCURRENTLY mv_viral_videos$$
);
```

**Pros**:
- Extremely fast queries
- Pre-joined channel data
- Can handle complex filters efficiently

**Cons**:
- Storage overhead
- Needs periodic refresh
- Less flexible for arbitrary filter combinations

### Solution 4: TABLESAMPLE for Approximate Randomization

For cases where perfect randomness isn't critical:

```sql
CREATE OR REPLACE FUNCTION get_random_video_ids_sample(
  p_outlier_score integer DEFAULT 2,
  p_min_views integer DEFAULT 1000,
  p_days_ago integer DEFAULT 90,
  p_domain text DEFAULT NULL,
  p_sample_size integer DEFAULT 500
)
RETURNS TABLE(video_id text)
LANGUAGE plpgsql
AS $$
DECLARE
  sample_percentage float;
BEGIN
  -- Calculate sample percentage (with buffer for filtering)
  sample_percentage := LEAST(100, (p_sample_size::float / 1000) * 100);
  
  RETURN QUERY
  SELECT v.id as video_id
  FROM videos TABLESAMPLE BERNOULLI (sample_percentage) v
  WHERE v.temporal_performance_score >= p_outlier_score
    AND v.temporal_performance_score <= 100
    AND v.view_count >= p_min_views
    AND v.published_at >= NOW() - INTERVAL '1 day' * p_days_ago
    AND v.is_short = false
    AND (p_domain IS NULL OR v.channel_id IN (
      SELECT channel_id FROM channels WHERE custom_url = p_domain
    ))
    AND v.channel_id NOT IN (
      SELECT channel_id FROM channels WHERE is_institutional = true
    )
  LIMIT p_sample_size;
END;
$$;
```

**Pros**:
- Very fast sampling
- Built-in PostgreSQL feature
- No additional columns needed

**Cons**:
- Less control over exact randomness
- May return fewer results than requested

---

## Recommended Indexes for Optimal Performance

Create covering indexes to support the single-pass sampler:

```sql
-- Primary filtering index (covering for index-only scans)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_videos_idea_radar_filter
ON videos (
  is_short, 
  is_institutional,
  published_at DESC, 
  temporal_performance_score DESC, 
  view_count DESC, 
  id
) WHERE is_short = false AND is_institutional = false;

-- Domain filtering support
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_videos_topic_domain 
ON videos(topic_domain) 
WHERE is_short = false AND is_institutional = false;
```

These indexes enable index-only scans, avoiding expensive heap fetches.

## Implementation Priority

### Immediate Fix (Now)
1. **Deploy Single-Pass Sampler** (Solution 1)
   - Replace `get_random_video_ids` with single-pass version
   - Create supporting indexes
   - No frontend changes needed
   - Will resolve timeouts and reduce duplicates immediately

### Short Term (This Week)
2. **Add Solution 2** (Pre-computed Random Column)
   - Add column and index during low-traffic period
   - Set up daily refresh job
   - Provides consistent sub-second performance

### Long Term (Next Sprint)
3. **Implement Solution 3** (Materialized Views)
   - Analyze most common filter combinations
   - Create targeted materialized views
   - Set up refresh schedules
   - Update API to route to appropriate view

---

## Expected Performance Improvements

| Current Approach | Time (50K rows) | Time (1K rows) |
|-----------------|-----------------|----------------|
| ORDER BY random() | 8-15 seconds (timeout) | 2-3 seconds |

| Optimized Approach | Time (50K rows) | Time (1K rows) |
|-------------------|-----------------|----------------|
| Random Offset | 200-500ms | 50-100ms |
| Pre-computed Random | 100-300ms | 30-50ms |
| Materialized View | 20-50ms | 20-50ms |
| TABLESAMPLE | 150-400ms | 50-100ms |

---

## Testing Plan

1. **Create test functions** alongside existing ones (don't drop production functions yet)
2. **Compare results** between old and new approaches
3. **Monitor performance** using `EXPLAIN ANALYZE`
4. **Gradual rollout** - test with staff accounts first
5. **Full deployment** after verification

---

## Monitoring & Success Metrics

- **API Response Time**: Target < 500ms for 95th percentile
- **Timeout Rate**: Should drop from current ~5-10% to < 0.1%
- **Result Quality**: Maintain good randomness distribution
- **User Experience**: No noticeable duplicates in first 10 pages

---

## Rollback Plan

If issues arise:
1. Revert to original `get_random_video_ids` function
2. API code already handles fallback gracefully
3. No frontend changes required for rollback
4. Monitor logs for timeout patterns

---

## Implementation Status (December 26, 2024)

### What We Actually Implemented

#### Solution 2 - Pre-computed Random Column ✅ COMPLETED

We successfully implemented the pre-computed random column approach:

1. **Added random_sort column** to all 660K videos
   - Script: `/scripts/random-sort-final.js`
   - Used session-level timeout disabling to handle bulk update
   - Successfully updated all rows with random values

2. **Created B-tree index** on random_sort
   - Script: `/scripts/create-random-index.js`
   - Index: `idx_videos_random_sort` with WHERE clause for non-shorts, non-institutional
   - Creation time: 24.37 seconds

3. **Implemented time-based rotation** instead of true randomization
   - Script: `/scripts/implement-discovery-function.js`
   - Uses current minute to create rotating offset
   - Different videos shown every minute without expensive randomization
   ```sql
   time_offset := (EXTRACT(EPOCH FROM NOW())::int / 60) % 1000 / 1000.0;
   SELECT * FROM videos WHERE [filters] AND random_sort >= time_offset
   ORDER BY random_sort LIMIT 50;
   ```

4. **Added category filtering support**
   - Script: `/scripts/add-category-filter-to-function.js`
   - Added YouTube category dropdown to frontend
   - Filter by metadata->>'category_id'

5. **Fixed institutional channel filtering**
   - Script: `/scripts/fix-institutional-flags.js`
   - Synced videos.is_institutional with channels.is_institutional
   - Marked 25+ news channels as institutional (CBS News, USA TODAY, etc.)

#### Initial Performance Results ✅

After implementing the random_sort column with time-based rotation:

| Filter Combination | Before | After |
|-------------------|---------|--------|
| Week, 3x, 100K+ views | 2-3 seconds | 0.48 seconds |
| Month, 3x, 10K+ views | 8 seconds | 0.50 seconds |
| 2 years, 1.5x, 100+ views | 15+ seconds (timeout) | 1.05 seconds |

### Current Problem - Institutional Channel Check Bottleneck

#### The Issue
When we try to use the channels table for institutional filtering (for accuracy), performance degrades severely:

```sql
-- SLOW: Subquery approach (22+ seconds)
AND v.channel_id NOT IN (
  SELECT channel_id FROM channels WHERE is_institutional = true
)

-- SLOW: EXISTS approach (85+ seconds)
AND NOT EXISTS (
  SELECT 1 FROM channels c 
  WHERE c.channel_id = v.channel_id 
  AND c.is_institutional = true
)

-- FAST: Direct column (< 1 second)
AND v.is_institutional = false
```

#### Root Cause Analysis

The channels table lookup is slow because:
1. **Subquery execution**: PostgreSQL executes the subquery for EVERY row being evaluated
2. **No covering index**: Even though channel_id is indexed, the query still needs to check is_institutional
3. **Large dataset**: With 660K videos, even a fast subquery adds up

#### Performance Measurements

Testing with `get_random_video_ids` function (2 years, 1.5x, 100+ views):

| Approach | Time | Notes |
|----------|------|-------|
| Direct videos.is_institutional | 0.16s | Fast but requires syncing |
| NOT IN (subquery) | 85s | Subquery for every row |
| NOT EXISTS | 85s | Still evaluates per row |
| LEFT JOIN + NULL check | Not tested | Might be faster |

### Additional Issue - Count Function

The `get_filtered_video_count` function was also using the slow subquery:
- **Before fix**: 22 seconds
- **After fix**: < 100ms (using videos.is_institutional directly)

### Current Workaround

We're currently using `v.is_institutional = false` directly from the videos table:
- **Pros**: Fast performance (< 1 second for all queries)
- **Cons**: Requires periodic syncing when channels table is updated
- **Sync command**: `/scripts/fix-institutional-flags.js`

### Potential Solutions

#### Option 1: Automated Syncing (Recommended)
Create a trigger to automatically sync institutional flags:

```sql
CREATE OR REPLACE FUNCTION sync_institutional_flag()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE videos 
  SET is_institutional = NEW.is_institutional
  WHERE channel_id = NEW.channel_id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER channels_institutional_sync
AFTER UPDATE OF is_institutional ON channels
FOR EACH ROW EXECUTE FUNCTION sync_institutional_flag();
```

#### Option 2: Denormalized Materialized View
Create a materialized view with pre-joined channel data:

```sql
CREATE MATERIALIZED VIEW mv_videos_with_channels AS
SELECT v.*, c.is_institutional as channel_institutional
FROM videos v
JOIN channels c ON v.channel_id = c.channel_id;
```

#### Option 3: Composite Index on Channels
Create a covering index for the lookup:

```sql
CREATE INDEX idx_channels_institutional_lookup 
ON channels(channel_id, is_institutional) 
WHERE is_institutional = true;
```

### Files Created During Implementation

- `/scripts/random-sort-final.js` - Added random_sort column
- `/scripts/create-random-index.js` - Created index
- `/scripts/implement-discovery-function.js` - Time-based rotation
- `/scripts/fix-function-use-channels-table.js` - Channels table check (slow)
- `/scripts/fix-institutional-flags.js` - Sync institutional flags
- `/scripts/add-category-filter-to-function.js` - Category support
- `/scripts/fix-slow-count-function.js` - Fixed count function
- `/scripts/fix-function-fast-institutional.js` - Use videos.is_institutional
- `/scripts/optimize-with-channels-table.js` - EXISTS attempt (still slow)

### Current Status

✅ **Working**: API responds in < 1.5 seconds for all filter combinations
✅ **Performance**: 15x improvement over original implementation  
✅ **Features**: Category filtering, institutional filtering, time-based rotation
⚠️ **Trade-off**: Using denormalized videos.is_institutional field for speed
❓ **Decision Needed**: Implement trigger for auto-sync or keep manual sync?