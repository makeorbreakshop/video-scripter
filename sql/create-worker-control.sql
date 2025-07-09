-- Create worker control table
CREATE TABLE IF NOT EXISTS worker_control (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  worker_type VARCHAR(50) NOT NULL UNIQUE,
  is_enabled BOOLEAN DEFAULT false,
  last_enabled_at TIMESTAMPTZ,
  last_disabled_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Create index on worker_type for quick lookups
CREATE INDEX idx_worker_control_type ON worker_control(worker_type);

-- Insert default worker controls
INSERT INTO worker_control (worker_type, is_enabled) VALUES
  ('title_vectorization', false),
  ('thumbnail_vectorization', false)
ON CONFLICT (worker_type) DO NOTHING;

-- Add RLS policies
ALTER TABLE worker_control ENABLE ROW LEVEL SECURITY;

-- Allow authenticated users to read worker status
CREATE POLICY "Users can view worker control status" ON worker_control
  FOR SELECT TO authenticated USING (true);

-- Only service role can update worker control
CREATE POLICY "Service role can update worker control" ON worker_control
  FOR ALL TO service_role USING (true);