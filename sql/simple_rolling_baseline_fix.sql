-- SIMPLE ROLLING BASELINE FIX
-- Skip index creation and focus on the core update

-- Step 1: Clear shorts baselines first
UPDATE videos 
SET rolling_baseline_views = NULL 
WHERE is_youtube_short(duration, title, description);

-- Step 2: Use the most efficient window function approach
-- This processes all videos in channel/date order efficiently
UPDATE videos 
SET rolling_baseline_views = subquery.rolling_baseline
FROM (
  SELECT 
    id,
    COALESCE(
      AVG(view_count) FILTER (
        WHERE rn_within_year > 0
      )::INTEGER,
      0
    ) as rolling_baseline
  FROM (
    SELECT 
      id,
      view_count,
      published_at,
      channel_id,
      -- Count how many videos this channel published in the year before this video
      COUNT(*) FILTER (
        WHERE lag_published_at < published_at 
        AND lag_published_at >= published_at - INTERVAL '1 year'
        AND NOT lag_is_short
        AND lag_view_count > 0
      ) OVER (
        PARTITION BY channel_id 
        ORDER BY published_at 
        ROWS UNBOUNDED PRECEDING
      ) as rn_within_year,
      -- Get the average of previous year's videos
      AVG(lag_view_count) FILTER (
        WHERE lag_published_at < published_at 
        AND lag_published_at >= published_at - INTERVAL '1 year'
        AND NOT lag_is_short
        AND lag_view_count > 0
      ) OVER (
        PARTITION BY channel_id 
        ORDER BY published_at 
        ROWS UNBOUNDED PRECEDING
      ) as rolling_baseline_calc
    FROM (
      SELECT 
        id,
        view_count,
        published_at,
        channel_id,
        LAG(published_at) OVER (PARTITION BY channel_id ORDER BY published_at) as lag_published_at,
        LAG(view_count) OVER (PARTITION BY channel_id ORDER BY published_at) as lag_view_count,
        LAG(is_youtube_short(duration, title, description)) OVER (PARTITION BY channel_id ORDER BY published_at) as lag_is_short
      FROM videos 
      WHERE NOT is_youtube_short(duration, title, description)
      ORDER BY channel_id, published_at
    ) windowed_data
  ) calculated_data
  GROUP BY id, rolling_baseline_calc
) subquery
WHERE videos.id = subquery.id
AND subquery.rolling_baseline > 0;