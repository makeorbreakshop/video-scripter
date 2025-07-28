-- Create table for tracking cluster assignment logs and workflow execution
CREATE TABLE IF NOT EXISTS cluster_assignment_logs (
  id SERIAL PRIMARY KEY,
  log_type VARCHAR(50) NOT NULL,
  stats JSONB NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create indexes for efficient querying
CREATE INDEX IF NOT EXISTS idx_cluster_logs_type ON cluster_assignment_logs(log_type);
CREATE INDEX IF NOT EXISTS idx_cluster_logs_created ON cluster_assignment_logs(created_at);
CREATE INDEX IF NOT EXISTS idx_cluster_logs_type_created ON cluster_assignment_logs(log_type, created_at DESC);

-- Add comments
COMMENT ON TABLE cluster_assignment_logs IS 'Logs for incremental clustering system workflow and statistics';
COMMENT ON COLUMN cluster_assignment_logs.log_type IS 'Type of log entry (incremental_assignment, drift_detection, workflow_*, etc.)';
COMMENT ON COLUMN cluster_assignment_logs.stats IS 'JSON statistics and details for the log entry';