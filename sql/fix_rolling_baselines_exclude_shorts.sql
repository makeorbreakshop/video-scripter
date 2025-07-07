-- Fix rolling baseline calculation to exclude YouTube Shorts
-- BATCH APPROACH: Process videos in smaller chunks to avoid timeouts

-- Step 1: Create an optimized batch function for recalculating baselines
DROP FUNCTION IF EXISTS calculate_rolling_baselines_batch(INTEGER, INTEGER);

CREATE FUNCTION calculate_rolling_baselines_batch(batch_size INTEGER DEFAULT 500, offset_val INTEGER DEFAULT 0)
RETURNS TABLE(processed INTEGER, batch_start INTEGER, batch_end INTEGER) AS $$
DECLARE
  video_record RECORD;
  baseline_avg INTEGER;
  updated_count INTEGER := 0;
  batch_count INTEGER := 0;
BEGIN
  -- Process videos in batches to avoid timeouts
  FOR video_record IN 
    SELECT id, channel_id, published_at
    FROM videos
    ORDER BY channel_id, published_at
    LIMIT batch_size OFFSET offset_val
  LOOP
    -- Calculate average view count from previous year of NON-SHORT videos for same channel
    SELECT COALESCE(AVG(view_count)::INTEGER, 0) INTO baseline_avg
    FROM videos v2
    WHERE v2.channel_id = video_record.channel_id
      AND v2.published_at < video_record.published_at
      AND v2.published_at >= video_record.published_at - INTERVAL '1 year'
      AND NOT is_youtube_short(v2.duration, v2.title, v2.description);  -- EXCLUDE SHORTS
    
    -- Update the rolling baseline for this video
    UPDATE videos 
    SET rolling_baseline_views = CASE 
      WHEN baseline_avg > 0 THEN baseline_avg 
      ELSE NULL 
    END
    WHERE id = video_record.id;
    
    updated_count := updated_count + 1;
    batch_count := batch_count + 1;
  END LOOP;
  
  RETURN QUERY SELECT updated_count, offset_val, offset_val + batch_count - 1;
END;
$$ LANGUAGE plpgsql;

-- Step 2: Check total video count to plan batching
SELECT 
  COUNT(*) as total_videos,
  CEIL(COUNT(*)::float / 500) as batches_needed
FROM videos;

-- Step 3: Run first batch (500 videos)
-- Run these one at a time, waiting for each to complete:

-- Batch 1: Videos 0-499
SELECT * FROM calculate_rolling_baselines_batch(500, 0);

-- INSTRUCTIONS FOR RUNNING ADDITIONAL BATCHES:
-- After this completes successfully, run these commands one by one:
-- SELECT * FROM calculate_rolling_baselines_batch(500, 500);   -- Batch 2: 500-999
-- SELECT * FROM calculate_rolling_baselines_batch(500, 1000);  -- Batch 3: 1000-1499
-- SELECT * FROM calculate_rolling_baselines_batch(500, 1500);  -- Batch 4: 1500-1999
-- Continue until you've processed all videos...

-- Step 4: After all batches complete, refresh the materialized view
-- REFRESH MATERIALIZED VIEW packaging_performance;

-- Step 5: Verify the fix worked
-- SELECT 
--   'Shorts Impact Analysis' as description,
--   COUNT(*) as total_videos,
--   COUNT(*) FILTER (WHERE is_youtube_short(duration, title, description)) as shorts_count,
--   COUNT(*) FILTER (WHERE rolling_baseline_views IS NOT NULL) as videos_with_baselines,
--   AVG(rolling_baseline_views) FILTER (WHERE rolling_baseline_views IS NOT NULL AND NOT is_youtube_short(duration, title, description)) as avg_baseline_long_form_only
-- FROM videos;