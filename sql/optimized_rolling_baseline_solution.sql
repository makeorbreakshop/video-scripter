-- OPTIMIZED ROLLING BASELINE SOLUTION
-- Combines several strategies for maximum efficiency

-- 1. Create a specialized index for the exact query pattern we need
CREATE INDEX IF NOT EXISTS idx_videos_channel_published_views 
ON videos (channel_id, published_at, view_count) 
WHERE NOT is_youtube_short(duration, title, description) AND view_count > 0;

-- 2. Create a materialized view for channel video timelines
-- This pre-computes the expensive part of the calculation
CREATE MATERIALIZED VIEW IF NOT EXISTS channel_video_timeline AS
SELECT 
  channel_id,
  published_at,
  view_count,
  -- Pre-compute the date range for each video
  published_at - INTERVAL '1 year' as baseline_start,
  published_at - INTERVAL '1 day' as baseline_end
FROM videos
WHERE NOT is_youtube_short(duration, title, description) 
AND view_count > 0
ORDER BY channel_id, published_at;

-- Create index on the materialized view for fast lookups
CREATE INDEX idx_timeline_channel_dates ON channel_video_timeline (channel_id, published_at);

-- 3. Create an efficient update function using the materialized view
CREATE OR REPLACE FUNCTION update_rolling_baselines_optimized()
RETURNS INTEGER AS $$
DECLARE
  batch_size INTEGER := 1000;
  updated_total INTEGER := 0;
  current_batch INTEGER;
BEGIN
  -- Process in batches to avoid memory issues
  LOOP
    -- Update a batch of videos
    WITH batch_updates AS (
      SELECT 
        v.id,
        COALESCE(
          AVG(timeline.view_count)::INTEGER,
          NULL
        ) as new_baseline
      FROM videos v
      LEFT JOIN channel_video_timeline timeline ON (
        timeline.channel_id = v.channel_id 
        AND timeline.published_at >= v.published_at - INTERVAL '1 year'
        AND timeline.published_at < v.published_at
      )
      WHERE v.rolling_baseline_views IS NULL -- Only process unprocessed videos
      AND NOT is_youtube_short(v.duration, v.title, v.description)
      GROUP BY v.id
      LIMIT batch_size
    )
    UPDATE videos 
    SET rolling_baseline_views = batch_updates.new_baseline
    FROM batch_updates
    WHERE videos.id = batch_updates.id;
    
    GET DIAGNOSTICS current_batch = ROW_COUNT;
    updated_total := updated_total + current_batch;
    
    -- Exit when no more rows to process
    EXIT WHEN current_batch < batch_size;
    
    -- Optional: Add a small delay to prevent overwhelming the system
    PERFORM pg_sleep(0.1);
  END LOOP;
  
  RETURN updated_total;
END;
$$ LANGUAGE plpgsql;

-- 4. For initial bulk update, use a more aggressive parallel approach
-- This uses PostgreSQL's built-in parallelism
CREATE OR REPLACE FUNCTION recalculate_all_baselines_parallel()
RETURNS TABLE(status TEXT, videos_updated INTEGER) AS $$
BEGIN
  -- First, clear shorts baselines
  UPDATE videos 
  SET rolling_baseline_views = NULL 
  WHERE is_youtube_short(duration, title, description);

  -- Use a CTE with parallel-friendly operations
  WITH RECURSIVE channel_list AS (
    -- Get distinct channels ordered by video count (process largest first)
    SELECT DISTINCT channel_id, COUNT(*) as video_count
    FROM videos
    WHERE NOT is_youtube_short(duration, title, description)
    GROUP BY channel_id
    ORDER BY video_count DESC
  ),
  baseline_calculations AS (
    SELECT 
      v1.id,
      v1.channel_id,
      v1.published_at,
      -- Use a lateral join for efficiency
      lateral_avg.avg_views as baseline
    FROM videos v1
    CROSS JOIN LATERAL (
      SELECT AVG(v2.view_count)::INTEGER as avg_views
      FROM videos v2
      WHERE v2.channel_id = v1.channel_id
      AND v2.published_at >= v1.published_at - INTERVAL '1 year'
      AND v2.published_at < v1.published_at
      AND NOT is_youtube_short(v2.duration, v2.title, v2.description)
      AND v2.view_count > 0
    ) lateral_avg
    WHERE NOT is_youtube_short(v1.duration, v1.title, v1.description)
  )
  UPDATE videos 
  SET rolling_baseline_views = bc.baseline
  FROM baseline_calculations bc
  WHERE videos.id = bc.id;

  GET DIAGNOSTICS videos_updated = ROW_COUNT;
  
  RETURN QUERY SELECT 'Baselines updated'::TEXT, videos_updated;
END;
$$ LANGUAGE plpgsql;

-- 5. For daily incremental updates (new videos only)
CREATE OR REPLACE FUNCTION update_new_video_baselines()
RETURNS INTEGER AS $$
DECLARE
  updated_count INTEGER;
BEGIN
  -- Only update videos added in the last 2 days
  UPDATE videos v1
  SET rolling_baseline_views = (
    SELECT AVG(v2.view_count)::INTEGER
    FROM videos v2
    WHERE v2.channel_id = v1.channel_id
    AND v2.published_at >= v1.published_at - INTERVAL '1 year'
    AND v2.published_at < v1.published_at
    AND NOT is_youtube_short(v2.duration, v2.title, v2.description)
    AND v2.view_count > 0
  )
  WHERE v1.created_at >= NOW() - INTERVAL '2 days'
  AND NOT is_youtube_short(v1.duration, v1.title, v1.description)
  AND v1.rolling_baseline_views IS NULL;
  
  GET DIAGNOSTICS updated_count = ROW_COUNT;
  RETURN updated_count;
END;
$$ LANGUAGE plpgsql;

-- 6. Alternative: Use a trigger for real-time updates on new videos
CREATE OR REPLACE FUNCTION calculate_baseline_on_insert()
RETURNS TRIGGER AS $$
BEGIN
  -- Skip if it's a short
  IF is_youtube_short(NEW.duration, NEW.title, NEW.description) THEN
    NEW.rolling_baseline_views := NULL;
    RETURN NEW;
  END IF;

  -- Calculate baseline for the new video
  SELECT AVG(view_count)::INTEGER INTO NEW.rolling_baseline_views
  FROM videos
  WHERE channel_id = NEW.channel_id
  AND published_at >= NEW.published_at - INTERVAL '1 year'
  AND published_at < NEW.published_at
  AND NOT is_youtube_short(duration, title, description)
  AND view_count > 0;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger for automatic baseline calculation
DROP TRIGGER IF EXISTS calculate_baseline_on_video_insert ON videos;
CREATE TRIGGER calculate_baseline_on_video_insert
  BEFORE INSERT ON videos
  FOR EACH ROW
  EXECUTE FUNCTION calculate_baseline_on_insert();

-- Execution plan:
-- 1. Run this to create all functions and indexes
-- 2. For initial bulk update, run: SELECT * FROM recalculate_all_baselines_parallel();
-- 3. For daily updates, run: SELECT update_new_video_baselines();
-- 4. New videos will automatically get baselines via trigger