-- Check for untracked API calls made today
-- The discover-new-videos endpoint makes search.list calls (100 quota units each)
-- that are not being tracked

-- First, let's see if we can identify when the daily update was run
SELECT 
  created_at,
  created_at AT TIME ZONE 'America/Los_Angeles' as pacific_time,
  method,
  cost,
  description
FROM youtube_quota_calls
WHERE created_at >= (NOW() AT TIME ZONE 'America/Los_Angeles')::DATE
ORDER BY created_at DESC
LIMIT 10;

-- If daily update was run today, we need to add the missing search.list call
-- Assuming one search.list call was made (100 quota units)