-- Add index on llm_summary for faster queries
CREATE INDEX IF NOT EXISTS idx_videos_llm_summary_null 
ON videos(id) 
WHERE llm_summary IS NULL;

-- Add composite index for pagination
CREATE INDEX IF NOT EXISTS idx_videos_id_llm_summary 
ON videos(id, llm_summary);

-- Analyze table to update statistics
ANALYZE videos;