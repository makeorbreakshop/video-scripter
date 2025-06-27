-- YouTube Analytics Daily Data Table
-- This extends the existing video-scripter database schema
-- to support the YouTube Dashboard with analytics data

-- Create daily_analytics table for YouTube analytics data
CREATE TABLE IF NOT EXISTS daily_analytics (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  video_id TEXT NOT NULL REFERENCES videos(id),
  date DATE NOT NULL,
  views INTEGER NOT NULL,
  ctr FLOAT,
  retention_avg FLOAT,
  likes INTEGER,
  comments INTEGER,
  revenue_estimate FLOAT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(video_id, date)
);

-- Add indexes for common query patterns
CREATE INDEX IF NOT EXISTS idx_daily_analytics_video_id ON daily_analytics(video_id);
CREATE INDEX IF NOT EXISTS idx_daily_analytics_date ON daily_analytics(date);
CREATE INDEX IF NOT EXISTS idx_daily_analytics_video_date ON daily_analytics(video_id, date);

-- Add updated_at trigger
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

DROP TRIGGER IF EXISTS update_daily_analytics_updated_at ON daily_analytics;
CREATE TRIGGER update_daily_analytics_updated_at 
    BEFORE UPDATE ON daily_analytics 
    FOR EACH ROW 
    EXECUTE FUNCTION update_updated_at_column();

-- Phase 2: Content classifications table (future)
CREATE TABLE IF NOT EXISTS content_classifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  video_id TEXT NOT NULL REFERENCES videos(id),
  content_type TEXT NOT NULL,
  confidence_score FLOAT,
  title_patterns JSONB,
  thumbnail_elements JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Add indexes for content classifications
CREATE INDEX IF NOT EXISTS idx_content_classifications_video_id ON content_classifications(video_id);
CREATE INDEX IF NOT EXISTS idx_content_classifications_type ON content_classifications(content_type);