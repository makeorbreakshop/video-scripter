-- Create table to track format detection learning
CREATE TABLE IF NOT EXISTS format_detection_feedback (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  video_id TEXT NOT NULL REFERENCES videos(id),
  video_title TEXT NOT NULL,
  channel_name TEXT,
  
  -- Keyword detection results
  keyword_format TEXT NOT NULL,
  keyword_confidence NUMERIC(3,2) NOT NULL,
  keyword_matches JSONB,
  
  -- LLM results (when used)
  llm_format TEXT,
  llm_confidence NUMERIC(3,2),
  llm_reasoning TEXT,
  
  -- Final decision
  final_format TEXT NOT NULL,
  final_confidence NUMERIC(3,2) NOT NULL,
  llm_was_used BOOLEAN NOT NULL,
  
  -- Metadata
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for analysis queries
CREATE INDEX idx_format_feedback_created ON format_detection_feedback(created_at DESC);
CREATE INDEX idx_format_feedback_llm_used ON format_detection_feedback(llm_was_used);
CREATE INDEX idx_format_feedback_confidence ON format_detection_feedback(keyword_confidence);

-- Add comment
COMMENT ON TABLE format_detection_feedback IS 'Tracks format detection decisions to improve keyword patterns over time';