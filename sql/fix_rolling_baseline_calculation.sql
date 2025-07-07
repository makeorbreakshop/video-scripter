-- Fix rolling baseline calculation function with proper duration parsing
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
      AND v2.duration != 'P0D'  -- Exclude invalid durations
      AND v2.duration != 'PT1M'  -- Exclude 1-minute shorts
      AND v2.duration !~ '^PT[0-5]?[0-9]S$'  -- Exclude videos under 60 seconds
    )
    GROUP BY v1.id
  ) subq
  WHERE videos.id = subq.id;
  
  -- Return count of updated videos
  RETURN QUERY SELECT COUNT(*)::INTEGER FROM videos WHERE rolling_baseline_views IS NOT NULL;
END;
$$ LANGUAGE plpgsql;

-- Also create helper function to check if video is a short
CREATE OR REPLACE FUNCTION is_video_short(duration_text TEXT)
RETURNS BOOLEAN AS $$
BEGIN
  IF duration_text IS NULL OR duration_text = 'P0D' THEN
    RETURN TRUE;
  END IF;
  
  -- Check for explicit short patterns
  IF duration_text ~ '^PT[0-5]?[0-9]S$' THEN -- Under 60 seconds
    RETURN TRUE;
  END IF;
  
  IF duration_text = 'PT1M' THEN -- Exactly 1 minute
    RETURN TRUE;
  END IF;
  
  RETURN FALSE;
END;
$$ LANGUAGE plpgsql;