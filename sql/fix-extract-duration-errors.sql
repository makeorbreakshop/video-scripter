-- Find cron jobs that use extract_duration_seconds function
SELECT 
  jobid,
  jobname,
  schedule,
  command,
  active
FROM cron.job
WHERE command LIKE '%extract_duration_seconds%'
   OR command LIKE '%baseline%'  -- These seem to be the culprits based on timing
ORDER BY jobname;

-- Disable only the jobs that are causing the extract_duration_seconds errors
UPDATE cron.job 
SET active = false 
WHERE jobname IN (
  'baseline-processing',         -- Running every 30 seconds!
  'process-rolling-baselines'    -- Running every 5 minutes
)
OR command LIKE '%extract_duration_seconds%';

-- Show what we disabled
SELECT 
  'DISABLED:' as status,
  jobname,
  schedule,
  substring(command, 1, 100) as command_preview
FROM cron.job
WHERE active = false
ORDER BY jobname;

-- Show what's still active (these should be OK to keep running)
SELECT 
  'ACTIVE:' as status,
  jobname,
  schedule,
  substring(command, 1, 100) as command_preview
FROM cron.job
WHERE active = true
ORDER BY jobname;