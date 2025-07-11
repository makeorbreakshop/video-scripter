-- Create table for storing BERTopic cluster data with centroids
CREATE TABLE IF NOT EXISTS bertopic_clusters (
  cluster_id INTEGER PRIMARY KEY,
  topic_name TEXT NOT NULL,
  parent_topic TEXT NOT NULL,
  grandparent_topic TEXT NOT NULL,
  centroid_embedding VECTOR(512) NOT NULL,
  video_count INTEGER DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create indexes for efficient querying
CREATE INDEX IF NOT EXISTS idx_bertopic_parent_topic ON bertopic_clusters(parent_topic);
CREATE INDEX IF NOT EXISTS idx_bertopic_grandparent_topic ON bertopic_clusters(grandparent_topic);
CREATE INDEX IF NOT EXISTS idx_bertopic_topic_name ON bertopic_clusters(topic_name);

-- Create vector index for similarity search
CREATE INDEX IF NOT EXISTS idx_bertopic_centroid_embedding ON bertopic_clusters 
USING ivfflat (centroid_embedding vector_cosine_ops)
WITH (lists = 100);

-- Add comments
COMMENT ON TABLE bertopic_clusters IS 'BERTopic cluster data with centroid embeddings for real-time topic classification';
COMMENT ON COLUMN bertopic_clusters.cluster_id IS 'Unique cluster identifier from BERTopic analysis';
COMMENT ON COLUMN bertopic_clusters.topic_name IS 'Micro-topic name (most specific level)';
COMMENT ON COLUMN bertopic_clusters.parent_topic IS 'Niche topic name (mid-level)';
COMMENT ON COLUMN bertopic_clusters.grandparent_topic IS 'Domain topic name (highest level)';
COMMENT ON COLUMN bertopic_clusters.centroid_embedding IS 'Average embedding vector for videos in this cluster';
COMMENT ON COLUMN bertopic_clusters.video_count IS 'Number of videos assigned to this cluster';