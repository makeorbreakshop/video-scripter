-- Pattern Mining Database Schema
-- This creates the 2-table structure for storing discovered patterns
-- and their associations with videos

-- Create patterns table for storing all discovered patterns
CREATE TABLE IF NOT EXISTS patterns (
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
CREATE TABLE IF NOT EXISTS video_patterns (
  video_id TEXT REFERENCES videos(id) ON DELETE CASCADE,
  pattern_id UUID REFERENCES patterns(id) ON DELETE CASCADE,
  match_score FLOAT CHECK (match_score >= 0 AND match_score <= 1), -- How well video matches pattern (0-1)
  discovered_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  PRIMARY KEY (video_id, pattern_id)
);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_patterns_type ON patterns(pattern_type);
CREATE INDEX IF NOT EXISTS idx_patterns_created_at ON patterns(created_at);
CREATE INDEX IF NOT EXISTS idx_video_patterns_video ON video_patterns(video_id);
CREATE INDEX IF NOT EXISTS idx_video_patterns_pattern ON video_patterns(pattern_id);
CREATE INDEX IF NOT EXISTS idx_video_patterns_discovered ON video_patterns(discovered_at);

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

-- Add comment descriptions
COMMENT ON TABLE patterns IS 'Stores all discovered patterns from video analysis';
COMMENT ON TABLE video_patterns IS 'Associates videos with patterns they match';
COMMENT ON COLUMN patterns.pattern_type IS 'Type of pattern: title, format, timing, duration, compound, title_structure, topic_cluster, thumbnail, script';
COMMENT ON COLUMN patterns.pattern_data IS 'JSONB data containing all pattern details - structure varies by pattern_type';
-- Note: Pattern semantic locations are stored in Pinecone, not in database
COMMENT ON COLUMN patterns.performance_stats IS 'Performance metrics including overall stats, by_context breakdown, timeline, and saturation score';
COMMENT ON COLUMN video_patterns.match_score IS 'How well the video matches this pattern (0-1 scale)';

-- Example pattern_data structures for reference:
-- Title Pattern:
-- {
--   "name": "Beginner mistakes format",
--   "template": "[SKILL_LEVEL] Mistakes I Made [CONTEXT]",
--   "examples": ["Beginner Mistakes I Made Woodworking"],
--   "discovery_method": "statistical_outlier",
--   "evidence_count": 47,
--   "confidence": 0.92
-- }

-- Duration Pattern:
-- {
--   "name": "Optimal tutorial length",
--   "duration_range": "15-20min",
--   "context": "woodworking_tutorials",
--   "discovery_method": "duration_analysis",
--   "evidence_count": 123,
--   "performance_vs_baseline": 2.3
-- }

-- Format Pattern:
-- {
--   "name": "Listicle dominance",
--   "format": "listicle",
--   "context": "beginner_woodworking",
--   "discovery_method": "format_outlier",
--   "evidence_count": 87,
--   "performance_lift": 3.2
-- }

-- Example performance_stats structure:
-- {
--   "overall": { "avg": 3.2, "median": 2.8, "count": 47 },
--   "by_context": {
--     "woodworking": { "avg": 5.1, "count": 12 },
--     "general_diy": { "avg": 2.1, "count": 35 }
--   },
--   "timeline": [
--     { "month": "2024-01", "performance": 3.5, "adopters": 5 },
--     { "month": "2024-02", "performance": 3.0, "adopters": 8 }
--   ],
--   "saturation_score": 0.3,
--   "lifecycle_stage": "growing"
-- }