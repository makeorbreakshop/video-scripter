-- Pattern Mining Database Schema V2
-- This handles the existing 'patterns' table and creates our new structure

-- Rename existing patterns table to avoid conflicts
ALTER TABLE IF EXISTS patterns RENAME TO old_patterns;

-- Create new patterns table for pattern mining
CREATE TABLE patterns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pattern_type TEXT NOT NULL CHECK (pattern_type IN (
    'title', 'format', 'timing', 'duration', 'compound', 
    'title_structure', 'topic_cluster', 'thumbnail', 'script'
  )),
  pattern_data JSONB NOT NULL,
  performance_stats JSONB, -- All performance data (by region, over time)
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create video-pattern associations table
CREATE TABLE video_patterns (
  video_id TEXT REFERENCES videos(id) ON DELETE CASCADE,
  pattern_id UUID REFERENCES patterns(id) ON DELETE CASCADE,
  match_score FLOAT CHECK (match_score >= 0 AND match_score <= 1),
  discovered_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  PRIMARY KEY (video_id, pattern_id)
);

-- Create indexes for performance
CREATE INDEX idx_patterns_type ON patterns(pattern_type);
CREATE INDEX idx_patterns_created_at ON patterns(created_at);
CREATE INDEX idx_video_patterns_video ON video_patterns(video_id);
CREATE INDEX idx_video_patterns_pattern ON video_patterns(pattern_id);
CREATE INDEX idx_video_patterns_discovered ON video_patterns(discovered_at);

-- Add update trigger for patterns
CREATE OR REPLACE FUNCTION update_patterns_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER patterns_updated_at_trigger
  BEFORE UPDATE ON patterns
  FOR EACH ROW
  EXECUTE FUNCTION update_patterns_updated_at();

-- Add comments
COMMENT ON TABLE patterns IS 'Stores all discovered patterns from video analysis';
COMMENT ON TABLE video_patterns IS 'Associates videos with patterns they match';
COMMENT ON COLUMN patterns.pattern_type IS 'Type of pattern: title, format, timing, duration, compound, title_structure, topic_cluster, thumbnail, script';
COMMENT ON COLUMN patterns.pattern_data IS 'JSONB data containing all pattern details - structure varies by pattern_type';
COMMENT ON COLUMN patterns.performance_stats IS 'Performance metrics including overall stats, by_context breakdown, timeline, and saturation score';
COMMENT ON COLUMN video_patterns.match_score IS 'How well the video matches this pattern (0-1 scale)';

-- Note: If you want to keep the old patterns table, you can drop this line:
-- DROP TABLE IF EXISTS old_patterns;