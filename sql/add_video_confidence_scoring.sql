-- Add confidence-based scoring to videos table for handling recency bias
-- This helps us avoid using very recent videos in pattern discovery

-- Add velocity tracking columns (for future use)
ALTER TABLE videos ADD COLUMN IF NOT EXISTS first_day_views INTEGER;
ALTER TABLE videos ADD COLUMN IF NOT EXISTS first_week_views INTEGER;
ALTER TABLE videos ADD COLUMN IF NOT EXISTS first_month_views INTEGER;
ALTER TABLE videos ADD COLUMN IF NOT EXISTS view_velocity_7d FLOAT;
ALTER TABLE videos ADD COLUMN IF NOT EXISTS view_velocity_30d FLOAT;

-- Add age-based confidence score (0-1 scale)
-- Videos under 30 days old get progressively lower confidence
-- We'll calculate this in application code since NOW() is not immutable
ALTER TABLE videos ADD COLUMN IF NOT EXISTS age_confidence FLOAT;

-- Add index for efficient filtering by confidence
CREATE INDEX IF NOT EXISTS idx_videos_age_confidence ON videos(age_confidence);

-- Function to calculate age confidence
CREATE OR REPLACE FUNCTION calculate_age_confidence(published_at TIMESTAMP WITH TIME ZONE)
RETURNS FLOAT AS $$
BEGIN
  RETURN LEAST(
    EXTRACT(EPOCH FROM (NOW() - published_at)) / (86400 * 30), -- Days old / 30
    1.0 -- Cap at 1.0
  );
END;
$$ LANGUAGE plpgsql;

-- Example usage:
-- To get only videos with high confidence for pattern discovery:
-- SELECT * FROM videos WHERE calculate_age_confidence(published_at) > 0.8;
-- This gives us videos that are at least 24 days old (0.8 * 30 = 24)

-- To update all videos with their confidence scores:
-- UPDATE videos SET age_confidence = calculate_age_confidence(published_at);

-- To display confidence levels for users:
-- < 7 days: 0-23% confidence
-- 7-14 days: 23-47% confidence  
-- 14-21 days: 47-70% confidence
-- 21-30 days: 70-100% confidence
-- > 30 days: 100% confidence