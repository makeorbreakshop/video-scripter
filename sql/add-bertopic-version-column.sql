-- Add bertopic_version column to track which model version classified each video
-- This allows for A/B testing and gradual rollouts of new models

ALTER TABLE videos 
ADD COLUMN IF NOT EXISTS bertopic_version TEXT;

-- Create index for efficient queries by model version
CREATE INDEX IF NOT EXISTS idx_videos_bertopic_version 
ON videos(bertopic_version) 
WHERE bertopic_version IS NOT NULL;

-- Create index for finding videos that need classification
CREATE INDEX IF NOT EXISTS idx_videos_need_bertopic 
ON videos(id) 
WHERE bertopic_version IS NULL;

-- Add comment explaining the column
COMMENT ON COLUMN videos.bertopic_version IS 'Version of BERTopic model used for classification (e.g., v1_2025-08-01)';