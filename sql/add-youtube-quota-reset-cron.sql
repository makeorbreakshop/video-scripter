-- YouTube Quota Automatic Reset System
-- Ensures quota tracking aligns with YouTube's midnight Pacific Time reset

-- Enable pg_cron extension if not already enabled
CREATE EXTENSION IF NOT EXISTS pg_cron;

-- Function to clean up old quota records and ensure today's record exists
CREATE OR REPLACE FUNCTION reset_youtube_quota_if_needed()
RETURNS void AS $$
DECLARE
  pacific_now TIMESTAMPTZ;
  pacific_today DATE;
BEGIN
  -- Get current Pacific Time
  pacific_now := NOW() AT TIME ZONE 'America/Los_Angeles';
  pacific_today := pacific_now::DATE;
  
  -- Create today's record if it doesn't exist
  INSERT INTO youtube_quota_usage (date, quota_used, quota_limit, last_reset)
  VALUES (pacific_today, 0, 10000, pacific_now)
  ON CONFLICT (date) DO NOTHING;
  
  -- Optional: Clean up records older than 30 days to prevent table bloat
  DELETE FROM youtube_quota_usage 
  WHERE date < pacific_today - INTERVAL '30 days';
  
  DELETE FROM youtube_quota_calls 
  WHERE date < pacific_today - INTERVAL '30 days';
  
  RAISE NOTICE 'YouTube quota reset check completed for %', pacific_today;
END;
$$ LANGUAGE plpgsql;

-- Schedule the reset check to run every hour
-- This ensures we catch the midnight Pacific Time reset even with timezone differences
SELECT cron.schedule(
  'youtube-quota-reset-check',
  '0 * * * *', -- Every hour on the hour
  'SELECT reset_youtube_quota_if_needed();'
);

-- Also create a more aggressive check around midnight Pacific Time
-- This runs every 5 minutes between 11:50 PM and 12:10 AM Pacific
SELECT cron.schedule(
  'youtube-quota-midnight-reset',
  '*/5 23,0 * * *', -- Every 5 minutes during hour 23 and 0
  $$
    DO $$
    DECLARE
      pacific_hour INTEGER;
    BEGIN
      pacific_hour := EXTRACT(HOUR FROM NOW() AT TIME ZONE 'America/Los_Angeles');
      -- Only run if we're near midnight Pacific Time
      IF pacific_hour = 23 OR pacific_hour = 0 THEN
        PERFORM reset_youtube_quota_if_needed();
      END IF;
    END $$;
  $$
);

-- Function to get quota status with Pacific Time awareness
CREATE OR REPLACE FUNCTION get_quota_status()
RETURNS JSON AS $$
DECLARE
  result JSON;
  pacific_today DATE;
BEGIN
  pacific_today := (NOW() AT TIME ZONE 'America/Los_Angeles')::DATE;
  
  SELECT json_build_object(
    'date', pacific_today,
    'quota_used', COALESCE(quota_used, 0),
    'quota_limit', quota_limit,
    'quota_remaining', quota_limit - COALESCE(quota_used, 0),
    'percentage_used', ROUND((COALESCE(quota_used, 0)::DECIMAL / quota_limit::DECIMAL) * 100, 2),
    'pacific_time', NOW() AT TIME ZONE 'America/Los_Angeles',
    'hours_until_reset', 24 - EXTRACT(HOUR FROM NOW() AT TIME ZONE 'America/Los_Angeles')
  ) INTO result
  FROM youtube_quota_usage
  WHERE date = pacific_today;
  
  -- If no record exists for today, return default
  IF result IS NULL THEN
    result := json_build_object(
      'date', pacific_today,
      'quota_used', 0,
      'quota_limit', 10000,
      'quota_remaining', 10000,
      'percentage_used', 0,
      'pacific_time', NOW() AT TIME ZONE 'America/Los_Angeles',
      'hours_until_reset', 24 - EXTRACT(HOUR FROM NOW() AT TIME ZONE 'America/Los_Angeles')
    );
  END IF;
  
  RETURN result;
END;
$$ LANGUAGE plpgsql;

-- Update the increment function to use Pacific Time
CREATE OR REPLACE FUNCTION increment_quota_usage(cost INTEGER)
RETURNS INTEGER AS $$
DECLARE
  pacific_today DATE;
  current_usage INTEGER;
BEGIN
  pacific_today := (NOW() AT TIME ZONE 'America/Los_Angeles')::DATE;
  
  -- Insert or update today's usage
  INSERT INTO youtube_quota_usage (date, quota_used, last_reset)
  VALUES (pacific_today, cost, NOW())
  ON CONFLICT (date) 
  DO UPDATE SET 
    quota_used = youtube_quota_usage.quota_used + cost,
    updated_at = NOW();
  
  -- Get current usage
  SELECT quota_used INTO current_usage 
  FROM youtube_quota_usage 
  WHERE date = pacific_today;
  
  RETURN current_usage;
END;
$$ LANGUAGE plpgsql;

-- Update log function to use Pacific Time
CREATE OR REPLACE FUNCTION log_youtube_api_call(
  method TEXT,
  cost INTEGER,
  description TEXT DEFAULT NULL,
  job_id TEXT DEFAULT NULL
)
RETURNS VOID AS $$
DECLARE
  pacific_today DATE;
BEGIN
  pacific_today := (NOW() AT TIME ZONE 'America/Los_Angeles')::DATE;
  
  INSERT INTO youtube_quota_calls (date, method, cost, description, job_id)
  VALUES (pacific_today, method, cost, description, job_id);
  
  -- Also increment the daily usage
  PERFORM increment_quota_usage(cost);
END;
$$ LANGUAGE plpgsql;

-- Manual function to check cron job status
CREATE OR REPLACE FUNCTION check_quota_cron_status()
RETURNS TABLE (
  jobname TEXT,
  schedule TEXT,
  active BOOLEAN,
  last_run TIMESTAMPTZ,
  next_run TIMESTAMPTZ
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    j.jobname::TEXT,
    j.schedule::TEXT,
    j.active,
    j.lastrun AS last_run,
    j.nextrun AS next_run
  FROM cron.job j
  WHERE j.jobname LIKE 'youtube-quota%'
  ORDER BY j.jobname;
END;
$$ LANGUAGE plpgsql;

-- Run initial setup
SELECT reset_youtube_quota_if_needed();

-- Check cron job status
SELECT * FROM check_quota_cron_status();