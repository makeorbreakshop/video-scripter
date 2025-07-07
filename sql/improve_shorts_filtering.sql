-- Improved YouTube Shorts filtering with 2:01 duration threshold + hashtag detection
-- This replaces the current weak filtering with comprehensive detection

-- Function to extract total seconds from ISO 8601 duration
CREATE OR REPLACE FUNCTION extract_duration_seconds(duration TEXT)
RETURNS INTEGER AS $$
DECLARE
  hours INTEGER := 0;
  minutes INTEGER := 0;
  seconds INTEGER := 0;
  matches TEXT[];
BEGIN
  -- Handle NULL, empty, or invalid durations
  IF duration IS NULL OR duration = '' OR duration = 'P0D' THEN
    RETURN 0;
  END IF;
  
  -- Extract hours, minutes, seconds using regex
  -- Pattern matches: PT1H30M45S, PT30M45S, PT45S, PT1H, PT30M, etc.
  IF duration ~ '^PT(\d+H)?(\d+M)?(\d+S)?$' THEN
    SELECT regexp_matches(duration, '^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$') INTO matches;
    
    IF matches[1] IS NOT NULL THEN hours := matches[1]::INTEGER; END IF;
    IF matches[2] IS NOT NULL THEN minutes := matches[2]::INTEGER; END IF;
    IF matches[3] IS NOT NULL THEN seconds := matches[3]::INTEGER; END IF;
  END IF;
  
  RETURN hours * 3600 + minutes * 60 + seconds;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- Function to detect if video is likely a YouTube Short
CREATE OR REPLACE FUNCTION is_youtube_short(
  duration TEXT,
  title TEXT DEFAULT '',
  description TEXT DEFAULT ''
) RETURNS BOOLEAN AS $$
DECLARE
  duration_seconds INTEGER;
  combined_text TEXT;
BEGIN
  -- Duration check: <= 2 minutes 1 second (121 seconds)
  duration_seconds := extract_duration_seconds(duration);
  IF duration_seconds > 0 AND duration_seconds <= 121 THEN
    RETURN TRUE;
  END IF;
  
  -- Hashtag check: Look for #shorts, #short, #youtubeshorts (case insensitive)
  combined_text := LOWER(COALESCE(title, '') || ' ' || COALESCE(description, ''));
  IF combined_text ~ '\#shorts?\b' OR combined_text ~ '\#youtubeshorts?\b' THEN
    RETURN TRUE;
  END IF;
  
  RETURN FALSE;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- Update the packaging performance function to use improved shorts filtering
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
  
  -- Execute query with improved shorts filtering
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

-- Test the new filtering functions
SELECT 
  'Testing duration parsing...' as test_name,
  extract_duration_seconds('PT1M30S') as should_be_90,
  extract_duration_seconds('PT2M1S') as should_be_121,
  extract_duration_seconds('PT45S') as should_be_45,
  extract_duration_seconds('PT1H') as should_be_3600;

SELECT 
  'Testing shorts detection...' as test_name,
  is_youtube_short('PT45S', 'Test video', '') as should_be_true_duration,
  is_youtube_short('PT2M1S', 'Test video', '') as should_be_true_at_threshold,
  is_youtube_short('PT2M2S', 'Test video', '') as should_be_false_over_threshold,
  is_youtube_short('PT5M', 'Test #shorts video', '') as should_be_true_hashtag,
  is_youtube_short('PT5M', 'Regular video', '') as should_be_false_long_no_hashtag;

-- Show current shorts that would be filtered
SELECT 
  COUNT(*) as total_shorts_detected,
  COUNT(*) FILTER (WHERE extract_duration_seconds(duration) <= 121) as detected_by_duration,
  COUNT(*) FILTER (WHERE LOWER(title || ' ' || COALESCE(description, '')) ~ '\#shorts?\b') as detected_by_hashtag
FROM videos 
WHERE is_youtube_short(duration, title, description);