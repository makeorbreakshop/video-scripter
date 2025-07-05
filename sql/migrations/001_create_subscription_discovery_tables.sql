-- Migration: Create subscription discovery system tables
-- Date: 2025-07-05
-- Description: Sets up database schema for YouTube channel discovery through subscription network crawling

-- Create subscription_discovery table for tracking channel discoveries
CREATE TABLE subscription_discovery (
    id SERIAL PRIMARY KEY,
    source_channel_id TEXT NOT NULL,
    discovered_channel_id TEXT NOT NULL,
    subscriber_count INTEGER,
    video_count INTEGER,
    discovery_date TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    validation_status TEXT DEFAULT 'pending' CHECK (validation_status IN ('pending', 'approved', 'rejected', 'imported')),
    import_status TEXT DEFAULT 'pending' CHECK (import_status IN ('pending', 'queued', 'importing', 'completed', 'failed')),
    relevance_score DECIMAL(3,2) CHECK (relevance_score >= 0 AND relevance_score <= 5),
    channel_metadata JSONB,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(source_channel_id, discovered_channel_id)
);

-- Create discovery_metrics table for monitoring
CREATE TABLE discovery_metrics (
    id SERIAL PRIMARY KEY,
    date DATE NOT NULL DEFAULT CURRENT_DATE,
    quota_used_subscriptions INTEGER DEFAULT 0,
    quota_used_channels INTEGER DEFAULT 0,
    quota_used_total INTEGER DEFAULT 0,
    channels_discovered INTEGER DEFAULT 0,
    channels_validated INTEGER DEFAULT 0,
    channels_approved INTEGER DEFAULT 0,
    channels_imported INTEGER DEFAULT 0,
    success_rate DECIMAL(5,2),
    relevance_rate DECIMAL(5,2),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(date)
);

-- Create indexes for efficient querying
CREATE INDEX idx_subscription_discovery_source_channel ON subscription_discovery(source_channel_id);
CREATE INDEX idx_subscription_discovery_discovered_channel ON subscription_discovery(discovered_channel_id);
CREATE INDEX idx_subscription_discovery_validation_status ON subscription_discovery(validation_status);
CREATE INDEX idx_subscription_discovery_import_status ON subscription_discovery(import_status);
CREATE INDEX idx_subscription_discovery_relevance_score ON subscription_discovery(relevance_score);
CREATE INDEX idx_subscription_discovery_discovery_date ON subscription_discovery(discovery_date);

CREATE INDEX idx_discovery_metrics_date ON discovery_metrics(date);
CREATE INDEX idx_discovery_metrics_quota_used ON discovery_metrics(quota_used_total);

-- Create function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Create triggers for automatic updated_at updates
CREATE TRIGGER update_subscription_discovery_updated_at 
    BEFORE UPDATE ON subscription_discovery 
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_discovery_metrics_updated_at 
    BEFORE UPDATE ON discovery_metrics 
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Add comments for documentation
COMMENT ON TABLE subscription_discovery IS 'Tracks channel discoveries through subscription network crawling';
COMMENT ON TABLE discovery_metrics IS 'Daily metrics for monitoring discovery system performance and quota usage';
COMMENT ON COLUMN subscription_discovery.source_channel_id IS 'YouTube channel ID that was crawled for subscriptions';
COMMENT ON COLUMN subscription_discovery.discovered_channel_id IS 'YouTube channel ID discovered through subscription crawling';
COMMENT ON COLUMN subscription_discovery.validation_status IS 'Current validation status: pending, approved, rejected, imported';
COMMENT ON COLUMN subscription_discovery.import_status IS 'Current import status: pending, queued, importing, completed, failed';
COMMENT ON COLUMN subscription_discovery.relevance_score IS 'Manual relevance score from 0-5 based on content alignment';
COMMENT ON COLUMN subscription_discovery.channel_metadata IS 'Cached channel metadata from YouTube API';