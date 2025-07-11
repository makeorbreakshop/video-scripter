-- Add format classification columns to videos table
ALTER TABLE videos 
ADD COLUMN IF NOT EXISTS video_format text,
ADD COLUMN IF NOT EXISTS format_confidence numeric(3,2),
ADD COLUMN IF NOT EXISTS format_reasoning text,
ADD COLUMN IF NOT EXISTS classified_at timestamp with time zone;

-- Add index for better query performance
CREATE INDEX IF NOT EXISTS idx_videos_video_format ON videos(video_format);
CREATE INDEX IF NOT EXISTS idx_videos_classified_at ON videos(classified_at);
CREATE INDEX IF NOT EXISTS idx_videos_format_confidence ON videos(format_confidence);

-- Add constraint to ensure valid format values
ALTER TABLE videos 
ADD CONSTRAINT check_video_format 
CHECK (video_format IN ('tutorial', 'listicle', 'explainer', 'case_study', 'news_analysis', 'personal_story', 'product_focus') OR video_format IS NULL);

-- Add constraint for confidence values
ALTER TABLE videos 
ADD CONSTRAINT check_format_confidence 
CHECK (format_confidence >= 0 AND format_confidence <= 1);