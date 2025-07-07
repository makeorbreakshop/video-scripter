-- Fix packaging performance function to return correct channel averages
DROP FUNCTION IF EXISTS get_packaging_performance(text,text,text,text,text,text,integer,integer);

CREATE OR REPLACE FUNCTION get_packaging_performance(
  search_term TEXT DEFAULT '',
  competitor_filter TEXT DEFAULT 'all',
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
BEGIN
  -- Build date filter condition
  CASE date_filter
    WHEN '1week' THEN date_filter_condition := 'v.published_at >= NOW() - INTERVAL ''1 week''';
    WHEN '1month' THEN date_filter_condition := 'v.published_at >= NOW() - INTERVAL ''1 month''';
    WHEN '3months' THEN date_filter_condition := 'v.published_at >= NOW() - INTERVAL ''3 months''';
    WHEN '6months' THEN date_filter_condition := 'v.published_at >= NOW() - INTERVAL ''6 months''';
    WHEN '1year' THEN date_filter_condition := 'v.published_at >= NOW() - INTERVAL ''1 year''';
    ELSE date_filter_condition := 'TRUE';
  END CASE;
  
  -- Build performance filter condition
  CASE performance_filter
    WHEN 'high' THEN performance_filter_condition := 'v.rolling_baseline_views > 0 AND (v.view_count::float / v.rolling_baseline_views) >= 2.0';
    WHEN 'medium' THEN performance_filter_condition := 'v.rolling_baseline_views > 0 AND (v.view_count::float / v.rolling_baseline_views) >= 1.0 AND (v.view_count::float / v.rolling_baseline_views) < 2.0';
    WHEN 'low' THEN performance_filter_condition := 'v.rolling_baseline_views > 0 AND (v.view_count::float / v.rolling_baseline_views) < 1.0';
    ELSE performance_filter_condition := 'TRUE';
  END CASE;
  
  -- Build competitor filter condition
  CASE competitor_filter
    WHEN 'competitors' THEN competitor_filter_condition := 'v.is_competitor = true';
    WHEN 'mine' THEN competitor_filter_condition := 'v.is_competitor = false';
    WHEN 'user' THEN competitor_filter_condition := 'v.is_competitor = false';
    ELSE competitor_filter_condition := 'TRUE';
  END CASE;
  
  -- Build search condition
  IF search_term IS NOT NULL AND search_term != '' THEN
    search_condition := 'v.title ILIKE ''%' || search_term || '%''';
  ELSE
    search_condition := 'TRUE';
  END IF;
  
  -- Build sort condition
  CASE sort_by
    WHEN 'performance_ratio' THEN 
      IF sort_order = 'desc' THEN
        sort_condition := 'performance_ratio DESC NULLS LAST';
      ELSE
        sort_condition := 'performance_ratio ASC NULLS LAST';
      END IF;
    WHEN 'view_count' THEN sort_condition := 'view_count ' || sort_order;
    WHEN 'published_at' THEN sort_condition := 'published_at ' || sort_order;
    ELSE sort_condition := 'published_at DESC';
  END CASE;
  
  -- Execute query with proper channel averages
  RETURN QUERY EXECUTE format('
    WITH channel_averages AS (
      SELECT 
        channel_id,
        AVG(view_count)::INTEGER as overall_channel_avg
      FROM videos 
      WHERE duration IS NOT NULL 
        AND duration != ''P0D''
        AND duration != ''PT1M''
        AND duration !~ ''^PT[0-5]?[0-9]S$''
        AND published_at >= NOW() - INTERVAL ''1 year''
      GROUP BY channel_id
    ),
    filtered_videos AS (
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
        COALESCE(ca.overall_channel_avg, v.rolling_baseline_views) as channel_avg_views,
        COUNT(*) OVER() as total_count
      FROM videos v
      LEFT JOIN channel_averages ca ON ca.channel_id = v.channel_id
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
    page_limit,
    page_offset
  );
END;
$$ LANGUAGE plpgsql;