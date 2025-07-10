-- Migration: Add Multi-Level BERTopic Topic Clustering
-- Replaces single topic_cluster with hierarchical topic system

BEGIN;

-- Rename existing column for backup (in case we need to rollback)
ALTER TABLE videos RENAME COLUMN topic_cluster TO topic_cluster_old;

-- Add new multi-level topic columns
ALTER TABLE videos ADD COLUMN topic_level_1 INTEGER;
ALTER TABLE videos ADD COLUMN topic_level_2 INTEGER; 
ALTER TABLE videos ADD COLUMN topic_level_3 INTEGER;

-- Add indexes for performance
CREATE INDEX idx_videos_topic_level_1 ON videos(topic_level_1);
CREATE INDEX idx_videos_topic_level_2 ON videos(topic_level_2);
CREATE INDEX idx_videos_topic_level_3 ON videos(topic_level_3);

-- Create topic metadata table for storing topic names and details
CREATE TABLE topic_categories (
  id SERIAL PRIMARY KEY,
  level INTEGER NOT NULL, -- 1, 2, or 3
  topic_id INTEGER NOT NULL, -- BERTopic topic ID
  name VARCHAR(255), -- Human-readable name (to be filled later)
  keywords TEXT[], -- Top keywords from BERTopic
  video_count INTEGER DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  
  -- Ensure unique combinations
  UNIQUE(level, topic_id)
);

-- Index for fast lookups
CREATE INDEX idx_topic_categories_level_topic ON topic_categories(level, topic_id);
CREATE INDEX idx_topic_categories_name ON topic_categories(name);

-- Add comments for documentation
COMMENT ON TABLE topic_categories IS 'Metadata for BERTopic clustering results at multiple hierarchy levels';
COMMENT ON COLUMN topic_categories.level IS 'Hierarchy level: 1=Broad Domains, 2=Niches, 3=Micro Topics';
COMMENT ON COLUMN topic_categories.topic_id IS 'BERTopic cluster ID (-1 for outliers)';
COMMENT ON COLUMN topic_categories.name IS 'Human-readable topic name (to be assigned via Claude Code analysis)';
COMMENT ON COLUMN topic_categories.keywords IS 'Top keywords from BERTopic topic modeling';

COMMENT ON COLUMN videos.topic_level_1 IS 'Broad domain topic (39 clusters): 3D Printing, Business, Woodworking, etc.';
COMMENT ON COLUMN videos.topic_level_2 IS 'Niche topic (181 clusters): Laser Tools, Food Recipes, Fitness, etc.';
COMMENT ON COLUMN videos.topic_level_3 IS 'Micro topic (557 clusters): Ring Making, Harbor Freight Tools, etc.';
COMMENT ON COLUMN videos.topic_cluster_old IS 'Legacy single-level topic clustering (backup)';

COMMIT;

-- Verification queries (run after import):
-- SELECT level, COUNT(*) as topic_count FROM topic_categories GROUP BY level ORDER BY level;
-- SELECT COUNT(*) as videos_with_level_1 FROM videos WHERE topic_level_1 IS NOT NULL;
-- SELECT COUNT(*) as videos_with_level_2 FROM videos WHERE topic_level_2 IS NOT NULL;
-- SELECT COUNT(*) as videos_with_level_3 FROM videos WHERE topic_level_3 IS NOT NULL;