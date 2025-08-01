-- Optimize View Tracking Performance with Critical Indexes
-- These indexes address the timeout issues in the view tracking system

-- 1. Composite index for tier-based queries with date filtering
-- This dramatically improves the main tracking query performance
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_view_tracking_priority_tier_date 
ON view_tracking_priority(priority_tier, next_track_date) 
INCLUDE (video_id, last_tracked)
WHERE next_track_date IS NOT NULL;

-- 2. Index for null next_track_date (videos never tracked)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_view_tracking_priority_null_date
ON view_tracking_priority(priority_tier)
WHERE next_track_date IS NULL;

-- 3. Optimize view_snapshots lookups for previous snapshot queries
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_view_snapshots_video_date_desc 
ON view_snapshots(video_id, snapshot_date DESC)
INCLUDE (view_count, like_count, comment_count);

-- 4. Index for today's snapshots (used in progress tracking)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_view_snapshots_date_video
ON view_snapshots(snapshot_date, video_id);

-- 5. Optimize videos table for published_at ordering
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_videos_published_desc 
ON videos(published_at DESC) 
WHERE published_at IS NOT NULL;

-- 6. Composite index for video joins with view tracking
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_videos_id_published_views
ON videos(id, published_at, view_count)
WHERE published_at IS NOT NULL;

-- 7. Index for jobs table status queries
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_jobs_type_status_created
ON jobs(type, status, created_at DESC)
WHERE type = 'view_tracking';

-- 8. Analyze tables to update statistics
ANALYZE view_tracking_priority;
ANALYZE view_snapshots;
ANALYZE videos;
ANALYZE jobs;

-- Check index usage after creation
SELECT 
    schemaname,
    tablename,
    indexname,
    idx_scan,
    idx_tup_read,
    idx_tup_fetch,
    pg_size_pretty(pg_relation_size(indexrelid)) as index_size
FROM pg_stat_user_indexes
WHERE schemaname = 'public'
AND tablename IN ('view_tracking_priority', 'view_snapshots', 'videos', 'jobs')
ORDER BY idx_scan DESC;