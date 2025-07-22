-- COPY AND PASTE THIS ENTIRE BLOCK INTO SUPABASE SQL EDITOR

-- 1. Clear shorts baselines
UPDATE videos 
SET rolling_baseline_views = NULL 
WHERE is_youtube_short(duration, title, description);

-- 2. Create optimized index
CREATE INDEX IF NOT EXISTS idx_videos_baseline_calc 
ON videos (channel_id, published_at, view_count) 
WHERE NOT is_youtube_short(duration, title, description) AND view_count > 0;

-- 3. Create batch processing function
CREATE OR REPLACE FUNCTION process_baseline_batch(batch_size INTEGER DEFAULT 1000)
RETURNS INTEGER AS $$
DECLARE
  processed INTEGER;
BEGIN
  WITH batch AS (coo
    SELECT v1.id
    FROM videos v1
    WHERE v1.rolling_baseline_views IS NULL
    AND NOT is_youtube_short(v1.duration, v1.title, v1.description)
    LIMIT batch_size
  )
  UPDATE videos 
  SET rolling_baseline_views = (
    SELECT AVG(v2.view_count)::INTEGER
    FROM videos v2
    WHERE v2.channel_id = videos.channel_id
    AND v2.published_at >= videos.published_at - INTERVAL '1 year'
    AND v2.published_at < videos.published_at
    AND NOT is_youtube_short(v2.duration, v2.title, v2.description)
    AND v2.view_count > 0
  )
  FROM batch
  WHERE videos.id = batch.id;
  
  GET DIAGNOSTICS processed = ROW_COUNT;
  RETURN processed;
END;
$$ LANGUAGE plpgsql;

-- 4. Schedule aggressive cron job - every 30 seconds
SELECT cron.schedule(
  'baseline-processing',
  '30 seconds',
  'SELECT process_baseline_batch(1000);'
);

-- 5. Create trigger for future videos
CREATE OR REPLACE FUNCTION calculate_baseline_on_insert()
RETURNS TRIGGER AS $$
BEGIN
  IF is_youtube_short(NEW.duration, NEW.title, NEW.description) THEN
    NEW.rolling_baseline_views := NULL;
    RETURN NEW;
  END IF;

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

DROP TRIGGER IF EXISTS calculate_baseline_on_video_insert ON videos;
CREATE TRIGGER calculate_baseline_on_video_insert
  BEFORE INSERT ON videos
  FOR EACH ROW
  EXECUTE FUNCTION calculate_baseline_on_insert();

-- 6. Check progress (run this separately to monitor)
-- SELECT COUNT(*) as remaining FROM videos WHERE rolling_baseline_views IS NULL AND NOT is_youtube_short(duration, title, description);