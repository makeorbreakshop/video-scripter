# YouTube-Style Performance Envelope Chart - TODO

## Goal
Build a chart similar to YouTube's backend analytics that shows if a video is over/underperforming for its age, using our view tracking snapshot data.

## Updated Strategy (From Report)
- **Database**: Only 1 new table (`performance_envelopes`) + 3 columns in `videos` table
- **Classification**: Ratio-based (3x = Viral, 1.5x = Outperforming, etc.) 
- **Baselines**: Calculate on-demand from existing data, no separate table needed
- **Focus**: Simple, maintainable solution that can be extended later

## Core Requirements
- **X-axis**: Days since published (normalized, all videos start at day 0)
- **Y-axis**: Raw view counts
- **Gray envelope**: Performance range (25th-75th percentile) representing "normal" performance
- **Individual video lines**: Show if specific videos are above/below normal range
- **Performance Ratio**: actual_views / expected_views (e.g., "2.5x expected")

## Phase 1: Global Growth Curve Implementation ✅ COMPLETED

### Data Collection & Analysis
- [x] Create Python script to query Supabase for view snapshots ✓
- [x] Filter out YouTube Shorts using duration <= 121s logic ✓
- [x] Analyzed data distribution: 161K videos with average 3 snapshots ✓
- [x] Confirmed sufficient data: 300-1,000 videos tracked per day for Days 0-30 ✓

### Global Growth Curve Construction ✅ COMPLETED
- [x] Extract growth shape from entire dataset:
  - [x] Group all snapshots by `days_since_published` ✓
  - [x] Calculate percentiles for Days 0-365 ✓
  - [x] Generate 366 performance curves with sample counts ✓
- [x] Calculate global percentiles for each day:
  - [x] 10th percentile ✓
  - [x] 25th percentile ✓
  - [x] 50th percentile (median) ✓
  - [x] 75th percentile ✓
  - [x] 90th percentile ✓
  - [x] 95th percentile ✓
- [x] Create duration parsing utility:
  - [x] Handle ISO 8601 format (PT1M, PT17M17S, etc.) ✓
  - [x] Filter videos ≤121 seconds (Shorts) ✓
  - [x] Fixed critical import pipeline bug: 68% of videos missing duration data ✓
  - [x] Migrated 107,881 historical videos from metadata to duration column ✓
  - [x] Achieved 97.1% duration coverage (161,113/165,925 videos) ✓

### Channel-Specific Scaling
- [ ] Calculate channel baselines on-demand (no separate table):
  - [ ] First-week median (Days 0-7) as primary baseline
  - [ ] Use trimmed statistics (exclude top/bottom 10% outliers)
  - [ ] Calculate geometric mean for global baseline (handles wide ranges)
- [ ] Implement confidence scoring:
  - [ ] confidence = LEAST(video_count/30, 1.0) × LEAST(days_tracked/90, 1.0)
  - [ ] effective_baseline = (channel_baseline × confidence) + (global_baseline × (1-confidence))
- [ ] Apply scaling formula:
  - [ ] Expected_views = effective_baseline × global_shape_multiplier[day]
  - [ ] Performance_ratio = actual_views / expected_views

### Visualization & Testing
- [x] Create scatter plot showing actual data points ✓
- [x] Plot fitted growth curves (power law, logarithmic) ✓
- [x] Test with "3x3Custom - Tamar" channel data ✓
- [ ] Build new visualization with:
  - [ ] Global percentile bands (25th-75th) 
  - [ ] Channel-scaled expected curve
  - [ ] Individual video performance vs expectations
  - [ ] Performance categories displayed

### Analysis Questions to Answer
- [x] Can we extract a consistent growth shape despite sparse data? ✓ Yes, 300-1000 videos/day is sufficient
- [x] What percentage of videos have Day 1-7 snapshots? ✓ 0.57% Day 1, 0.35% Day 7, 1.52% Days 1-7
- [x] How do we handle interpolation between sparse points? ✓ Log-linear interpolation for Days 0-30
- [ ] Does the global curve capture YouTube's front-loaded view pattern?
- [x] How much does growth shape vary by channel size/type? ✓ Defer format-specific curves to Stage 2

## Phase 1.5: Smooth Curve Implementation (CRITICAL MISSING STEP)

### Transform Raw Percentiles to Growth Curves
- [ ] Implement smooth curve generation from raw percentile data:
  - [ ] Create curve fitting function using log-linear interpolation
  - [ ] Ensure monotonic growth (views can only increase over time)
  - [ ] Fix Day 90 < Day 30 anomaly in raw data
  - [ ] Use cubic spline for Days 0-30, linear for Days 31+
- [ ] Update performance_envelopes table with smoothed data:
  - [ ] Generate smoothed curves for all percentiles (p10, p25, p50, p75, p90, p95)
  - [ ] Store both raw and smoothed values for debugging
  - [ ] Validate curves show proper YouTube growth pattern
- [ ] Create curve validation script:
  - [ ] Check monotonicity across all days
  - [ ] Verify smooth transitions without spikes
  - [ ] Compare against known viral/normal videos
- [ ] Port Python curve fitting logic to TypeScript/SQL:
  - [ ] Create stored procedure or API utility for real-time smoothing
  - [ ] Ensure consistent results between Python and production code

### Why This Is Critical
- Raw percentile data shows Day 90 (26,507) < Day 30 (29,022) - impossible!
- Current data represents different video sets at each day, not cumulative growth
- API endpoints will produce incorrect results without proper growth curves
- Must implement curve fitting as shown in demo_smooth_envelope.py

## Phase 2: Database & API Implementation

### Database Changes ✅ COMPLETED
- [x] Create `performance_envelopes` table:
  ```sql
  CREATE TABLE performance_envelopes (
    day_since_published INTEGER PRIMARY KEY,
    p10_views BIGINT, p25_views BIGINT, p50_views BIGINT,
    p75_views BIGINT, p90_views BIGINT, p95_views BIGINT,
    sample_count INTEGER, updated_at TIMESTAMP
  );
  ```
  - [x] **366 global curves populated** (Days 0-365) ✓
  - [x] Sample data: Day 0: 3,520 views → Day 365: 59,542 views (median) ✓
  - [x] Quality data: 1,000 videos for Day 0/1, 500+ videos for most days ✓

- [x] Extend videos table (envelope columns):
  ```sql
  -- Already exists in database:
  envelope_performance_ratio NUMERIC
  envelope_performance_category TEXT
  ```
  - [x] **envelope_performance_ratio**: For actual_views / expected_views calculations ✓
  - [x] **envelope_performance_category**: For "Viral", "Outperforming", "On Track", "Underperforming" ✓

### API Endpoints ✅ CREATED (but need smooth curves to work correctly)
- [x] `/api/performance/calculate-envelope`: Generate/update global curves ✓
- [x] `/api/performance/classify-video`: Calculate ratio & category for a video ✓
- [x] `/api/performance/channel-baseline`: Get channel's first-week median ✓
- [x] ⚠️ NOTE: These endpoints exist but will produce incorrect results until smooth curves are implemented

### Batch Processing
- [ ] Nightly job to calculate performance ratios for all videos
- [ ] Weekly job to refresh global envelope curves
- [ ] Lazy refresh on new snapshots (only affected videos)

## Phase 3: Dashboard & Visualization

### Performance Optimization
- [ ] Index performance_ratio and performance_category columns
- [ ] Create materialized view for channel baselines (refresh daily)
- [ ] Implement caching layer for envelope lookups

### UI/UX Design
- [ ] Design interactive controls:
  - [ ] Channel selector dropdown
  - [ ] Video comparison selector
  - [ ] Performance category filters
- [ ] Plan chart interactions (hover, zoom, selection)
- [ ] Design performance badges/indicators

### Chart Components (Recharts)
- [ ] Performance envelope chart:
  - [ ] Gray shaded area for 25th-75th percentile band
  - [ ] Individual video trajectories as lines
  - [ ] Hover tooltips showing performance ratio ("2.5x expected")
  - [ ] Color coding: Green (Outperforming), Gray (On Track), Red (Underperforming)
- [ ] Performance badges for video lists:
  - [ ] Show category + ratio (e.g., "Viral - 3.2x")
  - [ ] Color-coded backgrounds

### Dashboard Integration
- [ ] Add performance column to video tables
- [ ] Create performance filter dropdown
- [ ] Show last calculated timestamp

## Implementation Timeline

### Week 1: Foundation ✅ COMPLETED
1. [x] Create duration parsing utility function ✓
2. [x] Build Python script for global percentile calculation ✓  
3. [x] Create performance_envelopes table ✓
4. [x] Generate and validate curve shapes ✓
5. [x] **BONUS**: Fixed critical duration data extraction bug affecting 68% of videos ✓

### Week 2: Integration
1. [x] Add envelope columns to videos table ✓ (envelope_performance_ratio, envelope_performance_category)
2. [ ] Create API endpoints
3. [ ] Implement batch processing jobs
4. [ ] Build channel baseline queries

### Week 3: Dashboard
1. [ ] Create visualization components
2. [ ] Add performance badges
3. [ ] Deploy and monitor

## Key Implementation Details

### Bias Corrections
- [ ] Implement tier-based weighting (tier_weight = 1.0 / tier_median_views)
- [ ] Use square root weighting for snapshot frequency
- [ ] Apply trimmed statistics (exclude top/bottom 10%)

### Performance Categories (Ratio-Based)
NOTE: The report shows both ratio-based (line 106) and percentile-based (line 229) classifications. 
We're using ratio-based for simplicity and intuitive understanding:
- [ ] Viral: >3.0x expected views
- [ ] Outperforming: 1.5-3.0x
- [ ] On Track: 0.5-1.5x
- [ ] Underperforming: 0.2-0.5x
- [ ] Poor: <0.2x

### Calculation Formula
```
expected_views = effective_baseline × (envelope_p50[day] / envelope_p50[day_1])
performance_ratio = actual_views / expected_views
```

## Success Metrics
- [ ] Correctly identifies known viral videos (>3x expected)
- [ ] Early detection works by Day 1-3
- [ ] Sub-second performance classification queries
- [ ] Intuitive "2.5x expected" displays
- [x] Handles 165K+ videos without performance issues ✓ (proven with 366 curve generation)

## Current Status: Raw Data Complete, Curve Fitting Needed 🚧

**✅ PHASE 1 COMPLETE**: Raw percentile data successfully collected
- **366 raw percentile snapshots** generated from 480K+ view snapshots
- **Duration data fixed**: 97.1% coverage (161,113/165,925 videos)
- **Database ready**: performance_envelopes table populated, envelope columns added
- **⚠️ ISSUE**: Raw data shows impossible patterns (Day 90 < Day 30)

**🚧 BLOCKED AT PHASE 1.5**: Must implement smooth curve fitting
- Raw percentiles need transformation to monotonic growth curves
- Current data represents different video sets at each day
- API endpoints exist but will produce incorrect results
- Must implement curve fitting before proceeding to Phase 2

**📍 NEXT STEPS**: 
1. Implement smooth curve generation (Phase 1.5)
2. Update performance_envelopes table with smoothed data
3. Then proceed to API endpoints and batch processing

## Future Enhancements (Post-Launch)
- [ ] Format-specific curves (tutorial vs entertainment)
- [ ] Cross-channel comparison dashboards
- [ ] Predictive modeling for final video performance
- [ ] Integration with thumbnail/title A/B testing
- [ ] Export performance reports for creators

## Implementation Questions & 80/20 Answers

### Phase 1 (Foundation) - 80/20 Approach:
1. **Python Script**: Build as standalone first for rapid iteration, integrate core logic later
2. **Minimum Sample Size**: 30 videos minimum, but allow 10-29 with low confidence flag
3. **Store Debug Data**: Yes, but simple JSONB in a lightweight debug table with 30-day auto-cleanup

### Phase 2 (Integration) - 80/20 Approach:
1. **Batch Timing**: Trigger 30 min after view tracking + daily 3 AM fallback
2. **Expose SQL**: Yes, via authenticated `/api/performance/debug` endpoint 
3. **Version Curves**: Simple version tracking - keep current + previous only

### Phase 3 (Dashboard) - 80/20 Approach:
1. **Historical Performance**: Yes, but just sparkline showing ratio changes
2. **Manual Recalc**: Yes, with rate limiting (once per hour per video)
3. **Exports**: Simple CSV for current channel only, last 90 days

### What to Skip Initially (Add Later If Needed):
- Complex weighting algorithms (start with simple percentiles)
- Real-time updates (batch is fine)
- Cross-channel comparisons
- Predictive modeling
- A/B testing integration

This approach balances comprehensive functionality with practical implementation constraints.