-- Add video classification columns to videos table
-- Supports topic detection (3-level hierarchy) and format detection

-- Add topic classification columns
ALTER TABLE videos 
ADD COLUMN IF NOT EXISTS topic_domain TEXT,
ADD COLUMN IF NOT EXISTS topic_niche TEXT,
ADD COLUMN IF NOT EXISTS topic_micro TEXT,
ADD COLUMN IF NOT EXISTS topic_cluster_id INTEGER,
ADD COLUMN IF NOT EXISTS topic_confidence DECIMAL(3,2);

-- Add format classification columns
ALTER TABLE videos
ADD COLUMN IF NOT EXISTS format_type TEXT,
ADD COLUMN IF NOT EXISTS format_confidence DECIMAL(3,2),
ADD COLUMN IF NOT EXISTS format_llm_used BOOLEAN DEFAULT FALSE;

-- Add classification timestamp
ALTER TABLE videos
ADD COLUMN IF NOT EXISTS classified_at TIMESTAMP WITH TIME ZONE;

-- Create indexes for efficient querying
CREATE INDEX IF NOT EXISTS idx_videos_topic_domain ON videos(topic_domain);
CREATE INDEX IF NOT EXISTS idx_videos_topic_niche ON videos(topic_niche);
CREATE INDEX IF NOT EXISTS idx_videos_format_type ON videos(format_type);
CREATE INDEX IF NOT EXISTS idx_videos_topic_cluster ON videos(topic_cluster_id);
CREATE INDEX IF NOT EXISTS idx_videos_classified_at ON videos(classified_at);

-- Create composite indexes for common query patterns
CREATE INDEX IF NOT EXISTS idx_videos_topic_hierarchy ON videos(topic_domain, topic_niche, topic_micro);
CREATE INDEX IF NOT EXISTS idx_videos_format_confidence ON videos(format_type, format_confidence);

-- Add check constraints for confidence values
ALTER TABLE videos
ADD CONSTRAINT check_topic_confidence CHECK (topic_confidence >= 0 AND topic_confidence <= 1),
ADD CONSTRAINT check_format_confidence CHECK (format_confidence >= 0 AND format_confidence <= 1);

-- Add check constraint for valid format types
ALTER TABLE videos
ADD CONSTRAINT check_format_type CHECK (
  format_type IS NULL OR format_type IN (
    'tutorial',
    'listicle', 
    'explainer',
    'case_study',
    'news_analysis',
    'personal_story',
    'product_focus'
  )
);

-- Create view for classification statistics
CREATE OR REPLACE VIEW video_classification_stats AS
SELECT 
  -- Topic statistics
  COUNT(*) as total_videos,
  COUNT(topic_domain) as classified_videos,
  COUNT(CASE WHEN topic_confidence >= 0.8 THEN 1 END) as high_confidence_topics,
  COUNT(CASE WHEN topic_confidence < 0.6 THEN 1 END) as low_confidence_topics,
  AVG(topic_confidence) as avg_topic_confidence,
  
  -- Format statistics
  COUNT(format_type) as format_classified_videos,
  COUNT(CASE WHEN format_confidence >= 0.8 THEN 1 END) as high_confidence_formats,
  COUNT(CASE WHEN format_confidence < 0.6 THEN 1 END) as low_confidence_formats,
  COUNT(CASE WHEN format_llm_used = true THEN 1 END) as llm_classified_formats,
  AVG(format_confidence) as avg_format_confidence,
  
  -- Time-based statistics
  MIN(classified_at) as first_classification,
  MAX(classified_at) as latest_classification
FROM videos;

-- Create view for topic distribution
CREATE OR REPLACE VIEW topic_distribution AS
SELECT 
  topic_domain,
  topic_niche,
  topic_micro,
  COUNT(*) as video_count,
  AVG(topic_confidence) as avg_confidence,
  AVG(view_count) as avg_views,
  AVG(performance_ratio) as avg_performance
FROM videos
WHERE topic_domain IS NOT NULL
GROUP BY topic_domain, topic_niche, topic_micro
ORDER BY video_count DESC;

-- Create view for format distribution
CREATE OR REPLACE VIEW format_distribution AS
SELECT 
  format_type,
  COUNT(*) as video_count,
  AVG(format_confidence) as avg_confidence,
  COUNT(CASE WHEN format_llm_used = true THEN 1 END) as llm_count,
  AVG(view_count) as avg_views,
  AVG(performance_ratio) as avg_performance
FROM videos
WHERE format_type IS NOT NULL
GROUP BY format_type
ORDER BY video_count DESC;

-- Comment on new columns
COMMENT ON COLUMN videos.topic_domain IS 'High-level topic category (e.g., Technology, Entertainment)';
COMMENT ON COLUMN videos.topic_niche IS 'Mid-level topic category (e.g., Programming, Gaming)';
COMMENT ON COLUMN videos.topic_micro IS 'Specific topic (e.g., Python tutorials, Minecraft)';
COMMENT ON COLUMN videos.topic_cluster_id IS 'BERTopic cluster ID for this video';
COMMENT ON COLUMN videos.topic_confidence IS 'Confidence score for topic assignment (0-1)';
COMMENT ON COLUMN videos.format_type IS 'Video format classification (tutorial, listicle, etc.)';
COMMENT ON COLUMN videos.format_confidence IS 'Confidence score for format detection (0-1)';
COMMENT ON COLUMN videos.format_llm_used IS 'Whether LLM was used for format classification';
COMMENT ON COLUMN videos.classified_at IS 'Timestamp when video was classified';