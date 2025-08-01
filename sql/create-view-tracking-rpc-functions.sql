-- RPC Functions to Optimize View Tracking Performance

-- 1. Efficient function to get latest snapshots before a date
CREATE OR REPLACE FUNCTION get_latest_snapshots_before_date(
  video_ids TEXT[],
  before_date DATE
)
RETURNS TABLE (
  video_id TEXT,
  view_count INTEGER,
  snapshot_date DATE
)
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  WITH ranked_snapshots AS (
    SELECT 
      vs.video_id,
      vs.view_count,
      vs.snapshot_date,
      ROW_NUMBER() OVER (
        PARTITION BY vs.video_id 
        ORDER BY vs.snapshot_date DESC
      ) as rn
    FROM view_snapshots vs
    WHERE vs.video_id = ANY(video_ids)
      AND vs.snapshot_date < before_date
  )
  SELECT 
    rs.video_id,
    rs.view_count,
    rs.snapshot_date
  FROM ranked_snapshots rs
  WHERE rs.rn = 1;
END;
$$;

-- 2. Optimized function to get videos needing tracking
CREATE OR REPLACE FUNCTION get_videos_for_tracking(
  tier_limits JSONB
)
RETURNS TABLE (
  video_id TEXT,
  priority_tier INTEGER,
  days_since_published INTEGER
)
LANGUAGE plpgsql
AS $$
DECLARE
  tier_record RECORD;
  query_text TEXT := '';
  first_tier BOOLEAN := true;
BEGIN
  -- Build UNION ALL query for all tiers
  FOR tier_record IN SELECT * FROM jsonb_each_text(tier_limits) LOOP
    IF NOT first_tier THEN
      query_text := query_text || ' UNION ALL ';
    END IF;
    first_tier := false;
    
    query_text := query_text || format('
      (SELECT 
        vtp.video_id,
        vtp.priority_tier,
        EXTRACT(EPOCH FROM (NOW() - v.published_at))::INTEGER / 86400 as days_since_published
      FROM view_tracking_priority vtp
      INNER JOIN videos v ON v.id = vtp.video_id
      WHERE vtp.priority_tier = %s
        AND (vtp.next_track_date IS NULL OR vtp.next_track_date <= CURRENT_DATE)
        AND v.published_at IS NOT NULL
      ORDER BY v.published_at DESC
      LIMIT %s)',
      tier_record.key,
      tier_record.value
    );
  END LOOP;
  
  -- Execute the dynamic query
  RETURN QUERY EXECUTE query_text;
END;
$$;

-- 3. Batch update tracking dates efficiently
CREATE OR REPLACE FUNCTION update_tracking_dates_batch(
  video_ids TEXT[],
  tier_intervals JSONB
)
RETURNS VOID
LANGUAGE plpgsql
AS $$
BEGIN
  UPDATE view_tracking_priority vtp
  SET 
    last_tracked = CURRENT_DATE,
    next_track_date = CASE
      WHEN vtp.priority_tier = 1 THEN CURRENT_DATE + INTERVAL '1 day'
      WHEN vtp.priority_tier = 2 THEN CURRENT_DATE + INTERVAL '2 days'
      WHEN vtp.priority_tier = 3 THEN CURRENT_DATE + INTERVAL '3 days'
      WHEN vtp.priority_tier = 4 THEN CURRENT_DATE + INTERVAL '7 days'
      WHEN vtp.priority_tier = 5 THEN CURRENT_DATE + INTERVAL '14 days'
      WHEN vtp.priority_tier = 6 THEN CURRENT_DATE + INTERVAL '30 days'
      ELSE CURRENT_DATE + INTERVAL '30 days'
    END,
    updated_at = NOW()
  WHERE vtp.video_id = ANY(video_ids);
END;
$$;

-- 4. Function to get tracking stats efficiently
CREATE OR REPLACE FUNCTION get_view_tracking_stats()
RETURNS TABLE (
  tier INTEGER,
  total_videos BIGINT,
  needs_tracking BIGINT,
  tracked_today BIGINT
)
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  SELECT 
    vtp.priority_tier as tier,
    COUNT(*)::BIGINT as total_videos,
    COUNT(*) FILTER (
      WHERE vtp.next_track_date IS NULL 
      OR vtp.next_track_date <= CURRENT_DATE
    )::BIGINT as needs_tracking,
    COUNT(*) FILTER (
      WHERE vtp.last_tracked = CURRENT_DATE
    )::BIGINT as tracked_today
  FROM view_tracking_priority vtp
  GROUP BY vtp.priority_tier
  ORDER BY vtp.priority_tier;
END;
$$;

-- Grant execute permissions
GRANT EXECUTE ON FUNCTION get_latest_snapshots_before_date(TEXT[], DATE) TO authenticated;
GRANT EXECUTE ON FUNCTION get_videos_for_tracking(JSONB) TO authenticated;
GRANT EXECUTE ON FUNCTION update_tracking_dates_batch(TEXT[], JSONB) TO authenticated;
GRANT EXECUTE ON FUNCTION get_view_tracking_stats() TO authenticated;