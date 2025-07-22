CREATE OR REPLACE FUNCTION count_snapshots_by_date(p_days INTEGER DEFAULT 7)
RETURNS TABLE (
  snapshot_date DATE,
  count BIGINT
)
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  SELECT 
    vs.snapshot_date,
    COUNT(*)::BIGINT
  FROM view_snapshots vs
  WHERE vs.snapshot_date >= CURRENT_DATE - INTERVAL '1 day' * p_days
  GROUP BY vs.snapshot_date
  ORDER BY vs.snapshot_date DESC;
END;
$$;
EOF < /dev/null