-- Add rolling baseline views column for pre-calculated performance baselines
ALTER TABLE videos ADD COLUMN rolling_baseline_views INTEGER;

-- Create index for efficient baseline calculations
CREATE INDEX IF NOT EXISTS idx_videos_channel_published 
ON videos(channel_id, published_at) 
WHERE published_at IS NOT NULL;

-- Create function to calculate rolling baselines for all videos
CREATE OR REPLACE FUNCTION calculate_rolling_baselines()
RETURNS TABLE(updated_count INTEGER) AS $$
BEGIN
  -- Update rolling baselines for all videos
  UPDATE videos 
  SET rolling_baseline_views = subq.rolling_avg
  FROM (
    SELECT 
      v1.id,
      COALESCE(AVG(v2.view_count), 0)::INTEGER as rolling_avg
    FROM videos v1
    LEFT JOIN videos v2 ON (
      v2.channel_id = v1.channel_id
      AND v2.published_at BETWEEN v1.published_at - INTERVAL '1 year'
                              AND v1.published_at - INTERVAL '1 day'
      AND v2.duration IS NOT NULL 
      AND v2.duration > 60  -- Exclude shorts
    )
    GROUP BY v1.id
  ) subq
  WHERE videos.id = subq.id;
  
  -- Return count of updated videos
  RETURN QUERY SELECT COUNT(*)::INTEGER FROM videos WHERE rolling_baseline_views IS NOT NULL;
END;
$$ LANGUAGE plpgsql;