-- Initialize view snapshots from existing video data
-- This creates the first snapshot for each video using the import date
-- so we preserve when the view count was actually captured

INSERT INTO view_snapshots (
  video_id,
  snapshot_date,
  view_count,
  like_count,
  comment_count,
  days_since_published,
  daily_views_rate
)
SELECT 
  v.id as video_id,
  DATE(v.import_date) as snapshot_date,
  v.view_count,
  v.like_count,
  v.comment_count,
  EXTRACT(DAY FROM v.import_date - v.published_at)::INTEGER as days_since_published,
  NULL as daily_views_rate -- No previous data for rate calculation
FROM videos v
WHERE v.import_date IS NOT NULL
  AND v.view_count IS NOT NULL
  AND v.published_at IS NOT NULL
ON CONFLICT (video_id, snapshot_date) DO NOTHING;

-- Log the results
DO $$
DECLARE
  v_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO v_count FROM view_snapshots;
  RAISE NOTICE 'Created % initial view snapshots', v_count;
END $$;