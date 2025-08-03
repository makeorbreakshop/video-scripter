-- Add index on snapshot_date to speed up date-based queries
CREATE INDEX IF NOT EXISTS idx_view_snapshots_date 
ON view_snapshots(snapshot_date DESC);

-- Add composite index for common query pattern
CREATE INDEX IF NOT EXISTS idx_view_snapshots_date_video 
ON view_snapshots(snapshot_date DESC, video_id);

-- Analyze the table to update statistics
ANALYZE view_snapshots;