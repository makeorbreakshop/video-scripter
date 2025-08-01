-- Create indexes to reduce IOPS for embedding queries
-- These indexes will dramatically reduce page reads when filtering by embedding status

-- 1. Composite index for videos with both embeddings
CREATE INDEX IF NOT EXISTS idx_videos_both_embeddings 
ON videos(pinecone_embedded, llm_summary_embedding_synced) 
WHERE pinecone_embedded = true AND llm_summary_embedding_synced = true;

-- 2. Single column indexes for individual checks
CREATE INDEX IF NOT EXISTS idx_videos_pinecone_embedded 
ON videos(pinecone_embedded) 
WHERE pinecone_embedded = true;

CREATE INDEX IF NOT EXISTS idx_videos_llm_summary_synced 
ON videos(llm_summary_embedding_synced) 
WHERE llm_summary_embedding_synced = true;

-- 3. Covering index that includes commonly selected columns
-- This allows index-only scans, avoiding table access entirely
CREATE INDEX IF NOT EXISTS idx_videos_embeddings_covering
ON videos(id, title, topic_confidence)
WHERE pinecone_embedded = true AND llm_summary_embedding_synced = true;

-- 4. Update table statistics for better query planning
ANALYZE videos;

-- Check index usage
SELECT 
    schemaname,
    tablename,
    indexname,
    idx_scan as index_scans,
    idx_tup_read as tuples_read,
    idx_tup_fetch as tuples_fetched
FROM pg_stat_user_indexes
WHERE tablename = 'videos'
ORDER BY idx_scan DESC;