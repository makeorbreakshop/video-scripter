-- Final optimized function using index hints and better query structure

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
  rand_start float := random();
BEGIN
  -- Use a CTE to force index usage on random_sort first
  RETURN QUERY
  WITH random_candidates AS (
    -- First: Use the random_sort index to get a random slice
    SELECT id, temporal_performance_score, view_count, published_at, 
           is_short, is_institutional, topic_domain
    FROM videos
    WHERE random_sort >= rand_start
    ORDER BY random_sort
    LIMIT p_sample_size * 10  -- Get more candidates to filter
  )
  -- Then: Apply filters on the smaller set
  SELECT id
  FROM random_candidates
  WHERE temporal_performance_score >= p_outlier_score
    AND temporal_performance_score <= 100
    AND view_count >= p_min_views
    AND published_at >= NOW() - (p_days_ago || ' days')::interval
    AND is_short = false
    AND is_institutional = false
    AND (p_domain IS NULL OR topic_domain = p_domain)
  LIMIT p_sample_size;
  
  -- If we didn't get enough results, wrap around to the beginning
  IF FOUND IS FALSE OR (SELECT COUNT(*) FROM (
    WITH random_candidates AS (
      SELECT id, temporal_performance_score, view_count, published_at, 
             is_short, is_institutional, topic_domain
      FROM videos
      WHERE random_sort >= rand_start
      ORDER BY random_sort
      LIMIT p_sample_size * 10
    )
    SELECT id
    FROM random_candidates
    WHERE temporal_performance_score >= p_outlier_score
      AND temporal_performance_score <= 100
      AND view_count >= p_min_views
      AND published_at >= NOW() - (p_days_ago || ' days')::interval
      AND is_short = false
      AND is_institutional = false
      AND (p_domain IS NULL OR topic_domain = p_domain)
    LIMIT p_sample_size
  ) t) < p_sample_size THEN
    -- Wrap around: get from beginning of random_sort
    RETURN QUERY
    WITH random_candidates AS (
      SELECT id, temporal_performance_score, view_count, published_at, 
             is_short, is_institutional, topic_domain
      FROM videos
      WHERE random_sort < rand_start
      ORDER BY random_sort
      LIMIT p_sample_size * 10
    )
    SELECT id
    FROM random_candidates
    WHERE temporal_performance_score >= p_outlier_score
      AND temporal_performance_score <= 100
      AND view_count >= p_min_views
      AND published_at >= NOW() - (p_days_ago || ' days')::interval
      AND is_short = false
      AND is_institutional = false
      AND (p_domain IS NULL OR topic_domain = p_domain)
    LIMIT p_sample_size;
  END IF;
END;
$$;