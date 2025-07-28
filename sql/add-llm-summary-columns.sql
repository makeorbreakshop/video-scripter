-- Add LLM summary columns to videos table
ALTER TABLE videos 
ADD COLUMN IF NOT EXISTS llm_summary TEXT,
ADD COLUMN IF NOT EXISTS llm_summary_generated_at TIMESTAMP,
ADD COLUMN IF NOT EXISTS llm_summary_model VARCHAR(50),
ADD COLUMN IF NOT EXISTS llm_summary_embedding_synced BOOLEAN DEFAULT FALSE;

-- Create index for efficient querying
CREATE INDEX IF NOT EXISTS idx_videos_llm_summary_status 
ON videos(llm_summary_generated_at, llm_summary_embedding_synced) 
WHERE llm_summary IS NOT NULL;

-- Create a view for tracking summary generation progress
CREATE OR REPLACE VIEW llm_summary_status AS
SELECT 
  COUNT(*) AS total_videos,
  COUNT(llm_summary) AS summaries_generated,
  COUNT(CASE WHEN llm_summary_embedding_synced THEN 1 END) AS embeddings_synced,
  COUNT(*) - COUNT(llm_summary) AS pending_summaries,
  COUNT(llm_summary) - COUNT(CASE WHEN llm_summary_embedding_synced THEN 1 END) AS pending_embeddings
FROM videos
WHERE description IS NOT NULL 
  AND LENGTH(description) >= 50;