-- Fix the baseline processing errors by creating the missing extract_duration_seconds function
-- This function parses YouTube's ISO 8601 duration format (e.g., PT4M13S)

-- Function to extract total seconds from ISO 8601 duration
CREATE OR REPLACE FUNCTION extract_duration_seconds(duration TEXT)
RETURNS INTEGER AS $$
DECLARE
  hours INTEGER := 0;
  minutes INTEGER := 0;
  seconds INTEGER := 0;
  matches TEXT[];
BEGIN
  -- Handle NULL, empty, or invalid durations
  IF duration IS NULL OR duration = '' OR duration = 'P0D' THEN
    RETURN 0;
  END IF;
  
  -- Extract hours, minutes, seconds using regex
  -- Pattern matches: PT1H30M45S, PT30M45S, PT45S, PT1H, PT30M, etc.
  IF duration ~ '^PT(\d+H)?(\d+M)?(\d+S)?$' THEN
    SELECT regexp_matches(duration, '^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$') INTO matches;
    
    IF matches[1] IS NOT NULL THEN hours := matches[1]::INTEGER; END IF;
    IF matches[2] IS NOT NULL THEN minutes := matches[2]::INTEGER; END IF;
    IF matches[3] IS NOT NULL THEN seconds := matches[3]::INTEGER; END IF;
  END IF;
  
  RETURN hours * 3600 + minutes * 60 + seconds;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- Test the function
SELECT 
  'Testing duration parsing...' as test_name,
  extract_duration_seconds('PT1M30S') as should_be_90,
  extract_duration_seconds('PT2M1S') as should_be_121,
  extract_duration_seconds('PT45S') as should_be_45,
  extract_duration_seconds('PT1H') as should_be_3600,
  extract_duration_seconds('PT1H30M45S') as should_be_5445;

-- Verify the baseline-processing cron job exists and can now run without errors
SELECT 
  jobname,
  schedule,
  active,
  command
FROM cron.job
WHERE jobname = 'baseline-processing';

-- The baseline processing should now work without errors!
-- If you want to manually trigger a baseline calculation batch:
-- SELECT process_baseline_batch(100);