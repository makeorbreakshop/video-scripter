-- Step 1: Add the missing columns first
ALTER TABLE videos 
ADD COLUMN IF NOT EXISTS format_primary text,
ADD COLUMN IF NOT EXISTS classification_llm_used boolean DEFAULT false,
ADD COLUMN IF NOT EXISTS classification_timestamp timestamptz;

-- Step 2: Create indexes for the new columns
CREATE INDEX IF NOT EXISTS idx_videos_format_primary ON videos(format_primary);
CREATE INDEX IF NOT EXISTS idx_videos_classification_timestamp ON videos(classification_timestamp);

-- Step 3: Drop the view if it exists (to avoid the error)
DROP VIEW IF EXISTS video_classification_stats;

-- Step 4: Create the view fresh
CREATE VIEW video_classification_stats AS
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

-- Step 5: Verify all columns are now present
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_schema = 'public' 
AND table_name = 'videos'
AND column_name IN (
    'topic_domain', 'topic_niche', 'topic_micro', 'topic_cluster_id', 'topic_confidence',
    'format_primary', 'format_confidence', 'classification_llm_used', 'classification_timestamp'
)
ORDER BY column_name;