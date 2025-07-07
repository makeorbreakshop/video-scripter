-- SCALABLE ROLLING BASELINE CALCULATION
-- Maintains true rolling averages while being efficient for millions of videos

-- Step 1: Create optimized indexes for performance
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_videos_channel_published_perf 
ON videos (channel_id, published_at) 
WHERE NOT is_youtube_short(duration, title, description);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_videos_published_channel_views 
ON videos (published_at, channel_id, view_count) 
WHERE NOT is_youtube_short(duration, title, description);

-- Step 2: Use a CTE-based approach with partitioning for efficiency
WITH video_baselines AS (
  SELECT 
    v.id,
    v.channel_id,
    v.published_at,
    -- Calculate rolling average using window function over previous year
    AVG(prev.view_count) OVER (
      PARTITION BY v.channel_id 
      ORDER BY v.published_at 
      RANGE BETWEEN INTERVAL '1 year' PRECEDING AND INTERVAL '1 day' PRECEDING
    ) as rolling_baseline
  FROM videos v
  LEFT JOIN videos prev ON (
    prev.channel_id = v.channel_id 
    AND prev.published_at < v.published_at 
    AND prev.published_at >= v.published_at - INTERVAL '1 year'
    AND NOT is_youtube_short(prev.duration, prev.title, prev.description)
    AND prev.view_count > 0
  )
  WHERE NOT is_youtube_short(v.duration, v.title, v.description)
)
UPDATE videos 
SET rolling_baseline_views = CASE 
  WHEN vb.rolling_baseline > 0 THEN vb.rolling_baseline::INTEGER
  ELSE NULL 
END
FROM video_baselines vb
WHERE videos.id = vb.id;

-- Step 3: Alternative approach using recursive CTE for better performance
-- This processes videos chronologically, building baselines incrementally
WITH RECURSIVE baseline_calculation AS (
  -- Base case: earliest videos per channel
  SELECT 
    id, 
    channel_id, 
    published_at, 
    view_count,
    NULL::INTEGER as rolling_baseline,
    ROW_NUMBER() OVER (PARTITION BY channel_id ORDER BY published_at) as rn
  FROM videos 
  WHERE NOT is_youtube_short(duration, title, description)
  
  UNION ALL
  
  -- Recursive case: calculate baseline from previous videos
  SELECT 
    v.id,
    v.channel_id,
    v.published_at,
    v.view_count,
    CASE 
      WHEN COUNT(bc.view_count) OVER (
        PARTITION BY v.channel_id 
        ORDER BY v.published_at 
        RANGE BETWEEN INTERVAL '1 year' PRECEDING AND INTERVAL '1 day' PRECEDING
      ) > 0 
      THEN AVG(bc.view_count) OVER (
        PARTITION BY v.channel_id 
        ORDER BY v.published_at 
        RANGE BETWEEN INTERVAL '1 year' PRECEDING AND INTERVAL '1 day' PRECEDING
      )::INTEGER
      ELSE NULL
    END as rolling_baseline,
    ROW_NUMBER() OVER (PARTITION BY v.channel_id ORDER BY v.published_at) as rn
  FROM videos v
  JOIN baseline_calculation bc ON bc.channel_id = v.channel_id AND bc.published_at < v.published_at
  WHERE NOT is_youtube_short(v.duration, v.title, v.description)
  AND v.published_at <= bc.published_at + INTERVAL '1 year'
)
UPDATE videos 
SET rolling_baseline_views = bc.rolling_baseline
FROM baseline_calculation bc
WHERE videos.id = bc.id;

-- Step 4: Most efficient approach - pre-sorted update with window functions
-- This avoids joins by using ordered processing
UPDATE videos 
SET rolling_baseline_views = baseline_calc.rolling_baseline
FROM (
  SELECT 
    id,
    LAG(
      AVG(view_count) OVER (
        PARTITION BY channel_id 
        ORDER BY published_at 
        ROWS BETWEEN 365 PRECEDING AND 1 PRECEDING
      )
    ) OVER (PARTITION BY channel_id ORDER BY published_at) as rolling_baseline
  FROM videos 
  WHERE NOT is_youtube_short(duration, title, description)
  ORDER BY channel_id, published_at
) baseline_calc
WHERE videos.id = baseline_calc.id
AND baseline_calc.rolling_baseline > 0;

-- Step 5: Clear baselines for shorts
UPDATE videos 
SET rolling_baseline_views = NULL 
WHERE is_youtube_short(duration, title, description);

-- Step 6: Create function for incremental daily updates
CREATE OR REPLACE FUNCTION update_rolling_baselines_incremental(days_back INTEGER DEFAULT 1)
RETURNS INTEGER AS $$
DECLARE
  updated_count INTEGER;
BEGIN
  -- Only recalculate for videos published in the last X days
  -- This maintains rolling accuracy while being efficient
  
  UPDATE videos 
  SET rolling_baseline_views = baseline_calc.rolling_baseline
  FROM (
    SELECT 
      v.id,
      COALESCE(
        AVG(prev.view_count) FILTER (
          WHERE prev.published_at < v.published_at 
          AND prev.published_at >= v.published_at - INTERVAL '1 year'
          AND NOT is_youtube_short(prev.duration, prev.title, prev.description)
          AND prev.view_count > 0
        ),
        0
      )::INTEGER as rolling_baseline
    FROM videos v
    LEFT JOIN videos prev ON prev.channel_id = v.channel_id
    WHERE v.published_at >= NOW() - INTERVAL '1 day' * days_back
    AND NOT is_youtube_short(v.duration, v.title, v.description)
    GROUP BY v.id, v.channel_id, v.published_at
  ) baseline_calc
  WHERE videos.id = baseline_calc.id
  AND baseline_calc.rolling_baseline > 0;
  
  GET DIAGNOSTICS updated_count = ROW_COUNT;
  RETURN updated_count;
END;
$$ LANGUAGE plpgsql;

-- Verification query
SELECT 
  'Rolling Baseline Verification' as description,
  COUNT(*) as total_videos,
  COUNT(*) FILTER (WHERE rolling_baseline_views IS NOT NULL) as videos_with_baselines,
  COUNT(*) FILTER (WHERE is_youtube_short(duration, title, description) AND rolling_baseline_views IS NOT NULL) as shorts_with_baselines_should_be_zero,
  AVG(rolling_baseline_views) FILTER (WHERE rolling_baseline_views IS NOT NULL) as avg_rolling_baseline,
  MIN(rolling_baseline_views) FILTER (WHERE rolling_baseline_views IS NOT NULL) as min_baseline,
  MAX(rolling_baseline_views) FILTER (WHERE rolling_baseline_views IS NOT NULL) as max_baseline
FROM videos;