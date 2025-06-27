-- YouTube Dashboard Database Setup
-- Run this in your Supabase SQL Editor

-- Create daily_analytics table for YouTube Analytics data
CREATE TABLE IF NOT EXISTS daily_analytics (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  video_id TEXT NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
  date DATE NOT NULL,
  views INTEGER NOT NULL DEFAULT 0,
  ctr FLOAT,
  retention_avg FLOAT,
  likes INTEGER DEFAULT 0,
  comments INTEGER DEFAULT 0,
  revenue_estimate FLOAT DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(video_id, date)
);

-- Create indexes for common query patterns
CREATE INDEX IF NOT EXISTS idx_daily_analytics_video_id ON daily_analytics(video_id);
CREATE INDEX IF NOT EXISTS idx_daily_analytics_date ON daily_analytics(date);
CREATE INDEX IF NOT EXISTS idx_daily_analytics_video_date ON daily_analytics(video_id, date);

-- Create updated_at trigger function (if it doesn't exist)
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Drop trigger if exists and create new one
DROP TRIGGER IF EXISTS update_daily_analytics_updated_at ON daily_analytics;
CREATE TRIGGER update_daily_analytics_updated_at 
    BEFORE UPDATE ON daily_analytics 
    FOR EACH ROW 
    EXECUTE FUNCTION update_updated_at_column();

-- Verify table creation
SELECT 'daily_analytics table created successfully' AS status;