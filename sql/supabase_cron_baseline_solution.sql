-- SUPABASE CRON-BASED SOLUTION FOR ROLLING BASELINES
-- This avoids HTTP timeouts by running in the background

-- Step 1: Create the baseline calculation function that processes a small batch
CREATE OR REPLACE FUNCTION process_baseline_batch(batch_size INTEGER DEFAULT 100)
RETURNS INTEGER AS $$
DECLARE
  processed INTEGER;
BEGIN
  -- Process only videos without baselines
  WITH batch AS (
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

-- Step 2: Create a status tracking table
CREATE TABLE IF NOT EXISTS baseline_processing_status (
  id SERIAL PRIMARY KEY,
  started_at TIMESTAMPTZ DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  total_videos INTEGER,
  processed_videos INTEGER DEFAULT 0,
  status TEXT DEFAULT 'running'
);

-- Step 3: Create the master function that will be called by cron
CREATE OR REPLACE FUNCTION process_all_baselines_incrementally()
RETURNS TEXT AS $$
DECLARE
  batch_size INTEGER := 100;
  total_processed INTEGER := 0;
  current_batch INTEGER;
  status_id INTEGER;
BEGIN
  -- Check if we're already running
  IF EXISTS (SELECT 1 FROM baseline_processing_status WHERE status = 'running') THEN
    RETURN 'Processing already in progress';
  END IF;
  
  -- Create status record
  INSERT INTO baseline_processing_status (total_videos)
  SELECT COUNT(*) 
  FROM videos 
  WHERE rolling_baseline_views IS NULL 
  AND NOT is_youtube_short(duration, title, description)
  RETURNING id INTO status_id;
  
  -- Process batches
  LOOP
    current_batch := process_baseline_batch(batch_size);
    total_processed := total_processed + current_batch;
    
    -- Update status
    UPDATE baseline_processing_status 
    SET processed_videos = total_processed
    WHERE id = status_id;
    
    -- Exit when done
    EXIT WHEN current_batch = 0;
  END LOOP;
  
  -- Mark as completed
  UPDATE baseline_processing_status 
  SET completed_at = NOW(), 
      status = 'completed',
      processed_videos = total_processed
  WHERE id = status_id;
  
  RETURN 'Processed ' || total_processed || ' videos';
END;
$$ LANGUAGE plpgsql;

-- Step 4: Schedule the cron job to run every 5 minutes
SELECT cron.schedule(
  'process-rolling-baselines',
  '*/5 * * * *', -- Every 5 minutes
  'SELECT process_all_baselines_incrementally();'
);

-- Step 5: Create a one-time immediate processing function
CREATE OR REPLACE FUNCTION start_baseline_processing()
RETURNS TEXT AS $$
BEGIN
  -- Clear any stuck jobs
  UPDATE baseline_processing_status 
  SET status = 'cancelled' 
  WHERE status = 'running' 
  AND started_at < NOW() - INTERVAL '1 hour';
  
  -- Start processing
  RETURN process_all_baselines_incrementally();
END;
$$ LANGUAGE plpgsql;

-- Step 6: Create trigger for new videos (so we don't need to recalculate later)
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

-- USAGE:
-- 1. Run this entire SQL to set up the system
-- 2. To start immediate processing: SELECT start_baseline_processing();
-- 3. Check progress: SELECT * FROM baseline_processing_status ORDER BY id DESC LIMIT 1;
-- 4. The cron job will automatically continue processing every 5 minutes until done
-- 5. Future videos will get baselines automatically via the trigger