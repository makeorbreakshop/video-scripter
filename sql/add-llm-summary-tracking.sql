-- Add timestamp column to track when LLM summary was generated
ALTER TABLE videos 
ADD COLUMN IF NOT EXISTS llm_summary_generated_at TIMESTAMP WITH TIME ZONE;

-- Create index for efficient querying of videos needing summaries
CREATE INDEX IF NOT EXISTS idx_videos_llm_summary_null 
ON videos(id) 
WHERE llm_summary IS NULL;

-- Create worker_controls table if it doesn't exist
CREATE TABLE IF NOT EXISTS worker_controls (
  worker_type TEXT PRIMARY KEY,
  is_enabled BOOLEAN DEFAULT false,
  last_enabled_at TIMESTAMP WITH TIME ZONE,
  last_disabled_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Insert default control for LLM summary worker
INSERT INTO worker_controls (worker_type, is_enabled)
VALUES ('llm_summary', false)
ON CONFLICT (worker_type) DO NOTHING;