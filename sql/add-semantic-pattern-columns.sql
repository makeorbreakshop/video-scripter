-- Migration: Add semantic pattern support
-- Run this script to enable semantic pattern discovery

-- Add semantic pattern columns to patterns table
ALTER TABLE patterns 
ADD COLUMN IF NOT EXISTS centroid_embedding VECTOR(512),
ADD COLUMN IF NOT EXISTS semantic_radius FLOAT DEFAULT 0.2;

-- Create index for vector similarity search
CREATE INDEX IF NOT EXISTS idx_patterns_centroid_embedding 
ON patterns USING ivfflat (centroid_embedding vector_cosine_ops)
WITH (lists = 100);

-- Add computed age_days column to videos for easier filtering
ALTER TABLE videos 
ADD COLUMN IF NOT EXISTS age_days INTEGER GENERATED ALWAYS AS 
  (EXTRACT(EPOCH FROM (NOW() - published_at)) / 86400)::INTEGER STORED;

-- Create index for age_days
CREATE INDEX IF NOT EXISTS idx_videos_age_days ON videos(age_days);

-- Create a view for high-performing videos
CREATE OR REPLACE VIEW high_performing_videos AS
SELECT 
  v.*,
  v.view_count::FLOAT / NULLIF(v.channel_average_views, 0) as performance_ratio
FROM videos v
WHERE 
  v.view_count > 0 
  AND v.channel_average_views > 0
  AND v.age_days >= 30
  AND (v.view_count::FLOAT / v.channel_average_views) >= 2.0;

-- Create materialized view for semantic cluster performance
CREATE MATERIALIZED VIEW IF NOT EXISTS semantic_cluster_stats AS
WITH video_embeddings AS (
  SELECT 
    v.id,
    v.title,
    v.view_count,
    v.channel_average_views,
    v.format,
    v.duration_seconds,
    v.published_at,
    v.age_days,
    v.view_count::FLOAT / NULLIF(v.channel_average_views, 0) as performance_ratio
  FROM videos v
  WHERE 
    v.pinecone_embedded = true
    AND v.view_count > 0
    AND v.channel_average_views > 0
    AND v.age_days >= 30
)
SELECT 
  COUNT(*) as total_videos,
  COUNT(CASE WHEN performance_ratio >= 2.0 THEN 1 END) as high_performers,
  AVG(performance_ratio) as avg_performance,
  PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY performance_ratio) as median_performance,
  MAX(view_count) as max_views,
  COUNT(DISTINCT format) as unique_formats
FROM video_embeddings;

-- Create index on materialized view
CREATE UNIQUE INDEX IF NOT EXISTS idx_semantic_cluster_stats ON semantic_cluster_stats (total_videos);

-- Refresh the materialized view
REFRESH MATERIALIZED VIEW semantic_cluster_stats;