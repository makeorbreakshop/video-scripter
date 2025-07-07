-- Database Analytics Materialized View for Performance Optimization
-- This view pre-calculates all analytics statistics to avoid expensive real-time calculations

-- Drop existing view if it exists
DROP MATERIALIZED VIEW IF EXISTS analytics_stats;

-- Create materialized view for analytics dashboard
CREATE MATERIALIZED VIEW analytics_stats AS
WITH video_stats AS (
  SELECT 
    COUNT(*) as total_videos,
    COUNT(*) FILTER (WHERE is_competitor = true) as competitor_videos,
    COUNT(*) FILTER (WHERE pinecone_embedded = true) as embedded_videos,
    COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '30 days') as recent_videos,
    ROUND(AVG(view_count)::numeric, 0) as average_views
  FROM videos
),
channel_stats AS (
  SELECT 
    COUNT(DISTINCT channel_id) as total_channels,
    COUNT(DISTINCT channel_id) FILTER (WHERE is_competitor = true) as competitor_channels
  FROM videos 
  WHERE channel_id IS NOT NULL
),
rss_stats AS (
  SELECT 
    COUNT(DISTINCT channel_id) as rss_monitored_channels
  FROM videos 
  WHERE is_competitor = true 
    AND channel_id IS NOT NULL
    AND (
      metadata->>'youtube_channel_id' LIKE 'UC%' 
      OR metadata->>'source' = 'rss'
      OR metadata->>'import_method' = 'rss'
    )
)
SELECT 
  v.total_videos,
  c.total_channels,
  v.competitor_videos,
  c.competitor_channels,
  COALESCE(r.rss_monitored_channels, 0) as rss_monitored_channels,
  v.embedded_videos,
  v.recent_videos,
  v.average_views
FROM video_stats v
CROSS JOIN channel_stats c
CROSS JOIN rss_stats r;

-- Create indexes for better performance
CREATE UNIQUE INDEX analytics_stats_single_row ON analytics_stats ((1));

-- Create a function to refresh the materialized view
CREATE OR REPLACE FUNCTION refresh_analytics_stats()
RETURNS void AS $$
BEGIN
  REFRESH MATERIALIZED VIEW analytics_stats;
END;
$$ LANGUAGE plpgsql;

-- Schedule automatic refresh every hour using pg_cron
-- This will keep the stats reasonably fresh without expensive real-time calculations
SELECT cron.schedule(
  'refresh-analytics-stats',
  '0 * * * *', -- Every hour at minute 0
  'SELECT refresh_analytics_stats();'
);

-- Initial refresh to populate the view
REFRESH MATERIALIZED VIEW analytics_stats;

-- Verify the view works
SELECT * FROM analytics_stats;