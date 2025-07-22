-- Setup pg_cron job for refreshing materialized view
-- Note: pg_cron extension must be enabled in Supabase

-- First, ensure pg_cron extension is enabled
CREATE EXTENSION IF NOT EXISTS pg_cron;

-- Create a cron job to refresh the materialized view daily at 2 AM PT
-- Note: Cron runs in UTC, so 2 AM PT is 10 AM UTC (9 AM during daylight saving)
SELECT cron.schedule(
  'refresh-video-performance-trends', -- job name
  '0 10 * * *', -- cron expression: daily at 10 AM UTC
  $$REFRESH MATERIALIZED VIEW CONCURRENTLY video_performance_trends;$$
);

-- To verify the job was created:
-- SELECT * FROM cron.job WHERE jobname = 'refresh-video-performance-trends';

-- To remove the job if needed:
-- SELECT cron.unschedule('refresh-video-performance-trends');

-- Alternative: If you want to refresh after view tracking runs (3 AM PT = 11 AM UTC)
-- SELECT cron.schedule(
--   'refresh-video-performance-trends',
--   '0 11 * * *',
--   $$REFRESH MATERIALIZED VIEW CONCURRENTLY video_performance_trends;$$
-- );