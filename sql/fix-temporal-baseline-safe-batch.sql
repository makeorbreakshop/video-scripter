-- Safe batch processing function that prevents numeric overflow
-- This caps values at 99999.999 to fit in NUMERIC(8,3)

CREATE OR REPLACE FUNCTION fix_temporal_baselines_batch_safe(batch_size INTEGER DEFAULT 100)
RETURNS JSONB
LANGUAGE plpgsql
AS $$
DECLARE
  processed INTEGER;
  failed_ids TEXT[];
BEGIN
  -- Process a batch of videos with baseline = 1.0
  WITH batch AS (
    SELECT id
    FROM videos
    WHERE channel_baseline_at_publish = 1.0
    AND import_date >= '2025-08-09'
    AND is_short = false
    LIMIT batch_size
  ),
  calculations AS (
    SELECT 
      b.id,
      -- Cap baseline at 99999.999 to prevent overflow
      LEAST(calculate_video_channel_baseline(v.id), 99999.999) as new_baseline,
      v.view_count
    FROM batch b
    JOIN videos v ON v.id = b.id
  )
  UPDATE videos v
  SET 
    channel_baseline_at_publish = c.new_baseline,
    temporal_performance_score = CASE 
      WHEN c.new_baseline > 0 THEN 
        -- Cap the score at 99999.999 to prevent overflow
        LEAST(v.view_count::numeric / c.new_baseline, 99999.999)
      ELSE NULL
    END
  FROM calculations c
  WHERE v.id = c.id
  AND c.new_baseline > 0; -- Only update if we got a valid baseline
  
  GET DIAGNOSTICS processed = ROW_COUNT;
  
  -- Log any videos that couldn't be processed
  SELECT ARRAY_AGG(id) INTO failed_ids
  FROM batch b
  WHERE NOT EXISTS (
    SELECT 1 FROM videos v 
    WHERE v.id = b.id 
    AND v.channel_baseline_at_publish != 1.0
  );
  
  RETURN jsonb_build_object(
    'success', true,
    'videos_updated', processed,
    'failed_ids', failed_ids,
    'remaining', (
      SELECT COUNT(*) 
      FROM videos 
      WHERE channel_baseline_at_publish = 1.0 
      AND import_date >= '2025-08-09' 
      AND is_short = false
    )
  );
END;
$$;

-- Test it on a small batch first
SELECT fix_temporal_baselines_batch_safe(10);