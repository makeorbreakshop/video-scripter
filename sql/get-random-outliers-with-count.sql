-- Create an improved RPC function that returns both videos and accurate count
CREATE OR REPLACE FUNCTION get_random_outlier_videos_with_data(
  seed_value float,
  min_score float DEFAULT 1.5,
  days_back int DEFAULT 730,
  min_views int DEFAULT 100,
  domain_filter text DEFAULT NULL,
  page_limit int DEFAULT 20,
  page_offset int DEFAULT 0
) RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  total_videos BIGINT;
  video_results JSON;
BEGIN
  -- Set the seed for consistent random ordering
  PERFORM setseed(seed_value);
  
  -- First get the accurate total count with institutional filtering
  SELECT COUNT(*)
  INTO total_videos
  FROM videos v
  LEFT JOIN channels c ON v.channel_id = c.channel_id
  WHERE
    v.temporal_performance_score >= min_score
    AND v.temporal_performance_score <= 100
    AND v.published_at >= NOW() - INTERVAL '1 day' * days_back
    AND v.view_count >= min_views
    AND v.is_short = false
    AND (c.is_institutional = false OR c.is_institutional IS NULL)
    AND (domain_filter IS NULL OR v.topic_domain = domain_filter);
  
  -- Get the random videos
  SELECT JSON_AGG(video_data)
  INTO video_results
  FROM (
    SELECT
      JSON_BUILD_OBJECT(
        'id', v.id,
        'title', v.title,
        'channel_name', v.channel_name,
        'channel_id', v.channel_id,
        'thumbnail_url', v.thumbnail_url,
        'view_count', v.view_count,
        'temporal_performance_score', v.temporal_performance_score,
        'topic_domain', v.topic_domain,
        'topic_niche', v.topic_niche,
        'topic_micro', v.topic_micro,
        'llm_summary', v.llm_summary,
        'published_at', v.published_at
      ) as video_data
    FROM videos v
    LEFT JOIN channels c ON v.channel_id = c.channel_id
    WHERE
      v.temporal_performance_score >= min_score
      AND v.temporal_performance_score <= 100
      AND v.published_at >= NOW() - INTERVAL '1 day' * days_back
      AND v.view_count >= min_views
      AND v.is_short = false
      AND (c.is_institutional = false OR c.is_institutional IS NULL)
      AND (domain_filter IS NULL OR v.topic_domain = domain_filter)
    ORDER BY random()
    LIMIT page_limit
    OFFSET page_offset
  ) sub;
  
  -- Return both videos and accurate total count
  RETURN JSON_BUILD_OBJECT(
    'videos', video_results,
    'total', total_videos
  );
END;
$$;