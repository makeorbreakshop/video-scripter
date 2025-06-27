-- Create baseline_analytics table for lifetime cumulative YouTube analytics data
-- This table stores historical totals for all videos from publication to baseline capture date
-- Schema matches daily_analytics (43 fields) for consistency and easy data joins

CREATE TABLE IF NOT EXISTS baseline_analytics (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  video_id TEXT NOT NULL REFERENCES videos(id),
  baseline_date DATE NOT NULL, -- Date when baseline was captured
  
  -- Core engagement metrics
  views INTEGER DEFAULT 0,
  engaged_views INTEGER DEFAULT 0,
  estimated_minutes_watched INTEGER DEFAULT 0,
  average_view_percentage FLOAT DEFAULT 0,
  likes INTEGER DEFAULT 0,
  comments INTEGER DEFAULT 0,
  shares INTEGER DEFAULT 0,
  subscribers_gained INTEGER DEFAULT 0,
  subscribers_lost INTEGER DEFAULT 0,
  
  -- Revenue metrics
  estimated_revenue FLOAT DEFAULT 0,
  estimated_ad_revenue FLOAT DEFAULT 0,
  cpm FLOAT DEFAULT 0,
  monetized_playbacks INTEGER DEFAULT 0,
  playback_based_cpm FLOAT DEFAULT 0,
  ad_impressions INTEGER DEFAULT 0,
  
  -- Geographic and demographic data (JSONB for flexibility)
  country_views JSONB DEFAULT '{}',
  top_age_groups JSONB DEFAULT '{}',
  gender_breakdown JSONB DEFAULT '{}',
  
  -- Device analytics
  mobile_views INTEGER DEFAULT 0,
  desktop_views INTEGER DEFAULT 0,
  tablet_views INTEGER DEFAULT 0,
  tv_views INTEGER DEFAULT 0,
  
  -- Traffic source analytics
  search_views INTEGER DEFAULT 0,
  suggested_views INTEGER DEFAULT 0,
  external_views INTEGER DEFAULT 0,
  direct_views INTEGER DEFAULT 0,
  channel_views INTEGER DEFAULT 0,
  playlist_views INTEGER DEFAULT 0,
  
  -- Engagement patterns
  cards_impressions INTEGER DEFAULT 0,
  cards_clicks INTEGER DEFAULT 0,
  cards_click_rate FLOAT DEFAULT 0,
  end_screen_impressions INTEGER DEFAULT 0,
  end_screen_clicks INTEGER DEFAULT 0,
  end_screen_click_rate FLOAT DEFAULT 0,
  
  -- Advanced metrics
  red_views INTEGER DEFAULT 0,
  red_watch_time_minutes INTEGER DEFAULT 0,
  annotation_impressions INTEGER DEFAULT 0,
  annotation_clicks INTEGER DEFAULT 0,
  annotation_click_rate FLOAT DEFAULT 0,
  
  -- Timestamps
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  
  -- Constraints
  UNIQUE(video_id, baseline_date)
);

-- Create indexes for common query patterns
CREATE INDEX IF NOT EXISTS idx_baseline_analytics_video_id ON baseline_analytics(video_id);
CREATE INDEX IF NOT EXISTS idx_baseline_analytics_baseline_date ON baseline_analytics(baseline_date);
CREATE INDEX IF NOT EXISTS idx_baseline_analytics_views ON baseline_analytics(views DESC);
CREATE INDEX IF NOT EXISTS idx_baseline_analytics_created_at ON baseline_analytics(created_at);

-- Create GIN indexes for JSONB fields for efficient querying
CREATE INDEX IF NOT EXISTS idx_baseline_analytics_country_views ON baseline_analytics USING GIN(country_views);
CREATE INDEX IF NOT EXISTS idx_baseline_analytics_age_groups ON baseline_analytics USING GIN(top_age_groups);
CREATE INDEX IF NOT EXISTS idx_baseline_analytics_gender ON baseline_analytics USING GIN(gender_breakdown);

-- Add trigger to update updated_at column
CREATE OR REPLACE FUNCTION update_baseline_analytics_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_baseline_analytics_updated_at
    BEFORE UPDATE ON baseline_analytics
    FOR EACH ROW
    EXECUTE FUNCTION update_baseline_analytics_updated_at();

-- Add comments for documentation
COMMENT ON TABLE baseline_analytics IS 'Lifetime cumulative YouTube analytics data for videos from publication to baseline capture date';
COMMENT ON COLUMN baseline_analytics.video_id IS 'Foreign key to videos table';
COMMENT ON COLUMN baseline_analytics.baseline_date IS 'Date when this baseline snapshot was captured';
COMMENT ON COLUMN baseline_analytics.views IS 'Total lifetime views from publication to baseline_date';
COMMENT ON COLUMN baseline_analytics.country_views IS 'JSONB object with country codes as keys and view counts as values';
COMMENT ON COLUMN baseline_analytics.top_age_groups IS 'JSONB object with age ranges as keys and percentage as values';
COMMENT ON COLUMN baseline_analytics.gender_breakdown IS 'JSONB object with gender categories and percentage breakdown';