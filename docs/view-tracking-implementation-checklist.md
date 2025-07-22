# View Tracking Implementation Checklist

## Overview
Implementation plan for a smart view tracking system that monitors video performance over time while staying within YouTube API quota limits. This system will track ~100,000 videos daily using batch API calls (2,000 API calls = 100,000 videos).

## Phase 1: Database Setup

### Database Migration
- [x] Run SQL migration script: `/sql/create_view_tracking_system.sql`
  - Created `view_snapshots` table for time-series data
  - Created `view_tracking_priority` table for tracking management
  - Created priority calculation functions
  - Created batch retrieval functions
  - Created triggers for automatic priority updates

### Initialize Data
- [x] Run `update_all_tracking_priorities()` function to categorize all 136k videos
  - Tier 1: 230 videos (new videos < 30 days and high performers)
  - Tier 2: 3,670 videos (medium-age videos 30-180 days)
  - Tier 3: 133,741 videos (older videos for baseline data)
- [x] Create initial snapshots from existing video data
  - Ran `/sql/initialize_view_snapshots.sql`
  - Created 137,641 initial snapshots
  - Used current `view_count` as baseline snapshot
  - Set `snapshot_date` to video's `import_date` (preserving actual capture date)
- [x] Verify priority distribution with query:
  ```sql
  SELECT priority_tier, COUNT(*), AVG(priority_score) 
  FROM view_tracking_priority 
  GROUP BY priority_tier;
  ```

## Phase 2: Worker Implementation

### Create View Tracking Worker
- [x] Create `/workers/view-tracking-worker.ts`
  - Created worker with ViewTrackingService integration
  - Set up node-cron for daily execution at 3 AM PT
  - Configured quota limits (2,000 API calls default = 100k videos)
  - Added manual execution options (--run-now, --initialize)

### Update Package.json
- [x] Add scripts:
  - `"worker:view-tracking": "dotenv -e .env -- tsx workers/view-tracking-worker.ts"`
  - `"worker:view-tracking:init": "dotenv -e .env -- tsx workers/view-tracking-worker.ts --initialize"`
  - `"worker:view-tracking:now": "dotenv -e .env -- tsx workers/view-tracking-worker.ts --run-now"`

### Worker Dashboard Integration
- [x] Add view tracking status to `/app/dashboard/youtube/worker/page.tsx`
- [x] Display:
  - Videos tracked today
  - API quota used
  - Priority tier distribution
  - Recent tracking jobs
  - Top velocity videos
  - Manual "Run Daily Tracking" button

## Phase 3: API Endpoints

### Monitoring Endpoint
- [x] Create `/app/api/view-tracking/stats/route.ts`
  - Return tracking statistics by tier
  - Show quota usage
  - Display recent snapshots
  - Added count_snapshots_by_date helper function

### Manual Trigger Endpoint
- [x] Create `/app/api/view-tracking/run/route.ts`
  - Created POST endpoint for manual execution with custom limits
  - Added job tracking in jobs table
  - Returns job ID for status monitoring
  - GET endpoint for checking job status

## Phase 4: Performance Score Updates (DEFERRED - Needs Historical Data)

**Note: This phase requires at least 1-2 weeks of snapshot data before implementation**

### Age-Adjusted Performance Calculation
- [ ] **WAIT FOR DATA**: Need multiple snapshots per video (7-14 days minimum)
- [ ] Create function to calculate performance using time-series data:
  ```sql
  CREATE OR REPLACE FUNCTION calculate_age_adjusted_performance(
    video_id TEXT
  ) RETURNS FLOAT
  ```
- [ ] Consider:
  - First week performance vs channel average
  - Growth velocity over time
  - Comparison to videos of similar age

### Update Existing Performance Calculations
- [ ] **WAIT FOR DATA**: Requires historical view snapshots
- [ ] Modify performance ratio calculations to use:
  - View snapshots for historical comparison
  - Age-appropriate benchmarks
  - Rolling averages instead of lifetime averages

## Phase 5: Materialized Views

### Create Performance Trends View
- [x] Run creation script for `video_performance_trends` materialized view
- [x] Includes:
  - Day 1, Week 1, Month 1 view counts (1,552, 2,517, 4,754 videos have milestone data)
  - Growth rates calculation
  - Current tracking status with priority tiers
  - Indexes on video_id and channel_id for performance

### Setup Refresh Schedule
- [x] Configure pg_cron job: `REFRESH MATERIALIZED VIEW video_performance_trends`
  - Created `/sql/setup_view_tracking_cron.sql`
  - Scheduled for daily refresh at 2 AM PT (10 AM UTC)

## Phase 6: Testing

### Initial Testing
- [x] Test with 10 videos across all tiers
- [x] Verified:
  - Tier distribution working correctly (5 Tier 1, 3 Tier 2, 2 Tier 3)
  - Priority scores calculated properly
  - Tracking frequencies set appropriately
  - get_videos_to_track() function returns correct videos

### Load Testing
- [ ] Run full batch of 100,000 videos
- [ ] Monitor:
  - Execution time
  - API quota usage
  - Database performance
  - Error rates

## Phase 7: Production Deployment

### Schedule Setup
- [ ] Manual daily trigger from dashboard (for now)
  - Add "Run Daily Tracking" button to dashboard
  - System will automatically determine which videos to track based on priorities
  - Later: automate with cron/scheduled jobs
- [ ] Configure to run after YouTube quota reset (midnight PT)
- [ ] Set up monitoring alerts for failures

### Data Retention
- [x] Create cleanup job for snapshots > 1 year old
  - Created `/sql/setup_snapshot_cleanup.sql`
  - Function `cleanup_old_view_snapshots()` with configurable retention
  - Logs cleanup results to jobs table
- [x] Schedule monthly execution
  - pg_cron job runs on 1st of each month at 3 AM UTC
- [x] Keep summary statistics before deletion
  - Function returns deleted count and date ranges for logging

## Phase 8: UI Updates

### Dashboard Enhancements
- [ ] Create view growth visualization component
- [ ] Add to video detail pages:
  - Growth chart over time
  - Performance relative to age cohort
  - Velocity indicators

### Analytics Pages
- [ ] Update `/app/dashboard/analytics` to use time-series data
- [ ] Show:
  - Channel performance trends
  - Video lifecycle patterns
  - Breakout detection

## Phase 9: Documentation

### Update CLAUDE.md
- [x] Add view tracking section explaining:
  - System architecture and overview
  - Priority tiers (1: Daily, 2: Every 3 days, 3: Weekly)
  - API quota usage (batch calls, 50 videos per call)
  - Maintenance procedures (pg_cron jobs, cleanup)
  - Worker commands and usage instructions

### Create Operational Guide
- [ ] Document:
  - How to adjust priority weights
  - Quota management strategies
  - Troubleshooting common issues
  - Manual intervention procedures

## Success Metrics

### System Health
- [ ] 95%+ of videos tracked on schedule
- [ ] < 2,500 API calls used daily for tracking
- [ ] < 5 minute execution time for 100k videos

### Data Quality
- [ ] New videos have performance data within 24 hours
- [ ] High-value videos tracked daily
- [ ] Historical trends available for 90%+ of videos

### Business Impact
- [ ] More accurate performance scores for new videos
- [ ] Early detection of viral content
- [ ] Better understanding of video lifecycle patterns

## Notes

- The system is designed to be self-managing with automatic priority adjustments
- Batch API calls (50 videos per call) maximize quota efficiency
- Time-series data enables sophisticated performance analysis
- Priority tiers ensure important videos are tracked frequently