-- Add a cron job to refresh competitor channel summary nightly at 3 AM
SELECT cron.schedule(
  'refresh-competitor-channels',           -- job name
  '0 3 * * *',                            -- schedule: 3 AM daily
  'SELECT refresh_competitor_channel_summary();'  -- command to run
);

-- To verify the job was created:
-- SELECT * FROM cron.job WHERE jobname = 'refresh-competitor-channels';

-- To manually run the refresh now:
-- SELECT refresh_competitor_channel_summary();