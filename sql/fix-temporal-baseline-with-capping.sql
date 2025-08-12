-- Fix temporal baselines with proper capping to prevent numeric overflow
-- The temporal_performance_score field is NUMERIC(8,3) which means max value is 99,999.999

-- Create a safe batch processing function that caps scores
CREATE OR REPLACE FUNCTION fix_temporal_baselines_batch_capped(batch_size INTEGER DEFAULT 100)
RETURNS JSONB
LANGUAGE plpgsql
AS $$
DECLARE
  processed INTEGER;
  failed_count INTEGER;
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
      v.view_count,
      calculate_video_channel_baseline(v.id) as new_baseline
    FROM batch b
    JOIN videos v ON v.id = b.id
  )
  UPDATE videos v
  SET 
    channel_baseline_at_publish = c.new_baseline,
    temporal_performance_score = CASE 
      WHEN c.new_baseline > 0 THEN 
        -- Cap the score at 99999.999 to prevent overflow
        LEAST(
          ROUND((v.view_count::numeric / c.new_baseline), 3),
          99999.999
        )
      ELSE NULL
    END
  FROM calculations c
  WHERE v.id = c.id
  AND c.new_baseline IS NOT NULL
  AND c.new_baseline > 0; -- Only update if we got a valid baseline
  
  GET DIAGNOSTICS processed = ROW_COUNT;
  
  -- Count videos that couldn't be processed
  SELECT COUNT(*) INTO failed_count
  FROM batch b
  WHERE NOT EXISTS (
    SELECT 1 FROM videos v 
    WHERE v.id = b.id 
    AND v.channel_baseline_at_publish != 1.0
  );
  
  RETURN jsonb_build_object(
    'success', true,
    'videos_updated', processed,
    'failed_count', failed_count,
    'remaining', (
      SELECT COUNT(*) 
      FROM videos 
      WHERE channel_baseline_at_publish = 1.0 
      AND import_date >= '2025-08-09' 
      AND is_short = false
    )
  );
EXCEPTION
  WHEN numeric_value_out_of_range THEN
    -- If we still get overflow, log the error and return details
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Numeric overflow occurred',
      'videos_updated', COALESCE(processed, 0)
    );
END;
$$;

-- Test it on a small batch first
SELECT fix_temporal_baselines_batch_capped(10);