-- Enhanced YouTube Analytics Schema
-- Captures comprehensive YouTube Analytics API data
-- Run after the basic daily_analytics table is created

-- Drop existing table to rebuild with comprehensive schema
DROP TABLE IF EXISTS daily_analytics CASCADE;

-- Create comprehensive daily_analytics table
CREATE TABLE daily_analytics (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  video_id TEXT NOT NULL REFERENCES videos(id),
  date DATE NOT NULL,
  
  -- View Metrics
  views INTEGER NOT NULL DEFAULT 0,
  engaged_views INTEGER,
  red_views INTEGER,
  viewer_percentage FLOAT,
  
  -- Watch Time Metrics
  estimated_minutes_watched INTEGER,
  estimated_red_minutes_watched INTEGER,
  average_view_duration FLOAT,
  average_view_percentage FLOAT,
  
  -- Engagement Metrics
  likes INTEGER,
  dislikes INTEGER,
  comments INTEGER,
  shares INTEGER,
  subscribers_gained INTEGER,
  subscribers_lost INTEGER,
  
  -- Revenue Metrics (requires monetary scope)
  estimated_revenue FLOAT,
  estimated_ad_revenue FLOAT,
  estimated_red_partner_revenue FLOAT,
  gross_revenue FLOAT,
  cpm FLOAT,
  
  -- Ad Performance Metrics
  ad_impressions INTEGER,
  monetized_playbacks INTEGER,
  
  -- Traffic Source Metrics (aggregated)
  search_views INTEGER,
  suggested_views INTEGER,
  external_views INTEGER,
  direct_views INTEGER,
  playlist_views INTEGER,
  
  -- Geographic Metrics (top countries as JSONB)
  country_views JSONB, -- {"US": 1000, "CA": 500, ...}
  
  -- Device/Platform Metrics
  mobile_views INTEGER,
  desktop_views INTEGER,
  tablet_views INTEGER,
  tv_views INTEGER,
  
  -- Audience Metrics
  audience_retention JSONB, -- Retention curve data
  top_age_groups JSONB, -- {"18-24": 40, "25-34": 35, ...}
  gender_breakdown JSONB, -- {"female": 60, "male": 40}
  
  -- Additional metrics
  end_screen_element_clicks INTEGER,
  card_impressions INTEGER,
  card_clicks INTEGER,
  card_click_rate FLOAT,
  
  -- Metadata
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  
  UNIQUE(video_id, date)
);

-- Create indexes for performance
CREATE INDEX idx_daily_analytics_video_id ON daily_analytics(video_id);
CREATE INDEX idx_daily_analytics_date ON daily_analytics(date);
CREATE INDEX idx_daily_analytics_video_date ON daily_analytics(video_id, date);
CREATE INDEX idx_daily_analytics_views ON daily_analytics(views DESC);
CREATE INDEX idx_daily_analytics_engagement ON daily_analytics(likes DESC, comments DESC);

-- GIN indexes for JSONB columns
CREATE INDEX idx_daily_analytics_country_views ON daily_analytics USING GIN(country_views);
CREATE INDEX idx_daily_analytics_audience_retention ON daily_analytics USING GIN(audience_retention);
CREATE INDEX idx_daily_analytics_demographics ON daily_analytics USING GIN(top_age_groups);

-- Updated trigger function
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Apply trigger
DROP TRIGGER IF EXISTS update_daily_analytics_updated_at ON daily_analytics;
CREATE TRIGGER update_daily_analytics_updated_at 
    BEFORE UPDATE ON daily_analytics 
    FOR EACH ROW 
    EXECUTE FUNCTION update_updated_at_column();

-- Create aggregated view for dashboard queries
CREATE OR REPLACE VIEW analytics_summary AS
SELECT 
  video_id,
  COUNT(*) as days_tracked,
  SUM(views) as total_views,
  SUM(likes) as total_likes,
  SUM(comments) as total_comments,
  AVG(average_view_percentage) as avg_retention,
  AVG(card_click_rate) as avg_ctr,
  SUM(estimated_revenue) as total_revenue,
  MAX(date) as last_updated
FROM daily_analytics 
GROUP BY video_id;

-- Create materialized view for faster dashboard loading
CREATE MATERIALIZED VIEW IF NOT EXISTS analytics_dashboard_cache AS
SELECT 
  date,
  SUM(views) as daily_views,
  SUM(likes) as daily_likes,
  SUM(comments) as daily_comments,
  SUM(estimated_revenue) as daily_revenue,
  AVG(average_view_percentage) as avg_retention,
  COUNT(DISTINCT video_id) as videos_with_data
FROM daily_analytics 
WHERE date >= CURRENT_DATE - INTERVAL '90 days'
GROUP BY date
ORDER BY date DESC;

-- Create unique index on materialized view
CREATE UNIQUE INDEX idx_analytics_dashboard_cache_date ON analytics_dashboard_cache(date);

-- Function to refresh materialized view
CREATE OR REPLACE FUNCTION refresh_analytics_cache()
RETURNS void AS $$
BEGIN
  REFRESH MATERIALIZED VIEW CONCURRENTLY analytics_dashboard_cache;
END;
$$ LANGUAGE plpgsql;