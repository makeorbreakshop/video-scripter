-- Thumbnail Embeddings Database Migration
-- Run these commands in your Supabase SQL editor

-- 1. Add new columns to videos table for thumbnail embeddings
ALTER TABLE videos 
ADD COLUMN embedding_thumbnail_synced boolean DEFAULT false,
ADD COLUMN thumbnail_embedding_version varchar(50),
ADD COLUMN thumbnail_analysis_metadata jsonb;

-- 2. Create indexes for performance
CREATE INDEX idx_videos_thumbnail_synced ON videos(embedding_thumbnail_synced);
CREATE INDEX idx_videos_thumbnail_version ON videos(thumbnail_embedding_version);
CREATE INDEX idx_videos_thumbnail_analysis ON videos USING GIN(thumbnail_analysis_metadata);

-- 3. Add comment documentation
COMMENT ON COLUMN videos.embedding_thumbnail_synced IS 'Tracks whether thumbnail has been processed for embeddings';
COMMENT ON COLUMN videos.thumbnail_embedding_version IS 'Version of embedding model used (e.g., clip-vit-large-patch14)';
COMMENT ON COLUMN videos.thumbnail_analysis_metadata IS 'JSON metadata for thumbnail analysis results (clusters, similarity scores, etc.)';

-- 4. Create a view for easily finding unprocessed thumbnails
CREATE OR REPLACE VIEW unprocessed_thumbnails AS
SELECT 
    id,
    title,
    thumbnail_url,
    published_at,
    view_count,
    like_count,
    performance_ratio,
    channel_name
FROM videos 
WHERE thumbnail_url IS NOT NULL 
    AND (embedding_thumbnail_synced = false OR embedding_thumbnail_synced IS NULL)
ORDER BY published_at DESC;

-- 5. Create a view for 2024 videos specifically
CREATE OR REPLACE VIEW videos_2024_unprocessed AS
SELECT 
    id,
    title,
    thumbnail_url,
    published_at,
    view_count,
    like_count,
    performance_ratio,
    channel_name,
    channel_id
FROM videos 
WHERE thumbnail_url IS NOT NULL 
    AND (embedding_thumbnail_synced = false OR embedding_thumbnail_synced IS NULL)
    AND published_at >= '2024-01-01'::timestamp
    AND published_at < '2025-01-01'::timestamp
ORDER BY published_at DESC;

-- 6. Function to get thumbnail processing statistics
CREATE OR REPLACE FUNCTION get_thumbnail_processing_stats()
RETURNS TABLE(
    total_videos_with_thumbnails bigint,
    processed_thumbnails bigint,
    unprocessed_thumbnails bigint,
    videos_2024_total bigint,
    videos_2024_unprocessed bigint,
    processing_percentage numeric
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        (SELECT COUNT(*) FROM videos WHERE thumbnail_url IS NOT NULL) as total_videos_with_thumbnails,
        (SELECT COUNT(*) FROM videos WHERE thumbnail_url IS NOT NULL AND embedding_thumbnail_synced = true) as processed_thumbnails,
        (SELECT COUNT(*) FROM videos WHERE thumbnail_url IS NOT NULL AND (embedding_thumbnail_synced = false OR embedding_thumbnail_synced IS NULL)) as unprocessed_thumbnails,
        (SELECT COUNT(*) FROM videos WHERE thumbnail_url IS NOT NULL AND published_at >= '2024-01-01' AND published_at < '2025-01-01') as videos_2024_total,
        (SELECT COUNT(*) FROM videos_2024_unprocessed) as videos_2024_unprocessed,
        CASE 
            WHEN (SELECT COUNT(*) FROM videos WHERE thumbnail_url IS NOT NULL) > 0 
            THEN ROUND(
                (SELECT COUNT(*) FROM videos WHERE thumbnail_url IS NOT NULL AND embedding_thumbnail_synced = true)::numeric / 
                (SELECT COUNT(*) FROM videos WHERE thumbnail_url IS NOT NULL)::numeric * 100, 2
            )
            ELSE 0
        END as processing_percentage;
END;
$$ LANGUAGE plpgsql;

-- 7. Function to mark thumbnail as processed
CREATE OR REPLACE FUNCTION mark_thumbnail_processed(
    video_id text,
    embedding_version varchar(50) DEFAULT 'clip-vit-large-patch14',
    analysis_data jsonb DEFAULT NULL
)
RETURNS boolean AS $$
BEGIN
    UPDATE videos 
    SET 
        embedding_thumbnail_synced = true,
        thumbnail_embedding_version = embedding_version,
        thumbnail_analysis_metadata = COALESCE(analysis_data, '{}'),
        updated_at = NOW()
    WHERE id = video_id;
    
    RETURN FOUND;
END;
$$ LANGUAGE plpgsql;

-- 8. Function to batch mark thumbnails as processed
CREATE OR REPLACE FUNCTION batch_mark_thumbnails_processed(
    video_ids text[],
    embedding_version varchar(50) DEFAULT 'clip-vit-large-patch14'
)
RETURNS integer AS $$
DECLARE
    update_count integer;
BEGIN
    UPDATE videos 
    SET 
        embedding_thumbnail_synced = true,
        thumbnail_embedding_version = embedding_version,
        updated_at = NOW()
    WHERE id = ANY(video_ids);
    
    GET DIAGNOSTICS update_count = ROW_COUNT;
    RETURN update_count;
END;
$$ LANGUAGE plpgsql;

-- 9. Function to reset thumbnail processing (for reprocessing)
CREATE OR REPLACE FUNCTION reset_thumbnail_processing(
    reset_all boolean DEFAULT false,
    specific_version varchar(50) DEFAULT NULL
)
RETURNS integer AS $$
DECLARE
    update_count integer;
BEGIN
    IF reset_all THEN
        UPDATE videos 
        SET 
            embedding_thumbnail_synced = false,
            thumbnail_embedding_version = NULL,
            thumbnail_analysis_metadata = NULL,
            updated_at = NOW()
        WHERE thumbnail_url IS NOT NULL;
    ELSIF specific_version IS NOT NULL THEN
        UPDATE videos 
        SET 
            embedding_thumbnail_synced = false,
            thumbnail_embedding_version = NULL,
            thumbnail_analysis_metadata = NULL,
            updated_at = NOW()
        WHERE thumbnail_url IS NOT NULL 
            AND thumbnail_embedding_version = specific_version;
    ELSE
        RAISE EXCEPTION 'Must specify either reset_all=true or provide specific_version';
    END IF;
    
    GET DIAGNOSTICS update_count = ROW_COUNT;
    RETURN update_count;
END;
$$ LANGUAGE plpgsql;

-- 10. Verify the migration
SELECT 'Migration completed successfully!' as status;

-- Check the new columns exist
SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns 
WHERE table_name = 'videos' 
    AND column_name IN ('embedding_thumbnail_synced', 'thumbnail_embedding_version', 'thumbnail_analysis_metadata');

-- Show current statistics
SELECT * FROM get_thumbnail_processing_stats();