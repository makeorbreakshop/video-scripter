-- Version with random starting point for different results each call
CREATE OR REPLACE FUNCTION get_random_video_ids(
  p_outlier_score int DEFAULT 2,
  p_min_views int DEFAULT 1000,
  p_days_ago int DEFAULT 90,
  p_domain text DEFAULT NULL,
  p_sample_size int DEFAULT 500
)
RETURNS TABLE(video_id text)
LANGUAGE sql AS
$$
  SELECT id
  FROM videos
  WHERE temporal_performance_score >= p_outlier_score
    AND temporal_performance_score <= 100
    AND view_count >= p_min_views
    AND published_at >= NOW() - (p_days_ago || ' days')::interval
    AND is_short = false
    AND is_institutional = false
    AND (p_domain IS NULL OR topic_domain = p_domain)
    AND random_sort >= random()  -- Random starting point
  ORDER BY random_sort
  LIMIT p_sample_size;
$$;