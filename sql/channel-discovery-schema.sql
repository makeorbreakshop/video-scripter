-- Create table for storing discovered channels
CREATE TABLE IF NOT EXISTS discovered_channels (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  channel_id VARCHAR(255) NOT NULL UNIQUE,
  channel_title VARCHAR(255) NOT NULL,
  channel_handle VARCHAR(255), -- @username format
  custom_url VARCHAR(255), -- youtube.com/c/customname
  subscriber_count BIGINT,
  video_count INTEGER,
  view_count BIGINT,
  description TEXT,
  country VARCHAR(10),
  published_at TIMESTAMP WITH TIME ZONE,
  last_upload_date TIMESTAMP WITH TIME ZONE,
  
  -- Discovery metadata
  discovered_from_channel_id VARCHAR(255),
  discovery_method VARCHAR(50), -- 'channels_tab', 'description', 'sidebar', 'search', 'community'
  discovery_depth INTEGER DEFAULT 0,
  discovered_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  
  -- Processing status
  is_processed BOOLEAN DEFAULT FALSE,
  last_scraped_at TIMESTAMP WITH TIME ZONE,
  api_verified BOOLEAN DEFAULT FALSE,
  api_verified_at TIMESTAMP WITH TIME ZONE,
  
  -- Quality metrics
  meets_threshold BOOLEAN DEFAULT TRUE,
  avg_views_per_video BIGINT,
  engagement_rate DECIMAL(5,2), -- if we can calculate it
  
  -- User assignment
  user_id UUID REFERENCES auth.users(id),
  project_id UUID,
  
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create indexes for efficient querying
CREATE INDEX idx_discovered_channels_channel_id ON discovered_channels(channel_id);
CREATE INDEX idx_discovered_channels_discovered_from ON discovered_channels(discovered_from_channel_id);
CREATE INDEX idx_discovered_channels_subscriber_count ON discovered_channels(subscriber_count DESC);
CREATE INDEX idx_discovered_channels_last_upload ON discovered_channels(last_upload_date DESC);
CREATE INDEX idx_discovered_channels_is_processed ON discovered_channels(is_processed);
CREATE INDEX idx_discovered_channels_meets_threshold ON discovered_channels(meets_threshold);
CREATE INDEX idx_discovered_channels_user_id ON discovered_channels(user_id);

-- Create table for discovery runs/sessions
CREATE TABLE IF NOT EXISTS discovery_runs (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  seed_channel_id VARCHAR(255) NOT NULL,
  seed_channel_title VARCHAR(255),
  
  -- Configuration
  min_subscribers INTEGER DEFAULT 1000,
  max_days_since_upload INTEGER DEFAULT 90,
  max_channels INTEGER DEFAULT 500,
  max_depth INTEGER DEFAULT 3,
  
  -- Progress tracking
  status VARCHAR(50) DEFAULT 'pending', -- 'pending', 'running', 'completed', 'failed'
  channels_discovered INTEGER DEFAULT 0,
  channels_processed INTEGER DEFAULT 0,
  channels_meeting_threshold INTEGER DEFAULT 0,
  current_depth INTEGER DEFAULT 0,
  
  -- Timing
  started_at TIMESTAMP WITH TIME ZONE,
  completed_at TIMESTAMP WITH TIME ZONE,
  
  -- User info
  user_id UUID REFERENCES auth.users(id),
  
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create table for tracking channel relationships
CREATE TABLE IF NOT EXISTS channel_relationships (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  source_channel_id VARCHAR(255) NOT NULL,
  target_channel_id VARCHAR(255) NOT NULL,
  relationship_type VARCHAR(50), -- 'featured', 'mentioned', 'collaborated', 'recommended'
  discovery_method VARCHAR(50),
  confidence_score DECIMAL(3,2) DEFAULT 1.0, -- 0-1 score
  
  discovered_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  
  UNIQUE(source_channel_id, target_channel_id, relationship_type)
);

-- Create indexes for relationships
CREATE INDEX idx_channel_relationships_source ON channel_relationships(source_channel_id);
CREATE INDEX idx_channel_relationships_target ON channel_relationships(target_channel_id);

-- RLS policies
ALTER TABLE discovered_channels ENABLE ROW LEVEL SECURITY;
ALTER TABLE discovery_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE channel_relationships ENABLE ROW LEVEL SECURITY;

-- Policies for discovered_channels
CREATE POLICY "Users can view their own discovered channels" ON discovered_channels
  FOR SELECT USING (auth.uid() = user_id OR user_id IS NULL);

CREATE POLICY "Users can insert their own discovered channels" ON discovered_channels
  FOR INSERT WITH CHECK (auth.uid() = user_id OR user_id IS NULL);

CREATE POLICY "Users can update their own discovered channels" ON discovered_channels
  FOR UPDATE USING (auth.uid() = user_id OR user_id IS NULL);

-- Policies for discovery_runs
CREATE POLICY "Users can view their own discovery runs" ON discovery_runs
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own discovery runs" ON discovery_runs
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own discovery runs" ON discovery_runs
  FOR UPDATE USING (auth.uid() = user_id);

-- Policies for channel_relationships (public read, controlled write)
CREATE POLICY "Anyone can view channel relationships" ON channel_relationships
  FOR SELECT USING (true);

CREATE POLICY "System can insert channel relationships" ON channel_relationships
  FOR INSERT WITH CHECK (true);