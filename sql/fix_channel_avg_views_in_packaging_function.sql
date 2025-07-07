-- Fix the get_packaging_performance function to return actual channel averages instead of individual rolling baselines
-- Issue: The function was returning v.rolling_baseline_views as channel_avg_views, but this is the individual video's baseline
-- Fix: Calculate proper channel averages from all videos in each channel (excluding shorts)

CREATE OR REPLACE FUNCTION public.get_packaging_performance(search_term text DEFAULT ''::text, competitor_filter text DEFAULT 'all'::text, date_filter text DEFAULT 'all'::text, performance_filter text DEFAULT ''::text, sort_by text DEFAULT 'performance_ratio'::text, sort_order text DEFAULT 'desc'::text, page_limit integer DEFAULT 24, page_offset integer DEFAULT 0)
 RETURNS TABLE(id text, title text, view_count integer, published_at timestamp with time zone, baseline_views integer, performance_ratio numeric, thumbnail_url text, is_competitor boolean, channel_id text, channel_name text, channel_avg_views integer, total_count bigint)
 LANGUAGE plpgsql
AS $function$
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
  
  -- Execute query with proper channel averages calculated
  RETURN QUERY EXECUTE format('
    WITH channel_averages AS (
      SELECT 
        channel_name,
        ROUND(AVG(view_count))::integer as channel_avg_views
      FROM videos 
      WHERE NOT is_youtube_short(duration, title, description)
      GROUP BY channel_name
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
        COALESCE(v.channel_name, ''Unknown Channel'') as channel_name,
        COALESCE(ca.channel_avg_views, 0) as channel_avg_views,
        COUNT(*) OVER() as total_count
      FROM videos v
      LEFT JOIN channel_averages ca ON v.channel_name = ca.channel_name
      WHERE NOT is_youtube_short(v.duration, v.title, v.description)  -- Exclude shorts
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
      fv.channel_name,
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
$function$;