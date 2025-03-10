-- Schema for YouTube content analysis with vector embeddings

-- Videos table - stores metadata about each YouTube video
CREATE TABLE IF NOT EXISTS public.videos (
    id TEXT PRIMARY KEY, -- YouTube video ID
    channel_id TEXT NOT NULL,
    title TEXT NOT NULL,
    description TEXT,
    published_at TIMESTAMPTZ NOT NULL,
    view_count INTEGER NOT NULL,
    like_count INTEGER,
    comment_count INTEGER,
    duration TEXT,
    channel_avg_views FLOAT,
    performance_ratio FLOAT, -- views relative to channel average
    metadata JSONB, -- additional flexible metadata
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Chunks table - stores transcript chunks with vector embeddings
CREATE TABLE IF NOT EXISTS public.chunks (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    video_id TEXT NOT NULL REFERENCES public.videos(id) ON DELETE CASCADE,
    content TEXT NOT NULL,
    content_type TEXT NOT NULL DEFAULT 'transcript', -- 'transcript', 'comment', 'description', etc.
    start_time FLOAT, -- For transcript chunks, start time in seconds
    end_time FLOAT,   -- For transcript chunks, end time in seconds
    embedding VECTOR(1536), -- Claude embedding dimension
    metadata JSONB,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_videos_user_id ON public.videos(user_id);
CREATE INDEX IF NOT EXISTS idx_videos_channel_id ON public.videos(channel_id);
CREATE INDEX IF NOT EXISTS idx_chunks_video_id ON public.chunks(video_id);
CREATE INDEX IF NOT EXISTS idx_chunks_user_id ON public.chunks(user_id);
CREATE INDEX IF NOT EXISTS idx_chunks_content_type ON public.chunks(content_type);

-- Create vector similarity search index
-- Using IVFFlat index for larger datasets (adjust lists parameter based on data size)
CREATE INDEX IF NOT EXISTS idx_chunks_embedding ON public.chunks
USING ivfflat (embedding vector_cosine_ops)
WITH (lists = 100);

-- Row Level Security (RLS) Policies
-- Secure the tables so users can only access their own data

-- Videos table policies
ALTER TABLE public.videos ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own videos" ON public.videos
    FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own videos" ON public.videos
    FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own videos" ON public.videos
    FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own videos" ON public.videos
    FOR DELETE USING (auth.uid() = user_id);

-- Chunks table policies
ALTER TABLE public.chunks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own chunks" ON public.chunks
    FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own chunks" ON public.chunks
    FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own chunks" ON public.chunks
    FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own chunks" ON public.chunks
    FOR DELETE USING (auth.uid() = user_id);

-- Helper functions for vector similarity search

-- Function to search for similar chunks across all videos
CREATE OR REPLACE FUNCTION search_video_chunks(
    query_embedding VECTOR(1536),
    match_threshold FLOAT DEFAULT 0.7,
    match_count INT DEFAULT 10,
    p_user_id UUID DEFAULT NULL
)
RETURNS TABLE (
    id UUID,
    video_id TEXT,
    content TEXT,
    content_type TEXT,
    start_time FLOAT,
    end_time FLOAT,
    similarity FLOAT,
    metadata JSONB
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    RETURN QUERY
    SELECT
        c.id,
        c.video_id,
        c.content,
        c.content_type,
        c.start_time,
        c.end_time,
        1 - (c.embedding <=> query_embedding) AS similarity,
        c.metadata
    FROM
        public.chunks c
    WHERE
        1 - (c.embedding <=> query_embedding) > match_threshold
        AND (p_user_id IS NULL AND c.user_id = auth.uid() OR c.user_id = p_user_id)
    ORDER BY
        c.embedding <=> query_embedding
    LIMIT match_count;
END;
$$;

-- Function to search for similar chunks within a specific video
CREATE OR REPLACE FUNCTION search_video_by_id(
    video_id TEXT,
    query_embedding VECTOR(1536),
    match_threshold FLOAT DEFAULT 0.7,
    match_count INT DEFAULT 5,
    p_user_id UUID DEFAULT NULL
)
RETURNS TABLE (
    id UUID,
    content TEXT,
    content_type TEXT,
    start_time FLOAT,
    end_time FLOAT,
    similarity FLOAT,
    metadata JSONB
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    RETURN QUERY
    SELECT
        c.id,
        c.content,
        c.content_type,
        c.start_time,
        c.end_time,
        1 - (c.embedding <=> query_embedding) AS similarity,
        c.metadata
    FROM
        public.chunks c
    WHERE
        c.video_id = search_video_by_id.video_id
        AND 1 - (c.embedding <=> query_embedding) > match_threshold
        AND (p_user_id IS NULL AND c.user_id = auth.uid() OR c.user_id = p_user_id)
    ORDER BY
        c.embedding <=> query_embedding
    LIMIT match_count;
END;
$$; 