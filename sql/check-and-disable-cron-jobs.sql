-- Check all active cron jobs
SELECT 
  jobid,
  jobname,
  schedule,
  command,
  nodename,
  nodeport,
  database,
  username,
  active
FROM cron.job
ORDER BY jobname;

-- DISABLE the aggressive baseline processing job that runs every 30 seconds
UPDATE cron.job 
SET active = false 
WHERE jobname = 'baseline-processing';

-- DISABLE other frequent jobs that might be causing IOPS
UPDATE cron.job 
SET active = false 
WHERE jobname IN (
  'process-rolling-baselines',  -- runs every 5 minutes
  'youtube-quota-midnight-reset' -- runs every 5 minutes during certain hours
);

-- Keep these daily/hourly jobs as they're less frequent:
-- 'refresh-competitor-channels' - daily at 3 AM
-- 'refresh-video-performance-trends' - daily at 10 AM UTC
-- 'youtube-quota-reset-check' - hourly
-- 'daily-packaging-refresh' - daily at 2 AM
-- 'cleanup-old-view-snapshots' - monthly

-- Verify what's still active
SELECT 
  jobname,
  schedule,
  command,
  active
FROM cron.job
WHERE active = true
ORDER BY jobname;