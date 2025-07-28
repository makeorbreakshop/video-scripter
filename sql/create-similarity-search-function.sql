-- Create function for finding similar videos by embedding
-- Used by incremental clustering system for neighborhood detection

CREATE OR REPLACE FUNCTION find_similar_videos_by_embedding(
  query_embedding vector(512),
  similarity_threshold float DEFAULT 0.8,
  max_results int DEFAULT 100
)
RETURNS TABLE (
  id text,
  title text,
  channel_id text,
  channel_name text,
  view_count bigint,
  published_at timestamp with time zone,
  title_embedding vector(512),
  topic_cluster_id integer,
  similarity float
)
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  SELECT 
    v.id,
    v.title,
    v.channel_id,
    v.channel_name,
    v.view_count,
    v.published_at,
    v.title_embedding,
    v.topic_cluster_id,
    1 - (v.title_embedding <=> query_embedding) as similarity
  FROM videos v
  WHERE 
    v.title_embedding IS NOT NULL
    AND 1 - (v.title_embedding <=> query_embedding) >= similarity_threshold
  ORDER BY v.title_embedding <=> query_embedding
  LIMIT max_results;
END;
$$;

-- Create index for efficient similarity search if not exists
CREATE INDEX IF NOT EXISTS idx_videos_title_embedding_ivfflat 
ON videos USING ivfflat (title_embedding vector_cosine_ops)
WITH (lists = 100);

-- Grant execute permission to service role
GRANT EXECUTE ON FUNCTION find_similar_videos_by_embedding TO service_role;

-- Add comment
COMMENT ON FUNCTION find_similar_videos_by_embedding IS 
'Find videos similar to a given embedding vector. Used by incremental clustering for neighborhood detection.';