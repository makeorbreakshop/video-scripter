-- Optimized random video selection using pre-computed random_sort column
-- This approach is simpler and more performant

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
  -- Get 2x the requested sample size to ensure we have enough after filtering
  -- The random_sort column provides the randomization
  SELECT id
  FROM videos
  WHERE temporal_performance_score >= p_outlier_score
    AND temporal_performance_score <= 100
    AND view_count >= p_min_views
    AND published_at >= NOW() - (p_days_ago || ' days')::interval
    AND is_short = false
    AND is_institutional = false
    AND (p_domain IS NULL OR topic_domain = p_domain)
  ORDER BY random_sort
  LIMIT p_sample_size;
$$;