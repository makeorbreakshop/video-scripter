-- Fix timezone mismatch in YouTube quota status function
-- This ensures get_quota_status uses Pacific timezone to match the reset function

CREATE OR REPLACE FUNCTION public.get_quota_status()
 RETURNS json
 LANGUAGE plpgsql
AS $function$
  DECLARE
    result JSON;
    pacific_today DATE;
  BEGIN
    -- Use Pacific time to match the reset function
    pacific_today := (NOW() AT TIME ZONE 'America/Los_Angeles')::DATE;

    SELECT json_build_object(
      'date', pacific_today,
      'quota_used', COALESCE(quota_used, 0),
      'quota_limit', quota_limit,
      'quota_remaining', quota_limit - COALESCE(quota_used, 0),
      'percentage_used', ROUND((COALESCE(quota_used, 0)::DECIMAL /
   quota_limit::DECIMAL) * 100, 2)
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
        'percentage_used', 0
      );
    END IF;

    RETURN result;
  END;
  $function$;

-- Also fix the log_youtube_api_call function to use Pacific timezone
CREATE OR REPLACE FUNCTION public.log_youtube_api_call(
  method TEXT,
  cost INTEGER,
  description TEXT DEFAULT NULL,
  job_id TEXT DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
AS $function$
  DECLARE
    pacific_today DATE;
  BEGIN
    -- Use Pacific time consistently
    pacific_today := (NOW() AT TIME ZONE 'America/Los_Angeles')::DATE;

    -- Log the API call
    INSERT INTO youtube_quota_calls (
      date,
      method,
      cost,
      description,
      job_id
    ) VALUES (
      pacific_today,
      method,
      cost,
      description,
      job_id
    );

    -- Also increment the daily usage
    PERFORM increment_quota_usage(cost);
  END;
  $function$;

-- Fix increment_quota_usage to use Pacific timezone
CREATE OR REPLACE FUNCTION public.increment_quota_usage(cost integer)
 RETURNS integer
 LANGUAGE plpgsql
AS $function$
  DECLARE
    pacific_today DATE;
    current_usage INTEGER;
  BEGIN
    -- Use Pacific time consistently
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
  $function$;

-- Verify the fix
SELECT 
  NOW() as utc_now,
  NOW() AT TIME ZONE 'America/Los_Angeles' as pacific_now,
  CURRENT_DATE as utc_date,
  (NOW() AT TIME ZONE 'America/Los_Angeles')::DATE as pacific_date,
  get_quota_status() as current_quota_status;