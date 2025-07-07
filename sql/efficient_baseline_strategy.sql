-- EFFICIENT BASELINE STRATEGY: O(n) instead of O(n²)
-- Instead of calculating rolling averages, use channel averages with time windows

-- Step 1: Create channel baseline table (one-time setup)
CREATE TABLE IF NOT EXISTS channel_performance_cache (
  channel_id TEXT PRIMARY KEY,
  avg_views_30d INTEGER,
  avg_views_90d INTEGER,
  avg_views_1yr INTEGER,
  video_count INTEGER,
  last_updated TIMESTAMPTZ DEFAULT NOW()
);

-- Step 2: Populate channel averages (fast, linear operation)
INSERT INTO channel_performance_cache (channel_id, avg_views_30d, avg_views_90d, avg_views_1yr, video_count)
SELECT 
  channel_id,
  AVG(view_count) FILTER (WHERE published_at >= NOW() - INTERVAL '30 days' AND NOT is_youtube_short(duration, title, description))::INTEGER,
  AVG(view_count) FILTER (WHERE published_at >= NOW() - INTERVAL '90 days' AND NOT is_youtube_short(duration, title, description))::INTEGER,
  AVG(view_count) FILTER (WHERE published_at >= NOW() - INTERVAL '1 year' AND NOT is_youtube_short(duration, title, description))::INTEGER,
  COUNT(*) FILTER (WHERE NOT is_youtube_short(duration, title, description))
FROM videos 
GROUP BY channel_id
ON CONFLICT (channel_id) DO UPDATE SET
  avg_views_30d = EXCLUDED.avg_views_30d,
  avg_views_90d = EXCLUDED.avg_views_90d,
  avg_views_1yr = EXCLUDED.avg_views_1yr,
  video_count = EXCLUDED.video_count,
  last_updated = NOW();

-- Step 3: Update videos with appropriate baseline (single join, very fast)
UPDATE videos 
SET rolling_baseline_views = CASE 
  WHEN cpc.avg_views_1yr > 0 THEN cpc.avg_views_1yr
  WHEN cpc.avg_views_90d > 0 THEN cpc.avg_views_90d
  WHEN cpc.avg_views_30d > 0 THEN cpc.avg_views_30d
  ELSE NULL
END
FROM channel_performance_cache cpc
WHERE videos.channel_id = cpc.channel_id
AND NOT is_youtube_short(videos.duration, videos.title, videos.description);

-- Step 4: Remove baselines from shorts
UPDATE videos 
SET rolling_baseline_views = NULL 
WHERE is_youtube_short(duration, title, description);

-- Step 5: Create daily update function (for incremental processing)
CREATE OR REPLACE FUNCTION refresh_baselines_daily()
RETURNS INTEGER AS $$
DECLARE
  updated_count INTEGER;
BEGIN
  -- Update channel cache for channels with new videos
  INSERT INTO channel_performance_cache (channel_id, avg_views_30d, avg_views_90d, avg_views_1yr, video_count)
  SELECT 
    channel_id,
    AVG(view_count) FILTER (WHERE published_at >= NOW() - INTERVAL '30 days' AND NOT is_youtube_short(duration, title, description))::INTEGER,
    AVG(view_count) FILTER (WHERE published_at >= NOW() - INTERVAL '90 days' AND NOT is_youtube_short(duration, title, description))::INTEGER,
    AVG(view_count) FILTER (WHERE published_at >= NOW() - INTERVAL '1 year' AND NOT is_youtube_short(duration, title, description))::INTEGER,
    COUNT(*) FILTER (WHERE NOT is_youtube_short(duration, title, description))
  FROM videos 
  WHERE created_at >= NOW() - INTERVAL '2 days'
  GROUP BY channel_id
  ON CONFLICT (channel_id) DO UPDATE SET
    avg_views_30d = EXCLUDED.avg_views_30d,
    avg_views_90d = EXCLUDED.avg_views_90d,
    avg_views_1yr = EXCLUDED.avg_views_1yr,
    video_count = EXCLUDED.video_count,
    last_updated = NOW();

  -- Update baselines for recent videos only
  UPDATE videos 
  SET rolling_baseline_views = CASE 
    WHEN cpc.avg_views_1yr > 0 THEN cpc.avg_views_1yr
    WHEN cpc.avg_views_90d > 0 THEN cpc.avg_views_90d
    WHEN cpc.avg_views_30d > 0 THEN cpc.avg_views_30d
    ELSE NULL
  END
  FROM channel_performance_cache cpc
  WHERE videos.channel_id = cpc.channel_id
  AND videos.created_at >= NOW() - INTERVAL '2 days'
  AND NOT is_youtube_short(videos.duration, videos.title, videos.description);

  GET DIAGNOSTICS updated_count = ROW_COUNT;
  RETURN updated_count;
END;
$$ LANGUAGE plpgsql;

-- Verification
SELECT 
  'Efficient Baseline Results' as description,
  COUNT(*) as total_videos,
  COUNT(*) FILTER (WHERE rolling_baseline_views IS NOT NULL) as videos_with_baselines,
  COUNT(*) FILTER (WHERE is_youtube_short(duration, title, description) AND rolling_baseline_views IS NOT NULL) as shorts_with_baselines_should_be_zero,
  AVG(rolling_baseline_views) FILTER (WHERE rolling_baseline_views IS NOT NULL) as avg_baseline
FROM videos;