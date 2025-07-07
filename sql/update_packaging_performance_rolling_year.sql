-- Update the get_packaging_performance function to use rolling year baseline
-- This implements the simplified approach where each video is compared to the previous year of videos from that channel

CREATE OR REPLACE FUNCTION get_packaging_performance(
  search_term TEXT DEFAULT '',
  competitor_filter TEXT DEFAULT 'mine',
  date_filter TEXT DEFAULT 'all',
  performance_filter TEXT DEFAULT '',
  sort_by TEXT DEFAULT 'performance_ratio',
  sort_order TEXT DEFAULT 'desc',
  page_limit INTEGER DEFAULT 24,
  page_offset INTEGER DEFAULT 0
)
RETURNS TABLE(
  id TEXT,
  title TEXT,
  view_count INTEGER,
  published_at TIMESTAMP WITH TIME ZONE,
  thumbnail_url TEXT,
  is_competitor BOOLEAN,
  channel_id TEXT,
  performance_ratio NUMERIC,
  channel_avg_views INTEGER,
  total_count BIGINT
) LANGUAGE plpgsql AS $$
BEGIN
  RETURN QUERY EXECUTE format('
    WITH channel_baselines AS (
      SELECT 
        target.id as video_id,
        target.channel_id,
        target.published_at,
        AVG(historical.view_count) as rolling_avg,
        COUNT(historical.id) as historical_count
      FROM videos target
      LEFT JOIN videos historical ON (
        historical.channel_id = target.channel_id
        AND historical.published_at BETWEEN 
          target.published_at - INTERVAL ''1 year''
          AND target.published_at - INTERVAL ''1 day''
        AND historical.view_count IS NOT NULL
        AND historical.view_count > 0
        AND NOT (
          (historical.title ILIKE ''%%#shorts%%'') OR
          (historical.description ILIKE ''%%#shorts%%'') OR
          (historical.metadata->>''tags'' LIKE ''%%shorts%%'') OR
          (historical.duration IS NOT NULL AND (
            (historical.duration ~ ''^PT[1-5]?\\d+S$'' AND CAST(SUBSTRING(historical.duration 
FROM ''PT(\\d+)S'') AS INTEGER) < 90) OR
            (historical.duration = ''PT1M'') OR
            (historical.duration ~ ''^PT1M[1-2]?\\d*S$'' AND 
CAST(COALESCE(SUBSTRING(historical.duration FROM ''M(\\d+)S''), ''0'') AS INTEGER) <= 30)
          ))
        )
      )
      GROUP BY target.id, target.channel_id, target.published_at
    ),
    video_performance AS (
      SELECT 
        v.id,
        v.title,
        v.view_count,
        v.published_at,
        v.thumbnail_url,
        v.is_competitor,
        v.channel_id,
        CASE 
          WHEN cb.rolling_avg > 0 THEN ROUND((v.view_count::NUMERIC / cb.rolling_avg), 4)
          ELSE NULL  -- No baseline available for brand new channels
        END as performance_ratio,
        COALESCE(cb.rolling_avg::INTEGER, 0) as channel_avg_views,
        cb.historical_count
      FROM videos v
      LEFT JOIN channel_baselines cb ON v.id = cb.video_id
      WHERE v.view_count IS NOT NULL 
        AND v.view_count > 0
        AND NOT (
          (v.title ILIKE ''%%#shorts%%'') OR
          (v.description ILIKE ''%%#shorts%%'') OR
          (v.metadata->>''tags'' LIKE ''%%shorts%%'') OR
          (v.duration IS NOT NULL AND (
            (v.duration ~ ''^PT[1-5]?\\d+S$'' AND CAST(SUBSTRING(v.duration 
FROM ''PT(\\d+)S'') AS INTEGER) < 90) OR
            (v.duration = ''PT1M'') OR
            (v.duration ~ ''^PT1M[1-2]?\\d*S$'' AND 
CAST(COALESCE(SUBSTRING(v.duration FROM ''M(\\d+)S''), ''0'') AS INTEGER) <= 30)
          ))
        )
        %s %s %s
    ),
    filtered_performance AS (
      SELECT *,
             COUNT(*) OVER() as total_count
      FROM video_performance
      WHERE 1=1 %s
    )
    SELECT 
      fp.id,
      fp.title,
      fp.view_count,
      fp.published_at,
      fp.thumbnail_url,
      fp.is_competitor,
      fp.channel_id,
      fp.performance_ratio,
      fp.channel_avg_views,
      fp.total_count
    FROM filtered_performance fp
    ORDER BY %s
    LIMIT %s OFFSET %s
  ',
  -- Competitor filter
  CASE
    WHEN competitor_filter = 'mine' THEN 'AND v.is_competitor = false AND v.channel_id = ''Make or Break Shop'''
    WHEN competitor_filter = 'competitors' THEN 'AND v.is_competitor = true'
    ELSE ''
  END,
  -- Date filter  
  CASE
    WHEN date_filter = '30days' THEN 'AND v.published_at >= NOW() - INTERVAL ''30 days'''
    WHEN date_filter = '3months' THEN 'AND v.published_at >= NOW() - INTERVAL ''3 months'''
    WHEN date_filter = '6months' THEN 'AND v.published_at >= NOW() - INTERVAL ''6 months'''
    WHEN date_filter = '1year' THEN 'AND v.published_at >= NOW() - INTERVAL ''1 year'''
    ELSE ''
  END,
  -- Search filter
  CASE
    WHEN search_term != '' THEN 'AND v.title ILIKE ''%' || search_term || '%'''
    ELSE ''
  END,
  -- Performance filter (handle NULL performance ratios for new channels)
  CASE
    WHEN performance_filter = 'excellent' THEN 'AND performance_ratio >= 2.0'
    WHEN performance_filter = 'good' THEN 'AND performance_ratio >= 1.0 AND performance_ratio < 2.0'
    WHEN performance_filter = 'average' THEN 'AND performance_ratio >= 0.5 AND performance_ratio < 1.0'
    WHEN performance_filter = 'poor' THEN 'AND performance_ratio < 0.5'
    ELSE ''
  END,
  -- Sort order (handle NULL performance ratios for new channels)
  CASE
    WHEN sort_by = 'performance_ratio' THEN 'fp.performance_ratio ' || sort_order || ' NULLS LAST'
    WHEN sort_by = 'view_count' THEN 'fp.view_count ' || sort_order
    WHEN sort_by = 'published_at' THEN 'fp.published_at ' || sort_order
    WHEN sort_by = 'title' THEN 'fp.title ' || sort_order
    ELSE 'fp.performance_ratio DESC NULLS LAST'
  END,
  page_limit,
  page_offset
  );
END;
$$;

-- Test the function with a sample query
-- SELECT * FROM get_packaging_performance('', 'mine', 'all', '', 'performance_ratio', 'desc', 5, 0);