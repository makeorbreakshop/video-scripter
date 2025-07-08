-- Video Summaries and Categorization Migration
-- This creates the infrastructure for searchable video summaries and content categorization

-- Enable required extensions if not already enabled
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "vector";

-- Create video_summaries table
CREATE TABLE IF NOT EXISTS video_summaries (
    id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    video_id TEXT REFERENCES videos(id) ON DELETE CASCADE,
    
    -- Summary content
    summary TEXT NOT NULL,
    hook TEXT,
    hook_analysis JSONB DEFAULT '{}', -- Stores hook type, triggers, etc.
    
    -- Vector embedding for semantic search
    summary_embedding vector(1536),
    
    -- Categorization
    categories JSONB DEFAULT '[]',
    content_themes TEXT[],
    content_type VARCHAR(50), -- tutorial, review, comparison, etc.
    
    -- Metadata
    summary_version VARCHAR(10) DEFAULT '1.0',
    generation_method VARCHAR(20) DEFAULT 'full', -- full, chunk-based, hybrid
    model_used VARCHAR(50),
    token_count INTEGER,
    
    -- Performance tracking
    generated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    last_accessed TIMESTAMP WITH TIME ZONE,
    access_count INTEGER DEFAULT 0,
    
    -- Quality metrics
    confidence_score FLOAT,
    manually_reviewed BOOLEAN DEFAULT false,
    
    UNIQUE(video_id)
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS video_summaries_video_id_idx ON video_summaries(video_id);
CREATE INDEX IF NOT EXISTS video_summaries_content_type_idx ON video_summaries(content_type);
CREATE INDEX IF NOT EXISTS video_summaries_themes_idx ON video_summaries USING GIN(content_themes);
CREATE INDEX IF NOT EXISTS video_summaries_access_idx ON video_summaries(last_accessed DESC, access_count DESC);

-- Vector similarity search index
CREATE INDEX IF NOT EXISTS video_summaries_embedding_idx ON video_summaries 
USING ivfflat (summary_embedding vector_cosine_ops)
WITH (lists = 100);

-- Function to search videos by summary content
CREATE OR REPLACE FUNCTION search_videos_by_summary(
    query_embedding vector(1536),
    match_limit INT DEFAULT 20,
    similarity_threshold FLOAT DEFAULT 0.7
)
RETURNS TABLE (
    video_id TEXT,
    title TEXT,
    summary TEXT,
    hook TEXT,
    similarity FLOAT,
    performance_ratio FLOAT,
    view_count INTEGER
)
LANGUAGE plpgsql
AS $$
BEGIN
    RETURN QUERY
    SELECT 
        v.id,
        v.title,
        vs.summary,
        vs.hook,
        1 - (vs.summary_embedding <=> query_embedding) as similarity,
        v.performance_ratio,
        v.view_count
    FROM video_summaries vs
    JOIN videos v ON vs.video_id = v.id
    WHERE vs.summary_embedding IS NOT NULL
    AND 1 - (vs.summary_embedding <=> query_embedding) > similarity_threshold
    ORDER BY vs.summary_embedding <=> query_embedding
    LIMIT match_limit;
END;
$$;

-- Function to search with multiple vector sources (title, thumbnail, summary)
CREATE OR REPLACE FUNCTION search_videos_enhanced(
    query_embedding vector(1536),
    title_weight FLOAT DEFAULT 0.3,
    thumbnail_weight FLOAT DEFAULT 0.2,
    summary_weight FLOAT DEFAULT 0.5,
    match_limit INT DEFAULT 20
)
RETURNS TABLE (
    video_id TEXT,
    title TEXT,
    summary TEXT,
    combined_similarity FLOAT,
    performance_ratio FLOAT,
    view_count INTEGER
)
LANGUAGE plpgsql
AS $$
BEGIN
    RETURN QUERY
    WITH similarity_scores AS (
        SELECT 
            v.id,
            v.title,
            vs.summary,
            v.performance_ratio,
            v.view_count,
            -- Calculate weighted similarity from multiple sources
            (
                COALESCE((1 - (v.pinecone_embedding <=> query_embedding)) * title_weight, 0) +
                COALESCE((1 - (v.thumbnail_embedding <=> query_embedding)) * thumbnail_weight, 0) +
                COALESCE((1 - (vs.summary_embedding <=> query_embedding)) * summary_weight, 0)
            ) as combined_score
        FROM videos v
        LEFT JOIN video_summaries vs ON v.id = vs.video_id
        WHERE 
            v.pinecone_embedding IS NOT NULL 
            OR v.thumbnail_embedding IS NOT NULL 
            OR vs.summary_embedding IS NOT NULL
    )
    SELECT 
        id,
        title,
        summary,
        combined_score as combined_similarity,
        performance_ratio,
        view_count
    FROM similarity_scores
    WHERE combined_score > 0
    ORDER BY combined_score DESC
    LIMIT match_limit;
END;
$$;

-- Table to track summary generation queue
CREATE TABLE IF NOT EXISTS summary_generation_queue (
    id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    video_id TEXT REFERENCES videos(id) ON DELETE CASCADE,
    priority VARCHAR(10) DEFAULT 'medium', -- high, medium, low
    method VARCHAR(20) DEFAULT 'full', -- full, chunk-based
    status VARCHAR(20) DEFAULT 'pending', -- pending, processing, completed, failed
    attempts INTEGER DEFAULT 0,
    error_message TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    started_at TIMESTAMP WITH TIME ZONE,
    completed_at TIMESTAMP WITH TIME ZONE,
    
    UNIQUE(video_id)
);

-- Index for queue processing
CREATE INDEX IF NOT EXISTS queue_status_priority_idx ON summary_generation_queue(status, priority, created_at);

-- Function to add videos to processing queue based on performance
CREATE OR REPLACE FUNCTION queue_videos_for_summarization(
    limit_count INTEGER DEFAULT 1000
)
RETURNS INTEGER
LANGUAGE plpgsql
AS $$
DECLARE
    inserted_count INTEGER;
BEGIN
    INSERT INTO summary_generation_queue (video_id, priority, method)
    SELECT 
        v.id,
        CASE 
            WHEN v.performance_ratio > 5 THEN 'high'
            WHEN v.performance_ratio > 2 THEN 'medium'
            ELSE 'low'
        END as priority,
        CASE 
            WHEN v.performance_ratio > 3 THEN 'full'
            ELSE 'chunk-based'
        END as method
    FROM videos v
    LEFT JOIN video_summaries vs ON v.id = vs.video_id
    LEFT JOIN summary_generation_queue q ON v.id = q.video_id
    WHERE vs.id IS NULL  -- No summary exists
    AND q.id IS NULL     -- Not already in queue
    AND v.id IS NOT NULL
    ORDER BY v.performance_ratio DESC
    LIMIT limit_count
    ON CONFLICT (video_id) DO NOTHING;
    
    GET DIAGNOSTICS inserted_count = ROW_COUNT;
    RETURN inserted_count;
END;
$$;

-- Update access tracking
CREATE OR REPLACE FUNCTION update_summary_access_stats()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    UPDATE video_summaries
    SET 
        last_accessed = NOW(),
        access_count = access_count + 1
    WHERE video_id = NEW.video_id;
    RETURN NEW;
END;
$$;

-- RLS policies
ALTER TABLE video_summaries ENABLE ROW LEVEL SECURITY;
ALTER TABLE summary_generation_queue ENABLE ROW LEVEL SECURITY;

-- Policy for reading summaries (public)
CREATE POLICY "Anyone can read video summaries" ON video_summaries
FOR SELECT USING (true);

-- Policy for managing summaries (authenticated users)
CREATE POLICY "Users can manage their video summaries" ON video_summaries
FOR ALL USING (
    EXISTS (
        SELECT 1 FROM videos v 
        WHERE v.id = video_summaries.video_id 
        AND v.user_id = auth.uid()
    )
);

-- Policy for queue management
CREATE POLICY "Users can manage their summary queue" ON summary_generation_queue
FOR ALL USING (
    EXISTS (
        SELECT 1 FROM videos v 
        WHERE v.id = summary_generation_queue.video_id 
        AND v.user_id = auth.uid()
    )
);