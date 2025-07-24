-- Just create the table first (no functions or triggers)
CREATE TABLE IF NOT EXISTS video_performance_metrics (
    video_id UUID PRIMARY KEY REFERENCES videos(id) ON DELETE CASCADE,
    channel_name TEXT NOT NULL,
    
    -- Basic info
    published_at TIMESTAMP WITH TIME ZONE NOT NULL,
    last_calculated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    
    -- View metrics
    total_views BIGINT NOT NULL,
    age_days INTEGER NOT NULL,
    
    -- VPD calculations
    current_vpd NUMERIC NOT NULL, -- Last 30 days
    initial_vpd NUMERIC NOT NULL, -- First 30 days
    lifetime_vpd NUMERIC NOT NULL, -- Total views / age
    
    -- Performance scores
    channel_baseline_vpd NUMERIC NOT NULL, -- Channel avg when published
    indexed_score NUMERIC NOT NULL, -- initial_vpd / baseline
    velocity_trend NUMERIC NOT NULL, -- current_vpd / initial_vpd * 100
    trend_direction TEXT CHECK (trend_direction IN ('↗️', '→', '↘️')),
    
    -- Tier classification
    performance_tier TEXT NOT NULL
);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_video_performance_channel ON video_performance_metrics(channel_name);
CREATE INDEX IF NOT EXISTS idx_video_performance_published ON video_performance_metrics(published_at DESC);
CREATE INDEX IF NOT EXISTS idx_video_performance_score ON video_performance_metrics(indexed_score DESC);
CREATE INDEX IF NOT EXISTS idx_video_performance_vpd ON video_performance_metrics(current_vpd DESC);