-- Add worker control entries for classification workers

-- Format Classification Worker
INSERT INTO worker_control (worker_type, is_enabled, last_heartbeat, worker_info)
VALUES (
    'format_classification',
    false,
    CURRENT_TIMESTAMP,
    jsonb_build_object(
        'description', 'Classifies videos into content formats using LLM',
        'batch_size', 500,
        'processing_interval', '30 seconds',
        'requirements', ARRAY['OPENAI_API_KEY'],
        'features', ARRAY[
            'Batch processing with parallel LLM calls',
            'Token usage tracking',
            'Confidence scoring',
            'Automatic retry on errors'
        ]
    )
)
ON CONFLICT (worker_type) 
DO UPDATE SET 
    worker_info = EXCLUDED.worker_info,
    updated_at = CURRENT_TIMESTAMP;

-- Topic Classification Worker
INSERT INTO worker_control (worker_type, is_enabled, last_heartbeat, worker_info)
VALUES (
    'topic_classification',
    false,
    CURRENT_TIMESTAMP,
    jsonb_build_object(
        'description', 'Assigns hierarchical topics using BERTopic clusters',
        'batch_size', 100,
        'processing_interval', '30 seconds',
        'requirements', ARRAY['BERTopic clusters', 'Title embeddings'],
        'features', ARRAY[
            'K-nearest neighbor classification',
            'Local processing (no API calls)',
            'Hierarchical topic assignment',
            'Confidence scoring with reasoning'
        ]
    )
)
ON CONFLICT (worker_type) 
DO UPDATE SET 
    worker_info = EXCLUDED.worker_info,
    updated_at = CURRENT_TIMESTAMP;

-- Combined Video Classification Worker
INSERT INTO worker_control (worker_type, is_enabled, last_heartbeat, worker_info)
VALUES (
    'video_classification',
    false,
    CURRENT_TIMESTAMP,
    jsonb_build_object(
        'description', 'Combined worker for both topic and format classification',
        'batch_size', 50,
        'processing_interval', '30 seconds',
        'requirements', ARRAY['OPENAI_API_KEY', 'BERTopic clusters', 'Title embeddings'],
        'features', ARRAY[
            'Intelligent batching by classification needs',
            'Both topic and format in single pass',
            'Low confidence case tracking',
            'Comprehensive progress reporting'
        ]
    )
)
ON CONFLICT (worker_type) 
DO UPDATE SET 
    worker_info = EXCLUDED.worker_info,
    updated_at = CURRENT_TIMESTAMP;

-- Add indexes for better query performance
CREATE INDEX IF NOT EXISTS idx_videos_classification_status 
ON videos (format_type, topic_domain, channel_id) 
WHERE channel_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_videos_format_confidence 
ON videos (format_confidence) 
WHERE format_type IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_videos_topic_confidence 
ON videos (topic_confidence) 
WHERE topic_domain IS NOT NULL;

-- Add a view for classification progress
CREATE OR REPLACE VIEW classification_progress AS
SELECT 
    COUNT(*) FILTER (WHERE channel_id IS NOT NULL) as total_videos,
    COUNT(*) FILTER (WHERE format_type IS NOT NULL) as format_classified,
    COUNT(*) FILTER (WHERE topic_domain IS NOT NULL) as topic_classified,
    COUNT(*) FILTER (WHERE format_type IS NOT NULL AND topic_domain IS NOT NULL) as fully_classified,
    COUNT(*) FILTER (WHERE title_embedding IS NOT NULL) as has_embeddings,
    COUNT(*) FILTER (WHERE classification_llm_used = true) as llm_classified,
    ROUND(AVG(format_confidence) FILTER (WHERE format_type IS NOT NULL)::numeric, 3) as avg_format_confidence,
    ROUND(AVG(topic_confidence) FILTER (WHERE topic_domain IS NOT NULL)::numeric, 3) as avg_topic_confidence
FROM videos
WHERE channel_id IS NOT NULL;