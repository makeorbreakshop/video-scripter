-- Fix the misplaced quota data caused by timezone bug
-- Move API calls that were made on July 11 Pacific but logged to July 12 UTC

-- Step 1: Update the API calls to the correct date
UPDATE youtube_quota_calls
SET date = '2025-07-11'
WHERE date = '2025-07-12'
  AND created_at < '2025-07-12 08:00:00+00'; -- Before midnight Pacific

-- Step 2: Recalculate July 11's quota usage
UPDATE youtube_quota_usage
SET quota_used = (
  SELECT COALESCE(SUM(cost), 0)
  FROM youtube_quota_calls
  WHERE date = '2025-07-11'
)
WHERE date = '2025-07-11';

-- Step 3: Reset July 12's quota to 0 (since no actual calls were made today)
UPDATE youtube_quota_usage
SET quota_used = 0,
    updated_at = NOW()
WHERE date = '2025-07-12';

-- Verify the fix
SELECT 
  date,
  quota_used,
  quota_limit,
  last_reset
FROM youtube_quota_usage
WHERE date >= '2025-07-11'
ORDER BY date DESC;

-- Check the corrected quota status
SELECT get_quota_status();