-- Add missing classification columns to videos table
-- Some columns were already added, this adds the remaining ones

ALTER TABLE videos 
ADD COLUMN IF NOT EXISTS format_primary text,
ADD COLUMN IF NOT EXISTS classification_llm_used boolean DEFAULT false,
ADD COLUMN IF NOT EXISTS classification_timestamp timestamptz;

-- Create indexes for the new columns if they don't exist
CREATE INDEX IF NOT EXISTS idx_videos_format_primary ON videos(format_primary);
CREATE INDEX IF NOT EXISTS idx_videos_classification_timestamp ON videos(classification_timestamp);

-- Create a view to see classification statistics
CREATE OR REPLACE VIEW video_classification_stats AS
SELECT 
    topic_domain,
    topic_niche,
    format_primary,
    COUNT(*) as video_count,
    AVG(topic_confidence) as avg_topic_confidence,
    AVG(format_confidence) as avg_format_confidence,
    SUM(CASE WHEN classification_llm_used THEN 1 ELSE 0 END) as llm_used_count,
    MIN(classification_timestamp) as first_classified,
    MAX(classification_timestamp) as last_classified
FROM videos
WHERE topic_domain IS NOT NULL OR format_primary IS NOT NULL
GROUP BY topic_domain, topic_niche, format_primary;

-- Check what columns we have now
SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_schema = 'public' 
AND table_name = 'videos'
AND column_name LIKE '%topic%' OR column_name LIKE '%format%' OR column_name LIKE '%classification%'
ORDER BY ordinal_position;