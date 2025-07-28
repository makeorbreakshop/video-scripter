# YouTube Performance Envelope Analysis - Technical Report

## Executive Summary

We are implementing a YouTube-style performance envelope system to identify over/underperforming videos based on age-adjusted benchmarks. This report outlines our database assets, technical approach, and implementation strategy for Stage 1 of the project.

## Current Database Assets

### Scale & Coverage
- **161,288 total videos** across 763 unique YouTube channels
- **480,866 view snapshots** providing time-series performance data
- **160,669 videos with view tracking** (99.6% coverage)
- **6,063 unique days** of coverage (0-7,394 days since publication)

### Data Quality Metrics
- **Average 3.0 snapshots per video** (sparse but workable data)
- **Day 0-30 coverage**: 300-1,000 videos tracked per day (sufficient for percentiles)
- **Day 1 snapshots**: 927 videos (0.6% sample rate)
- **Day 7 snapshots**: 567 videos (0.4% sample rate)
- **156,919 videos classified by format** (12 content types)
- **120,615 videos classified by topic** (777 BERTopic clusters)

### Key Data Tables
1. **videos** (557 MB) - Core video metadata with performance metrics
2. **view_snapshots** (110 MB) - Time-series view count data
3. **view_tracking_priority** (38 MB) - Active tracking management
4. **chunks** (94 MB) - Transcript data for semantic analysis
5. **daily_analytics** (47 MB) - YouTube Analytics API data

### Schema Structure
**view_snapshots table:**
- `video_id` - Links to videos table
- `snapshot_date` - When measurement was taken
- `view_count` - Raw view count at that time
- `days_since_published` - Normalized age metric (key for analysis)
- `like_count`, `comment_count` - Engagement metrics

**videos table key fields:**
- Performance metrics: `view_count`, `performance_ratio`, `outlier_factor`
- Content classification: `format_type`, `topic_cluster_id`
- Channel context: `channel_id`, `channel_name`, `channel_avg_views`
- Age calculations: `published_at`, `first_day_views`, `first_week_views`

## Stage 1 Implementation Strategy

### Objective
Create a global growth curve that works immediately for any channel by extracting performance patterns from our entire 161K video dataset, then scaling to individual channel baselines.

### Technical Approach

#### Step 1: Data Extraction & Filtering
```sql
-- Extract all view snapshots with video context
SELECT 
  vs.video_id,
  vs.days_since_published,
  vs.view_count,
  v.channel_id,
  v.duration,
  v.format_type
FROM view_snapshots vs
JOIN videos v ON vs.video_id = v.id
WHERE v.duration IS NOT NULL 
  AND parse_duration(v.duration) > 121  -- Filter out Shorts
```

#### Step 2: Global Growth Curve Construction
1. **Aggregate by Age**: Group all snapshots by `days_since_published`
2. **Calculate Percentiles**: For each day, compute 10th, 25th, 50th, 75th, 90th percentiles
3. **Handle Sparse Data**: 
   - Direct calculation where sufficient data exists
   - Interpolation/smoothing for gaps in coverage
4. **Normalize Shape**: Create relative growth multipliers using Day 1 as baseline

#### Step 3: Channel-Specific Scaling
1. **Channel Baseline Calculation**:
   ```sql
   -- Calculate each channel's first-week median performance
   SELECT 
     channel_id,
     MEDIAN(view_count) as first_week_median,
     COUNT(DISTINCT video_id) as video_count,
     MIN(snapshot_date) as first_tracked_date
   FROM view_snapshots vs
   JOIN videos v ON vs.video_id = v.id
   WHERE days_since_published BETWEEN 0 AND 7
   GROUP BY channel_id
   ```

2. **Confidence-Weighted Scaling**:
   ```sql
   -- Calculate confidence score
   baseline_confidence = LEAST(video_count / 30.0, 1.0) * 
                        LEAST(EXTRACT(days FROM NOW() - first_tracked_date) / 90.0, 1.0)
   
   -- Blend channel and global baselines
   effective_baseline = (channel_baseline * confidence) + (global_baseline * (1 - confidence))
   
   -- Apply scaling
   Expected_Views[day] = effective_baseline × Global_Shape_Multiplier[day]
   Performance_Ratio = Actual_Views / Expected_Views
   ```

#### Step 4: Performance Classification
**Ratio-Based Categories** (simpler than percentiles):
- **Viral**: Performance ratio > 3.0
- **Outperforming**: Performance ratio 1.5 - 3.0
- **On Track**: Performance ratio 0.5 - 1.5
- **Underperforming**: Performance ratio 0.2 - 0.5
- **Poor**: Performance ratio < 0.2

This provides intuitive thresholds (e.g., "3x expected views") rather than abstract percentiles.

### Expected Challenges & Solutions

#### Challenge 1: Sparse Snapshot Data
- **Problem**: Average 3 snapshots per video, irregular timing
- **Solution**: Focus on aggregate patterns across all videos rather than individual trajectories

#### Challenge 2: YouTube Shorts Filtering
- **Problem**: Different performance patterns, need to exclude
- **Solution**: Parse duration field and filter videos ≤121 seconds

#### Challenge 3: Algorithm Changes Over Time
- **Problem**: YouTube's algorithm evolves, affecting baseline performance
- **Solution**: Weight recent videos more heavily, consider rolling baselines

#### Challenge 4: Channel Size Variations
- **Problem**: MrBeast vs. small creators have vastly different scales
- **Solution**: Normalize to channel-specific Day 1 baselines before comparison

### Implementation Plan

#### Phase 1A: Data Analysis (Python Script)
1. Extract and clean all snapshot data
2. Build global percentile curves for days 0-365
3. Validate curve shape matches expected YouTube patterns
4. Generate test visualizations with sample channels

#### Phase 1B: Database Integration
1. Create stored procedures for real-time envelope calculation
2. Pre-calculate reference curves for performance optimization
3. Build API endpoints for dashboard integration

#### Phase 1C: Visualization & Testing
1. Create interactive charts showing envelope + individual videos
2. Test with known high/low performers for validation
3. Build performance category badges and alerts

### Success Metrics
1. **Curve Validation**: Shape matches YouTube's front-loaded view patterns
2. **Outlier Detection**: Successfully identifies known viral videos
3. **Early Detection**: Flags under/overperformers by Day 1-3
4. **Channel Scaling**: Appropriate scaling across different channel sizes
5. **Performance**: Real-time envelope calculation for dashboard use

### Technical Specifications

#### Database Queries
- **Global Curve**: Aggregate 480K+ snapshots across 6K+ unique days
- **Channel Scaling**: Calculate baselines for 763 channels
- **Real-time Lookup**: Sub-second performance classification

#### Expected Output
- **Percentile curves** for days 0-365 (or max available)
- **Channel scaling factors** for 763 channels
- **Performance classifications** for all tracked videos
- **API endpoints** for dashboard integration

This approach leverages our substantial dataset to create immediately useful benchmarks while accommodating the sparse nature of our snapshot data through statistical aggregation rather than individual video tracking.

## Implementation Questions & Answers

### 1. Day-1 Baseline Availability
**Reality Check**: We have Day 1 data for 336/763 channels (44%), plus Day 0-7 data covering 281+ channels.

**Fallback Hierarchy**:
1. **First-week median (Days 0-7)** - Primary baseline (covers most channels)
2. Day 1 median (if available)
3. Days 0-3 median 
4. Global median for channel's format/topic cluster
5. Overall global median as final fallback

**Rationale**: First-week median provides better accuracy by smoothing Day 1 anomalies while maximizing channel coverage.

### 2. Duration Filtering & Parsing
**Current Issue**: Duration stored in ISO 8601 format (PT1M, PT17M17S) requires proper parsing.

**Solution**: Implement consistent duration parser across codebase:
```typescript
function parseDurationToSeconds(duration: string): number {
  const match = duration.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!match) return 0;
  const hours = parseInt(match[1] || '0');
  const minutes = parseInt(match[2] || '0'); 
  const seconds = parseInt(match[3] || '0');
  return hours * 3600 + minutes * 60 + seconds;
}
```

**Filtering Strategy**: 
- Filter videos ≤121 seconds (Shorts)
- Keep 61-121s "promo clips" for Stage 1 (add format-based filtering later)
- Preserve live replays (≥4 hours) - they follow similar growth patterns

### 3. Envelope Time Range
**Decision**: Extend to **Day 730** for Stage 1
- Captures most meaningful growth patterns over 2-year period
- YouTube algorithm effects more stable over longer periods
- We have data up to Day 7,394, so Day 730 is well-supported

### 4. Interpolation & Smoothing Method
**Approach**:
- **Days 0-30**: Linear interpolation (critical growth period needs precision)
- **Days 31-730**: Rolling 7-day median with linear interpolation for gaps
- **Monotonicity**: No enforcement - some videos experience view drops due to algorithm changes

### 5. Recent Video Weighting
**Strategy**: Exponential decay with 18-month half-life
```
weight = exp(-age_in_months / 18)
```
Balances algorithm evolution tracking with sufficient data volume for statistical reliability.

### 6. Performance Classification
**Method**: Compare `actual_views / expected_views` (scaled curve), not raw global percentiles.
This accounts for channel size differences and provides actionable insights.

**Categories** (5-tier system):
- **Viral**: >95th percentile (true breakout content)
- **Outperforming**: 75th-95th percentile (above average)
- **On Track**: 25th-75th percentile (normal range)
- **Underperforming**: 10th-25th percentile (below average)  
- **Poor**: <10th percentile (needs immediate attention)

### 7. Refresh Cadence
- **Global curves**: Weekly refresh (sufficient for algorithm change tracking)
- **Channel baselines**: Daily refresh (as new snapshots arrive)
- **API compliance**: Integrated with existing 30-day YouTube API refresh cycles

### 8. Engagement Metrics
**Stage 1**: Focus exclusively on view counts for system simplicity
**Future Enhancement**: Parallel envelopes for like/comment ratios provide additional insights

### 9. Simplified Database Schema Design
**Minimalist Approach**: Only 1 new table + 3 columns

**Single New Table for Global Curves**:
```sql
-- Global reference curves (only ~730 rows)
CREATE TABLE performance_envelopes (
  day_since_published INTEGER PRIMARY KEY,
  p10_views BIGINT,
  p25_views BIGINT, 
  p50_views BIGINT,
  p75_views BIGINT,
  p90_views BIGINT,
  p95_views BIGINT,
  sample_count INTEGER,
  updated_at TIMESTAMP
);
```

**Extend videos table**:
```sql
-- Add only essential columns
ALTER TABLE videos ADD COLUMN performance_ratio DECIMAL(4,2);
ALTER TABLE videos ADD COLUMN performance_category TEXT;
ALTER TABLE videos ADD COLUMN envelope_calculated_at TIMESTAMP;
```

**Channel baselines calculated on-demand**:
```sql
-- No new table needed - query existing data
WITH channel_stats AS (
  SELECT PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY view_count) as median_views
  FROM view_snapshots 
  WHERE channel_id = ? AND days_since_published <= 7
)
```

This approach reduces complexity while maintaining full functionality.

### 10. Edge Cases & Content Filtering
**Stage 1 Handling**:
- **Live replays**: Keep (≥4 hours) - follow similar growth patterns
- **Shorts filtering**: Exclude videos ≤121 seconds after fixing duration parsing
- **Live-only channels**: Handle via existing format classification system
- **Missing duration data**: Use format_type for classification when duration unavailable

This comprehensive approach ensures robust performance envelope calculation while maintaining system performance and providing immediately actionable insights for content creators.

## Critical 80/20 Implementation Factors

### 1. Handle Sparse Data Reality
**Problem**: Only 0.6% of videos have Day 1 snapshots, 0.4% have Day 7 snapshots
**Solution**: Work with what we have - 300-1,000 videos per day is sufficient for reliable percentiles
- No need to combine with non-existent `first_day_views` data
- Accept this is a 1% sample that's actively tracked (likely higher-quality videos)
- Build percentiles from available data without complex workarounds

### 2. Prevent Snapshot Frequency Bias
**Problem**: Some videos tracked 20 times, others only 2-3 times
**Solution**: Weight videos equally when building global curves
```sql
WITH video_weights AS (
  SELECT video_id, 
         1.0 / COUNT(*) as snapshot_weight
  FROM view_snapshots
  GROUP BY video_id
)
-- Apply weights when calculating percentiles to prevent over-representation
```

### 3. Channel Baseline Confidence Scoring
**Problem**: New channels or viral outliers create unstable baselines
**Solution**: Simple confidence formula based on data quantity
```sql
baseline_confidence = LEAST(video_count / 30.0, 1.0) * LEAST(days_tracked / 90.0, 1.0)

-- Blend channel and global baselines:
effective_baseline = (channel_baseline * confidence) + (global_baseline * (1 - confidence))
```

### 4. Pre-calculate Daily, Classify Real-time
**Problem**: 161K videos × complex calculations = slow dashboards
**Solution**: Three-tier processing
- **Nightly batch**: Calculate all performance ratios and store in database
- **Real-time lookup**: Simple indexed queries for pre-calculated values  
- **On-demand refresh**: Recalculate only for videos with new snapshots

### 5. Minimum Data Thresholds
**Problem**: Can't calculate reliable percentiles with too few videos
**Solution**: Conservative approach
- Require 30+ videos per day for percentile calculation
- Use linear interpolation only between days with valid data
- No extrapolation beyond actual data points
- Flag days with insufficient data in the UI

These five factors address 80% of robustness concerns while keeping implementation simple and maintainable.

## Responses to Gemini's Advanced Questions

### 1. Future-Proofing Without Complexity
**Concern**: How to design for future format-specific curves?
**Solution**: Keep it simple for now - the single `performance_envelopes` table can be extended later by adding a `segment_type` column when needed. No over-engineering required.

### 2. Selection Bias Correction
**Discovery**: Our view tracking is heavily biased toward successful videos (Tier 6 median: 81K views vs Tier 1 median: 9.8K views).
**Solution**: Weight contributions during percentile calculation:
```sql
-- Correct for tier bias
tier_weight = 1.0 / tier_median_views
-- This prevents high-tier videos from skewing "normal"
```

### 3. Global Baseline Calculation
**Challenge**: Avoid skew from mega-channels
**Solution**: Use geometric mean with outlier filtering:
```sql
-- Geometric mean handles wide ranges better
SELECT EXP(AVG(LN(view_count))) as global_baseline
FROM view_snapshots
WHERE days_since_published <= 7
  AND view_count BETWEEN 100 AND 1000000;
```

### 4. Temporal Weighting Consistency
**Apply to both**:
- Global percentile calculations: `weight = exp(-age_months / 18)`
- Channel baseline calculations: Same weighting
This ensures the entire system reflects current YouTube dynamics.

### 5. Enhanced Actionability
**Beyond categories**: Expose the raw performance ratio
- Display: "2.5x expected views" is more intuitive than just "Outperforming"
- Store both ratio and category for maximum flexibility

### 6. Outlier-Resistant Baselines
**Use trimmed statistics**:
```sql
-- Calculate baseline excluding top/bottom 10%
WITH ranked AS (
  SELECT view_count,
         PERCENT_RANK() OVER (ORDER BY view_count) as pct
  FROM view_snapshots
  WHERE channel_id = ? AND days_since_published <= 7
)
SELECT PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY view_count)
FROM ranked WHERE pct BETWEEN 0.1 AND 0.9;
```

### 7. Log-Linear Interpolation
**For Days 0-30**: Use logarithmic interpolation to match YouTube's exponential growth:
```python
# More realistic than linear
log_views = np.log(views + 1)
interpolated_log = np.interp(target_days, known_days, log_views)
interpolated_views = np.exp(interpolated_log) - 1
```

### 8. Balanced Snapshot Weighting
**Square root weighting** prevents both over and under-representation:
```sql
video_weight = SQRT(snapshot_count) / SUM(SQRT(snapshot_count)) OVER()
```

### 9. Efficient Classification Updates
**Lazy refresh strategy**:
- Store `envelope_calculated_at` timestamp
- Only recalculate when:
  - New snapshot arrives for that video
  - Global curves updated (weekly)
  - User manually requests refresh

## Final Implementation Plan

### Phase 1: Build Foundation (Week 1)
1. Create duration parsing utility function
2. Build Python script to calculate global percentiles
3. Create single `performance_envelopes` table
4. Generate and validate curve shapes

### Phase 2: Integration (Week 2)
1. Add 3 columns to videos table
2. Create API endpoint for performance calculation
3. Implement on-demand channel baseline queries
4. Build batch job for nightly updates

### Phase 3: Dashboard (Week 3)
1. Create visualization component
2. Add performance badges to video lists
3. Implement manual refresh functionality
4. Deploy and monitor

This simplified approach delivers the same value with minimal complexity and maximum maintainability.