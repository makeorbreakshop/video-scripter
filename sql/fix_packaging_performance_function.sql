-- Fix packaging performance function with proper duration filtering
DROP FUNCTION IF EXISTS get_packaging_performance(text,text,text,text,text,text,integer,integer);

CREATE OR REPLACE FUNCTION get_packaging_performance(
  p_search TEXT DEFAULT '',
  p_sort_by TEXT DEFAULT 'performance_ratio',
  p_sort_order TEXT DEFAULT 'desc',
  p_performance_filter TEXT DEFAULT '',
  p_date_filter TEXT DEFAULT 'all',
  p_competitor_filter TEXT DEFAULT 'all',
  p_page INTEGER DEFAULT 1,
  p_limit INTEGER DEFAULT 24
)
RETURNS TABLE(
  id TEXT,
  title TEXT,
  view_count INTEGER,
  published_at TIMESTAMP WITH TIME ZONE,
  baseline_views INTEGER,
  performance_ratio DECIMAL(10,2),
  thumbnail_url TEXT,
  is_competitor BOOLEAN,
  channel_id TEXT,
  channel_avg_views INTEGER,
  total_count BIGINT
) AS $$
DECLARE
  date_filter_condition TEXT;
  performance_filter_condition TEXT;
  competitor_filter_condition TEXT;
  search_condition TEXT;
  sort_condition TEXT;
  offset_value INTEGER;
BEGIN
  -- Calculate offset
  offset_value := (p_page - 1) * p_limit;
  
  -- Build date filter condition
  CASE p_date_filter
    WHEN '1week' THEN date_filter_condition := 'v.published_at >= NOW() - INTERVAL ''1 week''';
    WHEN '1month' THEN date_filter_condition := 'v.published_at >= NOW() - INTERVAL ''1 month''';
    WHEN '3months' THEN date_filter_condition := 'v.published_at >= NOW() - INTERVAL ''3 months''';
    WHEN '6months' THEN date_filter_condition := 'v.published_at >= NOW() - INTERVAL ''6 months''';
    WHEN '1year' THEN date_filter_condition := 'v.published_at >= NOW() - INTERVAL ''1 year''';
    ELSE date_filter_condition := 'TRUE';
  END CASE;
  
  -- Build performance filter condition
  CASE p_performance_filter
    WHEN 'high' THEN performance_filter_condition := 'v.rolling_baseline_views > 0 AND (v.view_count::float / v.rolling_baseline_views) >= 2.0';
    WHEN 'medium' THEN performance_filter_condition := 'v.rolling_baseline_views > 0 AND (v.view_count::float / v.rolling_baseline_views) >= 1.0 AND (v.view_count::float / v.rolling_baseline_views) < 2.0';
    WHEN 'low' THEN performance_filter_condition := 'v.rolling_baseline_views > 0 AND (v.view_count::float / v.rolling_baseline_views) < 1.0';
    ELSE performance_filter_condition := 'TRUE';
  END CASE;
  
  -- Build competitor filter condition
  CASE p_competitor_filter
    WHEN 'competitors' THEN competitor_filter_condition := 'v.is_competitor = true';
    WHEN 'user' THEN competitor_filter_condition := 'v.is_competitor = false';
    ELSE competitor_filter_condition := 'TRUE';
  END CASE;
  
  -- Build search condition
  IF p_search IS NOT NULL AND p_search != '' THEN
    search_condition := 'v.title ILIKE ''%' || p_search || '%''';
  ELSE
    search_condition := 'TRUE';
  END IF;
  
  -- Build sort condition
  CASE p_sort_by
    WHEN 'performance_ratio' THEN 
      IF p_sort_order = 'desc' THEN
        sort_condition := 'performance_ratio DESC NULLS LAST';
      ELSE
        sort_condition := 'performance_ratio ASC NULLS LAST';
      END IF;
    WHEN 'view_count' THEN sort_condition := 'view_count ' || p_sort_order;
    WHEN 'published_at' THEN sort_condition := 'published_at ' || p_sort_order;
    ELSE sort_condition := 'published_at DESC';
  END CASE;
  
  -- Execute query with pre-calculated baselines and proper shorts filtering
  RETURN QUERY EXECUTE format('
    WITH filtered_videos AS (
      SELECT 
        v.id,
        v.title,
        v.view_count,
        v.published_at,
        v.rolling_baseline_views as baseline_views,
        CASE 
          WHEN v.rolling_baseline_views > 0 THEN 
            ROUND((v.view_count::float / v.rolling_baseline_views)::numeric, 2)
          ELSE NULL 
        END as performance_ratio,
        v.thumbnail_url,
        v.is_competitor,
        v.channel_id,
        v.rolling_baseline_views as channel_avg_views,
        COUNT(*) OVER() as total_count
      FROM videos v
      WHERE v.duration IS NOT NULL 
        AND v.duration != ''P0D''  -- Exclude invalid durations
        AND v.duration != ''PT1M''  -- Exclude 1-minute shorts
        AND v.duration !~ ''^PT[0-5]?[0-9]S$''  -- Exclude videos under 60 seconds
        AND %s  -- date filter
        AND %s  -- performance filter
        AND %s  -- competitor filter
        AND %s  -- search condition
    )
    SELECT 
      fv.id,
      fv.title,
      fv.view_count,
      fv.published_at,
      fv.baseline_views,
      fv.performance_ratio,
      fv.thumbnail_url,
      fv.is_competitor,
      fv.channel_id,
      fv.channel_avg_views,
      fv.total_count
    FROM filtered_videos fv
    ORDER BY %s
    LIMIT %s OFFSET %s',
    date_filter_condition,
    performance_filter_condition,
    competitor_filter_condition,
    search_condition,
    sort_condition,
    p_limit,
    offset_value
  );
END;
$$ LANGUAGE plpgsql;