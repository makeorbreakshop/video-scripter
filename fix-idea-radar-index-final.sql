-- Fix Idea Radar Performance Once and For All
-- The missing piece: is_institutional filter was not in the index!

-- Drop old incomplete indexes
DROP INDEX IF EXISTS idx_videos_outlier_query;
DROP INDEX IF EXISTS idx_videos_temporal_performance;

-- Create the CORRECT index that includes ALL filter conditions
CREATE INDEX CONCURRENTLY idx_videos_idea_radar_final ON videos(
  temporal_performance_score DESC,
  published_at DESC, 
  view_count DESC
) WHERE 
  is_short = false 
  AND is_institutional = false 
  AND temporal_performance_score >= 1
  AND temporal_performance_score <= 100;

-- This index will allow PostgreSQL to:
-- 1. Skip all institutional videos (was causing the slowdown!)
-- 2. Skip all shorts
-- 3. Only scan videos in the performance range
-- 4. Return them in heap order (no sorting needed)