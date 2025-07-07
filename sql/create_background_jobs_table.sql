-- Create background jobs tracking table
CREATE TABLE IF NOT EXISTS background_jobs (
  id TEXT PRIMARY KEY,
  job_type TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'running', 'completed', 'failed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  error_message TEXT,
  metadata JSONB DEFAULT '{}',
  
  -- Indexes for performance
  CONSTRAINT background_jobs_created_at_idx CHECK (created_at IS NOT NULL)
);

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_background_jobs_type_status ON background_jobs(job_type, status);
CREATE INDEX IF NOT EXISTS idx_background_jobs_created_at ON background_jobs(created_at DESC);

-- Insert a sample record to test
INSERT INTO background_jobs (id, job_type, status, metadata) 
VALUES ('test_job_1', 'baseline_calculation', 'pending', '{"test": true}')
ON CONFLICT (id) DO NOTHING;