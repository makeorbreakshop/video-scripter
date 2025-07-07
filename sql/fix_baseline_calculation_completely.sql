-- Fix the baseline calculation function completely
CREATE OR REPLACE FUNCTION calculate_rolling_baselines()
RETURNS TABLE(updated_count INTEGER) AS $$
BEGIN
  -- Update rolling baselines for all videos with proper calculation
  UPDATE videos 
  SET rolling_baseline_views = subq.rolling_avg
  FROM (
    SELECT 
      v1.id,
      CASE 
        WHEN COUNT(v2.id) > 0 THEN AVG(v2.view_count)::INTEGER
        ELSE 0
      END as rolling_avg
    FROM videos v1
    LEFT JOIN videos v2 ON (
      v2.channel_id = v1.channel_id
      AND v2.published_at BETWEEN v1.published_at - INTERVAL '1 year'
                              AND v1.published_at - INTERVAL '1 day'
      AND v2.is_competitor = v1.is_competitor  -- Match competitor status
    )
    GROUP BY v1.id
  ) subq
  WHERE videos.id = subq.id;
  
  -- Return count of updated videos
  RETURN QUERY SELECT COUNT(*)::INTEGER FROM videos WHERE rolling_baseline_views IS NOT NULL;
END;
$$ LANGUAGE plpgsql;

-- Recalculate all baselines
SELECT calculate_rolling_baselines();