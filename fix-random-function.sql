-- Fix the random function to use a single random value
-- This prevents generating a new random() for each row which kills performance

CREATE OR REPLACE FUNCTION get_random_video_ids(
  p_outlier_score int DEFAULT 2,
  p_min_views int DEFAULT 1000,
  p_days_ago int DEFAULT 90,
  p_domain text DEFAULT NULL,
  p_sample_size int DEFAULT 500
)
RETURNS TABLE(video_id text)
LANGUAGE plpgsql AS
$$
DECLARE
  rand_threshold float := random();  -- Generate ONCE, use for all rows
BEGIN
  RETURN QUERY
  SELECT v.id
  FROM videos v
  WHERE v.temporal_performance_score >= p_outlier_score
    AND v.temporal_performance_score <= 100
    AND v.view_count >= p_min_views
    AND v.published_at >= NOW() - (p_days_ago || ' days')::interval
    AND v.is_short = false
    AND v.is_institutional = false
    AND (p_domain IS NULL OR v.topic_domain = p_domain)
    AND v.random_sort >= rand_threshold  -- Use the SAME value for all rows
  ORDER BY v.random_sort
  LIMIT p_sample_size;
END;
$$;