# YouTube Daily Analytics Rebuild TODO

## Overview
Complete rebuild of the daily_analytics table and collection system to capture ALL available YouTube Analytics API metrics in a single API call per video per day.

## Current State Analysis
- ✅ Existing table has 48 columns but many don't match actual API metrics
- ✅ Current system makes 2 API calls per video (inefficient)
- ✅ Rate limiting system is robust with adaptive batching
- ✅ Token refresh functionality exists
- ❌ Missing key metrics like `engagedViews`, `redViews`, `playbackBasedCpm`
- ❌ Some columns exist that aren't real API metrics (`impressions`, `search_views`, etc.)

## Phase 1: Database Schema Redesign

### 1.1 Drop and Recreate daily_analytics Table
- [x] Backup existing data (optional - current data is incomplete)
- [x] Drop current daily_analytics table
- [x] Create new table with comprehensive schema matching ALL available API metrics

### 1.2 New Schema Design (Based on YouTube Analytics API Documentation)

**Core Identity:**
- [x] `id` (uuid, primary key)
- [x] `video_id` (text, not null)
- [x] `date` (date, not null)
- [x] `created_at` (timestamp with time zone)
- [x] `updated_at` (timestamp with time zone)

**View Metrics:**
- [x] `views` (bigint) - Total video views
- [x] `engaged_views` (bigint) - Views lasting 4+ seconds
- [x] `red_views` (bigint) - Views by YouTube Premium members
- [x] `viewer_percentage` (double precision) - % of logged-in viewers

**Watch Time Metrics:**
- [x] `estimated_minutes_watched` (bigint) - Total minutes watched
- [x] `estimated_red_minutes_watched` (bigint) - Minutes by Premium members
- [x] `average_view_duration` (double precision) - Avg playback length (seconds)
- [x] `average_view_percentage` (double precision) - Avg % of video watched

**Engagement Metrics:**
- [x] `likes` (bigint) - Positive ratings
- [x] `dislikes` (bigint) - Negative ratings (deprecated but keep for historical)
- [x] `comments` (bigint) - Number of comments
- [x] `shares` (bigint) - Number of shares
- [x] `subscribers_gained` (bigint) - Subscribers acquired
- [x] `subscribers_lost` (bigint) - Subscribers lost
- [x] `videos_added_to_playlists` (bigint) - Times added to playlists
- [x] `videos_removed_from_playlists` (bigint) - Times removed from playlists

**Revenue Metrics:**
- [x] `estimated_revenue` (double precision) - Total net revenue
- [x] `estimated_ad_revenue` (double precision) - Google-sold ad revenue
- [x] `estimated_red_partner_revenue` (double precision) - Premium subscription revenue
- [x] `gross_revenue` (double precision) - Estimated gross ad revenue

**Ad Performance Metrics:**
- [x] `cpm` (double precision) - Revenue per thousand ad impressions
- [x] `playback_based_cpm` (double precision) - Revenue per thousand playbacks
- [x] `ad_impressions` (bigint) - Verified ad impressions
- [x] `monetized_playbacks` (bigint) - Instances with ad impressions

**Audience Retention (Advanced - may require separate calls):**
- [x] `audience_watch_ratio` (jsonb) - Viewer watching ratio data
- [x] `relative_retention_performance` (double precision) - Comparative retention

### 1.3 Create Table SQL
- [x] Write comprehensive CREATE TABLE statement
- [x] Add proper indexes (video_id, date, composite unique index)
- [x] Set up foreign key constraints if needed
- [x] Add RLS policies for security

## Phase 2: API Collection System Update

### 2.1 Update YouTube Analytics Daily Service
- [x] Modify `DailyAnalyticsData` interface to match new schema
- [x] Update metrics string to include compatible metrics in 2 API calls:
  - Core: `views,estimatedMinutesWatched,averageViewDuration,averageViewPercentage,likes,dislikes,comments,shares,subscribersGained,subscribersLost`
  - Revenue: `estimatedRevenue,estimatedAdRevenue`
- [x] Fixed API call approach (2 compatible calls vs 1 failed comprehensive call)
- [x] Update `transformAnalyticsResponse` to handle 2-call response structure
- [x] Update error handling for new metrics structure

### 2.2 Test API Call Approach
- [x] Test core + revenue metrics calls with sample videos
- [x] Verify all available metrics are returned correctly (324 views, $2.86 revenue confirmed)
- [x] Check quota usage (2 units per video - optimal for API restrictions)
- [x] Validate OAuth scopes cover all revenue metrics (working)

### 2.3 Update Database Integration
- [x] Remove `card_click_rate` column references from all API endpoints
- [x] Test API endpoints work with new schema (no column errors)
- [x] Verify data types and null handling

## Phase 3: Backfill Strategy Implementation

### 3.1 Rate Limiting Validation
- [ ] Current system targets ~8% of 720 queries/minute limit
- [ ] With single API call, this doubles our effective throughput
- [ ] Validate adaptive batching still works (2-8 videos per batch)
- [ ] Monitor rolling window query tracking

### 3.2 Backfill Execution Plan
- [ ] Start with 1-day test backfill (173 videos = 173 quota units)
- [ ] Validate data quality and completeness
- [ ] Expand to 1-week backfill
- [ ] Full historical backfill (target: 50+ days)

### 3.3 Progress Monitoring
- [ ] Existing progress tracking should work unchanged
- [ ] Monitor quota usage per video (target: 1 unit)
- [ ] Track success/failure rates
- [ ] Monitor rate limiting effectiveness

## Phase 4: Data Validation & Quality Assurance

### 4.1 Data Completeness Checks
- [ ] Verify all expected metrics are populated
- [ ] Check for null values in core metrics
- [ ] Validate revenue metrics access (requires monetary scope)
- [ ] Compare sample data against YouTube Studio for accuracy

### 4.2 Performance Validation
- [ ] Measure actual quota usage vs estimates
- [ ] Validate rate limiting prevents API throttling
- [ ] Check database insert performance with new schema
- [ ] Monitor overall backfill completion time

## Success Criteria

### Data Collection
- [ ] Single API call per video per day (1 quota unit vs current 2)
- [ ] ALL available YouTube Analytics metrics captured
- [ ] 100% successful backfill rate for available data
- [ ] Revenue metrics correctly populated with monetary scope

### Performance
- [ ] Rate limiting keeps usage under 10% of API limits
- [ ] Database performance remains fast with expanded schema
- [ ] Backfill completes historical data efficiently
- [ ] No API throttling or quota exceeded errors

### Data Quality
- [ ] All core metrics (views, watch time, engagement) populated
- [ ] Revenue data correctly captured where available
- [ ] Data matches YouTube Studio analytics for validation
- [ ] Proper handling of missing/null values for unavailable metrics

## Risk Mitigation

### API Limitations
- Some metrics may not be available for all videos/dates
- Revenue metrics require proper OAuth scopes
- Historical data may have different availability windows

### Database Impact
- Expanded schema increases storage requirements
- More columns may impact query performance
- Need proper indexing strategy

### Rate Limiting
- Single call approach should be safer, but monitor closely
- Have rollback plan if API throttling occurs
- Test token refresh during long backfill operations

## Implementation Notes

1. **Start Small**: Test with 1-2 videos before full backfill
2. **Monitor Continuously**: Watch quota usage and success rates
3. **Validate Early**: Compare sample data with YouTube Studio
4. **Document Issues**: Track any metrics that consistently fail
5. **Have Rollback Plan**: Keep current system available during testing

## Expected Benefits

- **50% quota reduction**: 1 API call vs 2 per video
- **Complete data capture**: All available YouTube Analytics metrics
- **Better analysis capability**: More comprehensive dataset
- **Simplified maintenance**: Single call reduces complexity
- **Future-proof**: Schema matches complete API capability