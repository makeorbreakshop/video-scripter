-- Setup cleanup job for old view snapshots
-- This will remove snapshots older than 1 year to prevent indefinite growth

-- Create a function to cleanup old snapshots
CREATE OR REPLACE FUNCTION cleanup_old_view_snapshots(
  p_days_to_keep INTEGER DEFAULT 365
)
RETURNS TABLE (
  deleted_count BIGINT,
  oldest_remaining DATE,
  newest_deleted DATE
)
LANGUAGE plpgsql
AS $$
DECLARE
  v_cutoff_date DATE;
  v_deleted_count BIGINT;
  v_oldest_remaining DATE;
  v_newest_deleted DATE;
BEGIN
  -- Calculate cutoff date
  v_cutoff_date := CURRENT_DATE - INTERVAL '1 day' * p_days_to_keep;
  
  -- Get info about what will be deleted (for logging)
  SELECT MAX(snapshot_date) INTO v_newest_deleted
  FROM view_snapshots
  WHERE snapshot_date < v_cutoff_date;
  
  -- Delete old snapshots
  WITH deleted AS (
    DELETE FROM view_snapshots
    WHERE snapshot_date < v_cutoff_date
    RETURNING 1
  )
  SELECT COUNT(*) INTO v_deleted_count FROM deleted;
  
  -- Get oldest remaining snapshot
  SELECT MIN(snapshot_date) INTO v_oldest_remaining
  FROM view_snapshots;
  
  -- Return results
  RETURN QUERY
  SELECT v_deleted_count, v_oldest_remaining, v_newest_deleted;
END;
$$;

-- Create a wrapper function for pg_cron that logs results
CREATE OR REPLACE FUNCTION cron_cleanup_old_snapshots()
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  v_result RECORD;
BEGIN
  -- Run cleanup
  SELECT * INTO v_result FROM cleanup_old_view_snapshots(365);
  
  -- Log to jobs table
  INSERT INTO jobs (
    type,
    status,
    metadata,
    created_at,
    completed_at
  ) VALUES (
    'snapshot_cleanup',
    'completed',
    jsonb_build_object(
      'deleted_count', v_result.deleted_count,
      'oldest_remaining', v_result.oldest_remaining,
      'newest_deleted', v_result.newest_deleted,
      'days_kept', 365
    ),
    NOW(),
    NOW()
  );
  
  RAISE NOTICE 'Cleaned up % old snapshots. Oldest remaining: %', 
    v_result.deleted_count, v_result.oldest_remaining;
END;
$$;

-- Schedule monthly cleanup on the 1st of each month at 3 AM UTC
SELECT cron.schedule(
  'cleanup-old-view-snapshots',
  '0 3 1 * *', -- 3 AM UTC on the 1st of each month
  $$SELECT cron_cleanup_old_snapshots();$$
);

-- To test the cleanup function manually:
-- SELECT * FROM cleanup_old_view_snapshots(365);

-- To view the scheduled job:
-- SELECT * FROM cron.job WHERE jobname = 'cleanup-old-view-snapshots';

-- To unschedule if needed:
-- SELECT cron.unschedule('cleanup-old-view-snapshots');