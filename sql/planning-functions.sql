-- SQL functions for the video planning system
-- These functions can be added to Supabase to enable vector similarity search

-- Function to search videos by embedding for planning
CREATE OR REPLACE FUNCTION search_videos_by_embedding(
  query_embedding vector(512),
  match_threshold float DEFAULT 0.7,
  match_count int DEFAULT 50
)
RETURNS TABLE(
  id text,
  title text,
  channel_name text,
  view_count bigint,
  like_count bigint,
  comment_count bigint,
  published_at timestamptz,
  duration text,
  thumbnail_url text,
  description text,
  similarity float
)
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  SELECT 
    v.id,
    v.title,
    v.channel_name,
    v.view_count::bigint,
    v.like_count::bigint,
    v.comment_count::bigint,
    v.published_at,
    v.duration,
    v.thumbnail_url,
    v.description,
    1 - (v.title_embedding <=> query_embedding) as similarity
  FROM videos v
  WHERE v.title_embedding IS NOT NULL
    AND 1 - (v.title_embedding <=> query_embedding) > match_threshold
  ORDER BY v.title_embedding <=> query_embedding
  LIMIT match_count;
END;
$$;

-- Function to search for outlier videos
CREATE OR REPLACE FUNCTION search_outlier_videos(
  query_embedding vector(512),
  start_date timestamptz,
  match_threshold float DEFAULT 0.7,
  match_count int DEFAULT 100
)
RETURNS TABLE(
  id text,
  title text,
  channel_name text,
  view_count bigint,
  like_count bigint,
  comment_count bigint,
  published_at timestamptz,
  duration text,
  thumbnail_url text,
  description text,
  outlier_factor float,
  performance_ratio float,
  similarity float
)
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  SELECT 
    v.id,
    v.title,
    v.channel_name,
    v.view_count::bigint,
    v.like_count::bigint,
    v.comment_count::bigint,
    v.published_at,
    v.duration,
    v.thumbnail_url,
    v.description,
    v.outlier_factor,
    v.performance_ratio,
    1 - (v.title_embedding <=> query_embedding) as similarity
  FROM videos v
  WHERE v.title_embedding IS NOT NULL
    AND v.published_at >= start_date
    AND 1 - (v.title_embedding <=> query_embedding) > match_threshold
    AND v.view_count > 0
  ORDER BY 
    -- Score based on performance metrics
    (v.view_count::float / GREATEST(1, EXTRACT(EPOCH FROM (NOW() - v.published_at)) / 86400)) * 
    COALESCE(v.outlier_factor, 1) *
    COALESCE(v.performance_ratio, 1) *
    (1 - (v.title_embedding <=> query_embedding)) DESC
  LIMIT match_count;
END;
$$;

-- Grant execute permissions
GRANT EXECUTE ON FUNCTION search_videos_by_embedding(vector, float, int) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION search_outlier_videos(vector, timestamptz, float, int) TO anon, authenticated;

-- Create indexes for better performance
CREATE INDEX IF NOT EXISTS idx_videos_title_embedding ON videos USING ivfflat (title_embedding vector_cosine_ops);
CREATE INDEX IF NOT EXISTS idx_videos_published_at ON videos (published_at DESC);
CREATE INDEX IF NOT EXISTS idx_videos_view_count ON videos (view_count DESC);
CREATE INDEX IF NOT EXISTS idx_videos_outlier_factor ON videos (outlier_factor DESC);