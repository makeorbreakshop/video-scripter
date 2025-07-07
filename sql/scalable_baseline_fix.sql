-- SCALABLE SOLUTION: Rolling Baseline Calculation for Millions of Videos
-- This approach eliminates the need for batch processing loops

-- Step 1: Clean up shorts (they shouldn't have baselines)
UPDATE videos 
SET rolling_baseline_views = NULL 
WHERE is_youtube_short(duration, title, description);

-- Step 2: Create materialized view for efficient baseline calculation
DROP MATERIALIZED VIEW IF EXISTS video_performance_baselines;

CREATE MATERIALIZED VIEW video_performance_baselines AS
WITH channel_baselines AS (
  SELECT 
    v1.id as video_id,
    v1.channel_id,
    v1.published_at,
    COALESCE(
      AVG(v2.view_count) FILTER (
        WHERE v2.published_at < v1.published_at 
        AND v2.published_at >= v1.published_at - INTERVAL '1 year'
        AND NOT is_youtube_short(v2.duration, v2.title, v2.description)
        AND v2.view_count > 0
      ), 
      0
    )::INTEGER as rolling_baseline
  FROM videos v1
  LEFT JOIN videos v2 ON v1.channel_id = v2.channel_id
  WHERE NOT is_youtube_short(v1.duration, v1.title, v1.description)
  GROUP BY v1.id, v1.channel_id, v1.published_at
)
SELECT 
  video_id,
  channel_id,
  published_at,
  CASE 
    WHEN rolling_baseline > 0 THEN rolling_baseline 
    ELSE NULL 
  END as rolling_baseline_views
FROM channel_baselines;

-- Create indexes for performance
CREATE UNIQUE INDEX video_performance_baselines_video_id_idx ON video_performance_baselines(video_id);
CREATE INDEX video_performance_baselines_channel_id_idx ON video_performance_baselines(channel_id);

-- Step 3: Update main table from materialized view (single operation)
UPDATE videos 
SET rolling_baseline_views = vpb.rolling_baseline_views
FROM video_performance_baselines vpb
WHERE videos.id = vpb.video_id;

-- Step 4: Create function for incremental updates (for daily processing)
CREATE OR REPLACE FUNCTION update_baselines_incremental(days_back INTEGER DEFAULT 7)
RETURNS INTEGER AS $$
DECLARE
  updated_count INTEGER;
BEGIN
  -- Only recalculate baselines for recently added/modified videos
  WITH recent_video_baselines AS (
    SELECT 
      v1.id as video_id,
      COALESCE(
        AVG(v2.view_count) FILTER (
          WHERE v2.published_at < v1.published_at 
          AND v2.published_at >= v1.published_at - INTERVAL '1 year'
          AND NOT is_youtube_short(v2.duration, v2.title, v2.description)
          AND v2.view_count > 0
        ), 
        0
      )::INTEGER as rolling_baseline
    FROM videos v1
    LEFT JOIN videos v2 ON v1.channel_id = v2.channel_id
    WHERE v1.created_at >= NOW() - INTERVAL '1 day' * days_back
    AND NOT is_youtube_short(v1.duration, v1.title, v1.description)
    GROUP BY v1.id, v1.channel_id, v1.published_at
  )
  UPDATE videos 
  SET rolling_baseline_views = CASE 
    WHEN rvb.rolling_baseline > 0 THEN rvb.rolling_baseline 
    ELSE NULL 
  END
  FROM recent_video_baselines rvb
  WHERE videos.id = rvb.video_id;
  
  GET DIAGNOSTICS updated_count = ROW_COUNT;
  RETURN updated_count;
END;
$$ LANGUAGE plpgsql;

-- Step 5: Refresh materialized view after updates
REFRESH MATERIALIZED VIEW packaging_performance;

-- Verification query
SELECT 
  'Baseline Fix Verification' as description,
  COUNT(*) as total_videos,
  COUNT(*) FILTER (WHERE is_youtube_short(duration, title, description)) as shorts_count,
  COUNT(*) FILTER (WHERE rolling_baseline_views IS NOT NULL) as videos_with_baselines,
  COUNT(*) FILTER (WHERE rolling_baseline_views IS NOT NULL AND is_youtube_short(duration, title, description)) as shorts_with_baselines_should_be_zero,
  AVG(rolling_baseline_views) FILTER (WHERE rolling_baseline_views IS NOT NULL) as avg_baseline_all_longform
FROM videos;