# TEMPORAL PERFORMANCE SCORE SYSTEM - COMPLETE DOCUMENTATION

**Last Updated: August 8, 2025**

## Core Purpose: Finding Winning Content Patterns

**The primary goal of this system is to identify outlier videos** - content that significantly outperforms a channel's average - so we can analyze what makes them successful and implement those strategies in our own videos. This score is the crucial first step in discovering repeatable success patterns.

### Why We Need Age-Adjusted Scoring

The original approach using `views / (rolling 365-day channel average)` had a critical flaw:
- A video published **yesterday** with 10,000 views would score terribly against a channel averaging 100,000 views
- But that same video might be **massively outperforming** what other videos had at Day 1
- Without age adjustment, we couldn't identify early viral signals or fairly compare videos at different lifecycle stages

### The Ideal Solution vs Our Practical Approach

#### The Ideal Solution (What YouTube Has)
The perfect approach would use **daily channel-specific performance data** - exactly what YouTube shows channel owners in their analytics dashboard (the grey performance graph). This would include:
- Daily view snapshots for every video from Day 1
- Complete historical data for all videos ever published
- Channel-specific growth curves showing exact performance patterns
- Real-time updates as views accumulate

#### Our Reality: Limited Historical Access
When we start tracking a new channel, we face significant constraints:
- **No historical daily data**: Only channel owners can access detailed historical analytics
- **Starting from scratch**: We begin with just current view counts, no growth history
- **Time requirement**: Building meaningful curves requires months of daily tracking
- **Data sparsity**: Even with tracking, early videos have limited snapshots

#### Our Practical Solution: Progressive Data Enhancement

The **Temporal Performance Score** uses a three-layer approach that improves over time:

1. **Initial State (Global Curves + Backfill)**
   - Use global performance envelopes as baseline
   - Apply curve-based backfill to estimate Day 30 performance
   - Scale by channel baseline for channel-specific adjustment

2. **Active Tracking (Building Real Data)**
   - Our **View Tracking System** captures snapshots based on video age:
     - **Tier 0** (Days 1-7): Every 12 hours for viral detection
     - **Tier 1** (Days 8-30): Daily tracking for growth patterns
     - **Tier 2** (Days 31-90): Every 3 days
     - **Tier 3** (Days 91-365): Weekly
     - **Tier 4** (365+ days): Monthly
   - This builds real channel-specific data over time

3. **Future State (Channel-Specific Curves)**
   - After sufficient tracking (6-12 months), transition to channel curves
   - Use actual daily data like YouTube's backend
   - Global curves become fallback for new channels only

This system enables us to:
- **Start immediately**: Don't wait months for data accumulation
- **Improve progressively**: Each day of tracking makes predictions better
- **Identify outliers now**: Use best available data rather than waiting for perfect data
- **Transition smoothly**: Move from global to channel-specific as data matures

## Core Components

### 1. Global Performance Envelopes (Stop-Gap Workaround)

The foundation of our scoring system is the **Global Performance Envelope** - a set of curves showing how YouTube videos typically accumulate views over time.

**IMPORTANT: Global curves are a temporary workaround.** In an ideal world, we would use the same daily performance data that YouTube shows channel owners (the grey performance graph in YouTube Studio). However, since we can't access historical daily data for channels we don't own, we must use global curves as our best approximation until our view tracking system accumulates sufficient channel-specific data over time - literally months of waiting as videos age and we capture their performance trajectory.

#### Why Global Curves Are Necessary
- **Data Sparsity Challenge**: Most videos have only 1-2 snapshots in their first 30 days
- **Limited Historical Data**: New channels lack sufficient historical performance data
- **Tracking Coverage**: Only 0.57% of videos have Day 1 snapshots, 0.35% have Day 7
- **Statistical Reliability**: Need minimum data density for meaningful percentile calculations
- **Channel Scaling Workaround**: We scale global curves by channel baseline as an interim solution

#### Data Collection
- **Source**: 715,000+ view snapshots from 196,000+ videos
- **Coverage**: Day 1 to Day 3,650 (10 years)
- **Exclusions**: YouTube Shorts (≤180 seconds) are filtered out
- **Update Frequency**: Daily incremental updates via view tracking system

#### Percentile Bands
We track 5 key percentiles to understand the distribution:
- **P10** (10th percentile): Bottom performers
- **P25** (25th percentile): Below average
- **P50** (50th percentile): Median performance
- **P75** (75th percentile): Above average
- **P90** (90th percentile): Top performers

#### Smoothing Strategy
Raw data from 700K+ snapshots creates noisy curves. We apply:
- **7-day rolling average** smoothing
- **79.3% volatility reduction** while preserving trends
- Eliminates day-of-week effects and random fluctuations

### 2. Channel Baselines (`channel_baseline_at_publish`)

Each video gets a baseline representing what's "normal" for its channel at publication time.

#### Calculation Method
```sql
-- For each video, find the last 10 videos from the same channel
SELECT AVG(view_count) as baseline
FROM (
  SELECT view_count
  FROM videos v2
  WHERE v2.channel_id = target_video.channel_id
    AND v2.published_at < target_video.published_at
    AND v2.published_at >= target_video.published_at - INTERVAL '30 days'
    AND v2.is_short = false
    AND v2.view_count > 0
  ORDER BY v2.published_at DESC
  LIMIT 10
) recent_videos
```

#### Key Features
- Uses **last 10 videos** within 30 days before publication
- Excludes YouTube Shorts for consistency
- Defaults to 1.0 if insufficient historical data
- Captures channel performance at specific point in time

### 3. Curve-Based Backfill

For videos lacking complete 30-day tracking data, we use the global curves to estimate their Day 30 performance.

#### Backfill Formula
```python
# Estimate what a video would have at Day 30 based on current performance
estimated_day30_views = current_views * (day30_envelope / current_day_envelope)
```

#### Example
- Video is 90 days old with 50,000 views
- Global curve shows videos typically have 80% of Day 90 views by Day 30
- Estimated Day 30 views = 50,000 × 0.8 = 40,000

### 4. Temporal Performance Score Calculation

The final score combines all components:

```
temporal_performance_score = actual_views / expected_views

where:
expected_views = global_p50_at_age × channel_baseline_multiplier
```

#### Interpretation
- **Score = 1.0**: Video performing exactly as expected
- **Score > 2.0**: Exceptional/viral performance (green)
- **Score 1.0-2.0**: Average to good performance (gray)
- **Score < 1.0**: Below average performance (red)

## Implementation Architecture

### Database Schema

```sql
-- Core performance fields
CREATE TABLE videos (
  -- Identity
  id TEXT PRIMARY KEY,
  channel_id TEXT NOT NULL,
  
  -- Metrics
  view_count BIGINT,
  published_at TIMESTAMPTZ,
  
  -- Performance scoring
  channel_baseline_at_publish NUMERIC,  -- Channel's typical views
  temporal_performance_score NUMERIC,    -- Normalized performance
  is_short BOOLEAN DEFAULT false,       -- YouTube Shorts flag
  
  -- Tracking
  import_date TIMESTAMPTZ DEFAULT NOW()
);

-- Global performance curves
CREATE TABLE performance_envelopes (
  day_since_published INTEGER PRIMARY KEY,
  p10_views NUMERIC,
  p25_views NUMERIC,
  p50_views NUMERIC,  -- Median (primary reference)
  p75_views NUMERIC,
  p90_views NUMERIC,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Time-series view tracking
CREATE TABLE view_snapshots (
  id SERIAL PRIMARY KEY,
  video_id TEXT REFERENCES videos(id),
  view_count BIGINT,
  snapshot_date TIMESTAMPTZ,
  days_since_published INTEGER
);
```

### Key Database Functions

#### 1. Calculate Baseline on Insert
```sql
CREATE FUNCTION calculate_baseline_on_insert()
RETURNS TRIGGER AS $$
BEGIN
  -- Calculate temporal baseline
  NEW.channel_baseline_at_publish := (
    SELECT AVG(view_count)
    FROM recent_videos...
  );
  
  -- Calculate performance score
  IF NEW.channel_baseline_at_publish > 0 THEN
    NEW.temporal_performance_score := 
      NEW.view_count::NUMERIC / NEW.channel_baseline_at_publish;
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
```

#### 2. Batch Baseline Processing
```sql
CREATE FUNCTION trigger_temporal_baseline_processing(batch_size INTEGER DEFAULT 100)
RETURNS JSONB AS $$
DECLARE
  processed INTEGER;
BEGIN
  WITH batch AS (
    SELECT id, channel_id, published_at, view_count
    FROM videos
    WHERE channel_baseline_at_publish IS NULL
      AND is_short = false
    LIMIT batch_size
  )
  UPDATE videos 
  SET 
    channel_baseline_at_publish = (calculated_baseline),
    temporal_performance_score = view_count::NUMERIC / (calculated_baseline)
  FROM batch
  WHERE videos.id = batch.id;
  
  GET DIAGNOSTICS processed = ROW_COUNT;
  RETURN jsonb_build_object('videos_updated', processed);
END;
$$ LANGUAGE plpgsql;
```

### Processing Pipeline

#### 1. Video Import Flow
```mermaid
graph TD
    A[New Videos Import] --> B[Store in Database]
    B --> C[Calculate Temporal Baseline]
    C --> D[Look at Last 10 Channel Videos]
    D --> E[Calculate Average Views]
    E --> F[Store as channel_baseline_at_publish]
    F --> G[Calculate Performance Score]
    G --> H[Score = Current Views / Baseline]
```

#### 2. View Tracking System
- **6-Tier Priority System**:
  - Tier 1: Videos < 7 days old (daily tracking)
  - Tier 2: Videos 7-30 days (every 3 days)
  - Tier 3: Videos 30-90 days (weekly)
  - Tier 4: Videos 90-180 days (bi-weekly)
  - Tier 5: Videos 180-365 days (monthly)
  - Tier 6: Videos > 365 days (quarterly)

- **Daily Processing**:
  - ~100,000 videos tracked per day
  - 2,000 YouTube API calls (50 videos per batch)
  - Automatic view count synchronization
  - Real-time score recalculation

#### 3. Envelope Recalculation
- **Daily Updates**: New snapshots added continuously
- **Weekly Recalculation**: Full envelope recalculation with smoothing
- **Shorts Filtering**: Automatic exclusion of videos ≤180 seconds

### Automated Maintenance

#### Daily Cron Jobs
```sql
-- 1. Recalculate baselines for videos reaching 30 days
SELECT cron.schedule(
  'daily-temporal-baseline-update',
  '0 10 * * *',  -- 10 AM UTC daily
  $$SELECT daily_baseline_update_smart(30, 2)$$
);

-- 2. Update performance envelopes
SELECT cron.schedule(
  'weekly-envelope-update', 
  '0 2 * * 0',  -- 2 AM UTC Sundays
  $$SELECT recalculate_global_envelopes()$$
);

-- 3. Sync view counts from snapshots
CREATE TRIGGER sync_video_views
AFTER INSERT OR UPDATE ON view_snapshots
FOR EACH ROW EXECUTE FUNCTION sync_video_view_count();
```

## Real-World Example

Consider a video from "Make or Break Shop":
- **Published**: March 1, 2025
- **Current Age**: 30 days
- **Current Views**: 125,000

### Step 1: Calculate Channel Baseline
- Last 10 videos averaged 50,000 views at 30 days
- `channel_baseline_at_publish = 50,000`

### Step 2: Get Global Expectation
- Global P50 at Day 30 = 10,000 views (from envelope)
- Channel multiplier = 50,000 / 10,000 = 5.0x

### Step 3: Calculate Expected Views
- Expected = 10,000 × 5.0 = 50,000 views

### Step 4: Calculate Score
- Score = 125,000 / 50,000 = **2.5x**
- **Interpretation**: Viral performance! 🟢

## Advanced Features

### Channel-Specific Performance Bands
Instead of using global percentiles, we scale them to each channel:

```python
def calculate_channel_bands(channel_baseline, global_envelope):
    scale_factor = channel_baseline / global_envelope['p50']
    return {
        'p10': global_envelope['p10'] * scale_factor,
        'p25': global_envelope['p25'] * scale_factor,
        'p50': global_envelope['p50'] * scale_factor,
        'p75': global_envelope['p75'] * scale_factor,
        'p90': global_envelope['p90'] * scale_factor
    }
```

### Age-Adjusted Scoring
For videos at different lifecycle stages:

```sql
-- Get expected views at current age
WITH age_adjusted AS (
  SELECT 
    v.id,
    v.view_count,
    v.channel_baseline_at_publish,
    pe.p50_views as global_median_at_age,
    DATE_PART('day', NOW() - v.published_at) as current_age
  FROM videos v
  JOIN performance_envelopes pe 
    ON pe.day_since_published = v.current_age
)
SELECT 
  id,
  view_count / (channel_baseline_at_publish * 
    (global_median_at_age / global_median_at_30_days)) as adjusted_score
FROM age_adjusted;
```

## Performance Categories

Videos are automatically categorized based on their temporal score:

| Category | Score Range | Visual | Description |
|----------|------------|--------|-------------|
| Viral | ≥ 3.0 | 🔥 | Exceptional breakout content |
| Outperforming | 2.0-3.0 | 🟢 | Significantly above expectations |
| Above Average | 1.5-2.0 | 🟡 | Better than typical |
| Standard | 0.75-1.5 | ⚪ | Meeting expectations |
| Below Average | 0.5-0.75 | 🟠 | Underperforming |
| Poor | < 0.5 | 🔴 | Significantly underperforming |

## Query Examples

### Find Top Performers with Context
```sql
SELECT 
  v.title,
  v.channel_name,
  v.view_count,
  v.temporal_performance_score,
  v.channel_baseline_at_publish,
  DATE_PART('day', NOW() - v.published_at) as age_days,
  CASE 
    WHEN v.temporal_performance_score >= 3.0 THEN '🔥 Viral'
    WHEN v.temporal_performance_score >= 2.0 THEN '🟢 Outperforming'
    WHEN v.temporal_performance_score >= 1.5 THEN '🟡 Above Average'
    WHEN v.temporal_performance_score >= 0.75 THEN '⚪ Standard'
    WHEN v.temporal_performance_score >= 0.5 THEN '🟠 Below Average'
    ELSE '🔴 Poor'
  END as performance_category
FROM videos v
WHERE v.is_short = false
  AND v.temporal_performance_score IS NOT NULL
  AND v.published_at > NOW() - INTERVAL '30 days'
ORDER BY v.temporal_performance_score DESC
LIMIT 20;
```

### Channel Performance Analysis
```sql
SELECT 
  channel_name,
  COUNT(*) as total_videos,
  AVG(temporal_performance_score) as avg_score,
  PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY temporal_performance_score) as median_score,
  COUNT(*) FILTER (WHERE temporal_performance_score >= 2.0) as outperforming_videos,
  COUNT(*) FILTER (WHERE temporal_performance_score < 1.0) as underperforming_videos,
  AVG(channel_baseline_at_publish) as avg_channel_baseline
FROM videos
WHERE is_short = false
  AND temporal_performance_score IS NOT NULL
GROUP BY channel_name
HAVING COUNT(*) >= 10
ORDER BY avg_score DESC;
```

## System Metrics

### Current Coverage (as of August 2025)
- **Total Videos**: 198,000+
- **Regular Videos** (non-Shorts): 171,747
- **With Temporal Baselines**: 175,651 (99.94%)
- **With Performance Scores**: 175,548 (99.88%)
- **View Snapshots**: 715,000+
- **Tracking Daily**: 100,000 videos

### Processing Performance
- **Baseline Calculation**: ~100-200 videos/second
- **Batch Import**: Handles 1,000+ videos without timeout
- **View Tracking**: 2,000 API calls = 100,000 videos daily
- **Score Recalculation**: Real-time via database triggers

## Key Learnings & Best Practices

### 1. Shorts Contamination
YouTube Shorts have completely different performance patterns. Mixing them with regular videos creates meaningless baselines. Always filter: `WHERE is_short = false`.

### 2. Temporal Context Matters
A video with 100K views from 2020 might have been exceptional then but average now. Temporal baselines capture this channel evolution.

### 3. Smoothing is Essential
Raw percentile curves from 700K+ data points are too noisy. 7-day rolling averages provide stable, meaningful bands.

### 4. Batch Processing Strategy
Single UPDATE statements with correlated subqueries are 100x more efficient than loops. Always process in batches, never iterate.

### 5. View Tracking Integration
View snapshots must trigger main table updates. Without this, scores become stale as videos accumulate views.

## Migration from Legacy System

### Old System: Rolling Baseline
- Simple 1-year average: `AVG(views) WHERE published > NOW() - 1 YEAR`
- Field: `rolling_baseline_views`
- Didn't account for channel growth or decline

### New System: Temporal Baseline
- Last 10 videos within 30 days
- Fields: `channel_baseline_at_publish`, `temporal_performance_score`
- Captures channel state at publication time
- Accounts for non-linear view accumulation

### Migration Complete
- **Date**: August 8, 2025
- **Coverage**: 100% of non-Short videos
- **Old System**: Disabled and deprecated

## Future Enhancements

### Transition from Global to Channel-Specific Curves

#### Phase 1 (Current - Stop-Gap)
- **Global curves** scaled by channel baseline
- Necessary due to sparse data (most videos have 1-2 snapshots in first 30 days)
- Works adequately but lacks channel-specific nuance

#### Phase 2 (In Progress)
- **Channel scaling factors** for top 20+ channels with sufficient data
- Hybrid approach: Global curves enhanced with channel-specific multipliers
- Addresses data sparsity by using aggregated channel performance

#### Phase 3 (Future Goal)
- **Individual channel curves** once sufficient 30-day data accumulated
- Requires consistent daily tracking for meaningful percentiles
- Will provide most accurate performance modeling
- Fallback to global curves for new/small channels

### Planned Improvements
1. **Machine Learning Integration**: Predict future performance based on early signals
   - ML backfill approach tested with 96% improvement over global curves
   - Can generate synthetic baselines to address sparse data problem
2. **Seasonal Adjustments**: Account for holiday peaks and summer lulls
3. **Category-Specific Curves**: Different expectations for tutorials vs entertainment
4. **Engagement-Weighted Scores**: Factor in likes, comments, and watch time
5. **Real-Time Alerts**: Notify when videos cross performance thresholds

### Research Areas
- Velocity-based scoring (how fast views accumulate)
- Platform algorithm change detection
- Cross-platform performance comparison
- Audience retention integration

## Conclusion

The Temporal Performance Score System is the foundation for data-driven content strategy. By identifying outlier videos that significantly outperform their channel's average - adjusted for age to ensure fair comparison - we can systematically learn what makes certain content successful and apply those insights to future videos.

Key achievements:
- **Solves the age bias problem**: No longer penalizing new videos for having fewer total views
- **Enables early detection**: Identifies breakout content from Day 1, not months later
- **Provides actionable insights**: Clear scoring helps creators understand what's working
- **Scales efficiently**: Processes 100,000+ videos daily with sub-second query performance

The combination of global patterns (temporary), channel baselines, and age adjustment creates a fair playing field where a 1-day-old video can be properly compared to historical performance at Day 1, not lifetime totals. This is the crucial first step in understanding and replicating viral success patterns.