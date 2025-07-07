-- INCREMENTAL BASELINE CALCULATION - O(n) approach
-- Process videos chronologically to build baselines incrementally

-- Step 1: Create a working table for efficient processing
DROP TABLE IF EXISTS baseline_work_table CASCADE;

CREATE TEMP TABLE baseline_work_table AS
SELECT 
  id,
  channel_id,
  published_at,
  view_count,
  ROW_NUMBER() OVER (PARTITION BY channel_id ORDER BY published_at) as seq_num
FROM videos 
WHERE NOT is_youtube_short(duration, title, description)
ORDER BY channel_id, published_at;

-- Step 2: Create function that processes one channel at a time
CREATE OR REPLACE FUNCTION calculate_baselines_for_channel(target_channel_id TEXT)
RETURNS INTEGER AS $$
DECLARE
  video_record RECORD;
  baseline_videos INTEGER[];
  baseline_views INTEGER[];
  baseline_dates DATE[];
  current_baseline FLOAT;
  updated_count INTEGER := 0;
  cutoff_date DATE;
BEGIN
  -- Initialize arrays for sliding window
  baseline_videos := ARRAY[]::INTEGER[];
  baseline_views := ARRAY[]::INTEGER[];
  baseline_dates := ARRAY[]::DATE[];
  
  -- Process videos for this channel chronologically
  FOR video_record IN 
    SELECT id, published_at::DATE as pub_date, view_count
    FROM baseline_work_table 
    WHERE channel_id = target_channel_id
    ORDER BY published_at
  LOOP
    -- Remove videos older than 1 year from sliding window
    cutoff_date := video_record.pub_date - INTERVAL '1 year';
    
    -- Clean up arrays (remove old videos)
    IF array_length(baseline_dates, 1) > 0 THEN
      FOR i IN REVERSE array_length(baseline_dates, 1)..1 LOOP
        IF baseline_dates[i] < cutoff_date THEN
          baseline_videos := array_remove(baseline_videos, baseline_videos[i]);
          baseline_views := array_remove(baseline_views, baseline_views[i]);
          baseline_dates := array_remove(baseline_dates, baseline_dates[i]);
        END IF;
      END LOOP;
    END IF;
    
    -- Calculate current baseline from sliding window
    IF array_length(baseline_views, 1) > 0 THEN
      SELECT AVG(unnest)::INTEGER INTO current_baseline 
      FROM unnest(baseline_views);
    ELSE
      current_baseline := NULL;
    END IF;
    
    -- Update the video's baseline
    UPDATE videos 
    SET rolling_baseline_views = current_baseline
    WHERE id = video_record.id;
    
    -- Add current video to sliding window for future calculations
    baseline_videos := array_append(baseline_videos, video_record.id);
    baseline_views := array_append(baseline_views, video_record.view_count);
    baseline_dates := array_append(baseline_dates, video_record.pub_date);
    
    updated_count := updated_count + 1;
  END LOOP;
  
  RETURN updated_count;
END;
$$ LANGUAGE plpgsql;

-- Step 3: Get list of unique channels to process
CREATE TEMP TABLE channels_to_process AS
SELECT DISTINCT channel_id, COUNT(*) as video_count
FROM baseline_work_table 
GROUP BY channel_id
ORDER BY video_count DESC; -- Process largest channels first

-- Step 4: Process channels one by one (this can be parallelized)
-- This gives progress feedback and avoids timeouts
SELECT 
  channel_id,
  video_count,
  calculate_baselines_for_channel(channel_id) as processed_videos
FROM channels_to_process
LIMIT 5; -- Start with just 5 channels to test

-- For full processing, remove the LIMIT or run in batches
-- SELECT channel_id, calculate_baselines_for_channel(channel_id) 
-- FROM channels_to_process;