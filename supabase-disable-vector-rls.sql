-- WARNING: This script disables Row Level Security (RLS) on vector tables
-- Use only for debugging and testing purposes

-- Disable RLS on the chunks table
ALTER TABLE public.chunks DISABLE ROW LEVEL SECURITY;

-- Create a modified search function that doesn't use user_id filtering
CREATE OR REPLACE FUNCTION search_video_chunks_no_auth(
    query_embedding VECTOR(1536),
    match_threshold FLOAT DEFAULT 0.7,
    match_count INT DEFAULT 10
)
RETURNS TABLE (
    id UUID,
    video_id TEXT,
    content TEXT,
    content_type TEXT,
    start_time FLOAT,
    end_time FLOAT,
    similarity FLOAT,
    metadata JSONB,
    user_id UUID
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
        c.metadata,
        c.user_id
    FROM
        public.chunks c
    WHERE
        1 - (c.embedding <=> query_embedding) > match_threshold
    ORDER BY
        c.embedding <=> query_embedding
    LIMIT match_count;
END;
$$;

-- Verify RLS status
SELECT
    schemaname,
    tablename,
    rowsecurity
FROM
    pg_tables
WHERE
    schemaname = 'public'
    AND tablename IN ('videos', 'chunks');

-- Note: You can run the following to re-enable RLS later:
-- ALTER TABLE public.videos ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE public.chunks ENABLE ROW LEVEL SECURITY; 