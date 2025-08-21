-- Fast random video selection using random threshold technique
-- This avoids sorting ALL rows by using a random filter instead

CREATE OR REPLACE FUNCTION public.get_random_outlier_videos_with_data(
  seed_value double precision,
  min_score double precision DEFAULT 1.5,
  days_back integer DEFAULT 730,
  min_views integer DEFAULT 100,
  domain_filter text DEFAULT NULL,
  page_limit integer DEFAULT 20,
  page_offset integer DEFAULT 0
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  approx_count BIGINT;
  video_results JSON;
  random_threshold DOUBLE PRECISION;
  attempts INTEGER := 0;
  max_attempts INTEGER := 10;
BEGIN
  -- Set the seed for consistent random ordering
  PERFORM setseed(seed_value);
  
  -- Fast count without JOIN
  SELECT COUNT(*) INTO approx_count
  FROM videos v
  WHERE
    v.temporal_performance_score >= min_score
    AND v.temporal_performance_score <= 100
    AND v.published_at >= NOW() - INTERVAL '1 day' * days_back
    AND v.view_count >= min_views
    AND v.is_short = false
    AND (domain_filter IS NULL OR v.topic_domain = domain_filter);
  
  -- Use random sampling technique for large datasets
  -- Instead of ORDER BY random(), we filter by a random threshold
  LOOP
    attempts := attempts + 1;
    
    -- Start with a reasonable threshold based on desired rows vs total
    IF attempts = 1 THEN
      random_threshold := LEAST(0.1, (page_limit * 3.0) / GREATEST(approx_count, 1));
    ELSE
      -- Increase threshold if we didn't get enough rows
      random_threshold := random_threshold * 2;
    END IF;
    
    -- Get videos using random threshold (much faster than ORDER BY random())
    WITH random_sample AS (
      SELECT
        v.id,
        v.title,
        v.channel_name,
        v.channel_id,
        v.thumbnail_url,
        v.view_count,
        v.temporal_performance_score,
        v.topic_domain,
        v.topic_niche,
        v.topic_micro,
        v.llm_summary,
        v.published_at,
        c.is_institutional
      FROM videos v
      LEFT JOIN channels c ON v.channel_id = c.channel_id
      WHERE
        v.temporal_performance_score >= min_score
        AND v.temporal_performance_score <= 100
        AND v.published_at >= NOW() - INTERVAL '1 day' * days_back
        AND v.view_count >= min_views
        AND v.is_short = false
        AND (domain_filter IS NULL OR v.topic_domain = domain_filter)
        AND random() < random_threshold  -- Random filter instead of ORDER BY
      LIMIT page_limit * 2  -- Get extra in case some are institutional
    )
    SELECT JSON_AGG(video_data)
    INTO video_results
    FROM (
      SELECT
        JSON_BUILD_OBJECT(
          'id', id,
          'title', title,
          'channel_name', channel_name,
          'channel_id', channel_id,
          'thumbnail_url', thumbnail_url,
          'view_count', view_count,
          'temporal_performance_score', temporal_performance_score,
          'topic_domain', topic_domain,
          'topic_niche', topic_niche,
          'topic_micro', topic_micro,
          'llm_summary', llm_summary,
          'published_at', published_at
        ) as video_data
      FROM random_sample
      WHERE (is_institutional = false OR is_institutional IS NULL)
      ORDER BY random()  -- Small sort on filtered subset
      LIMIT page_limit
      OFFSET page_offset
    ) sub;
    
    -- Exit if we got enough videos or tried too many times
    EXIT WHEN (video_results IS NOT NULL AND 
               JSON_ARRAY_LENGTH(video_results) >= LEAST(page_limit, 10))
           OR attempts >= max_attempts
           OR random_threshold >= 1.0;
  END LOOP;
  
  -- Return videos with approximate count
  RETURN JSON_BUILD_OBJECT(
    'videos', COALESCE(video_results, '[]'::json),
    'total', approx_count,
    'is_approximate', true
  );
END;
$$;