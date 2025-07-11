-- Update Baseline Processing to Smart Schedule
-- Changes from every 30 seconds to hourly with manual trigger capability

-- Update existing cron job to run hourly as a safety net
UPDATE cron.job 
SET schedule = '0 * * * *' 
WHERE jobname = 'baseline-processing';

-- Create function to manually trigger baseline processing
CREATE OR REPLACE FUNCTION trigger_baseline_processing(batch_size INTEGER DEFAULT 1000)
RETURNS INTEGER AS $$
DECLARE
  processed_count INTEGER;
BEGIN
  SELECT process_baseline_batch(batch_size) INTO processed_count;
  RETURN processed_count;
END;
$$ LANGUAGE plpgsql;

-- Create function to check if baseline processing is needed
CREATE OR REPLACE FUNCTION check_baseline_needed()
RETURNS BOOLEAN AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM videos v
    WHERE NOT EXISTS (
      SELECT 1 FROM baseline_analytics ba 
      WHERE ba.video_id = v.id
    )
    LIMIT 1
  );
END;
$$ LANGUAGE plpgsql;

-- Create function to get count of videos needing baseline
CREATE OR REPLACE FUNCTION get_baseline_pending_count()
RETURNS INTEGER AS $$
DECLARE
  pending_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO pending_count
  FROM videos v
  WHERE NOT EXISTS (
    SELECT 1 FROM baseline_analytics ba 
    WHERE ba.video_id = v.id
  );
  
  RETURN pending_count;
END;
$$ LANGUAGE plpgsql;

-- Verify the update
SELECT 
  jobname,
  schedule,
  active,
  command
FROM cron.job 
WHERE jobname = 'baseline-processing';