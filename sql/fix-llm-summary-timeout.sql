-- Fix timeout issue for LLM summary queries
-- These indexes will significantly improve query performance

-- Add partial index on videos where llm_summary is NULL
-- This will speed up queries looking for videos without LLM summaries
CREATE INDEX IF NOT EXISTS idx_videos_llm_summary_null 
ON videos(id) 
WHERE llm_summary IS NULL;

-- Add composite index for pagination and filtering
-- This will help with queries that need both id and llm_summary columns
CREATE INDEX IF NOT EXISTS idx_videos_id_llm_summary 
ON videos(id, llm_summary);

-- Update table statistics to help the query planner make better decisions
ANALYZE videos;

-- Optional: Add index on created_at if temporal queries are common
-- Uncomment if you frequently filter by creation date
-- CREATE INDEX IF NOT EXISTS idx_videos_created_at ON videos(created_at);

-- Check index usage after creation
-- You can run this separately to verify the indexes are being used:
-- EXPLAIN (ANALYZE, BUFFERS) SELECT id FROM videos WHERE llm_summary IS NULL LIMIT 100;