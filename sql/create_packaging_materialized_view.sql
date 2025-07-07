-- Create materialized view for packaging performance optimization
-- This pre-calculates performance ratios and filters to eliminate 6+ second query times

CREATE MATERIALIZED VIEW packaging_performance AS
SELECT 
  v.id,
  v.title,
  v.view_count,
  v.published_at,
  v.rolling_baseline_views as baseline_views,
  CASE 
    WHEN v.rolling_baseline_views > 0 THEN 
      ROUND((v.view_count::float / v.rolling_baseline_views)::numeric, 2)
    ELSE NULL 
  END as performance_ratio,
  v.thumbnail_url,
  v.is_competitor,
  v.channel_id,
  COALESCE(v.channel_name, 'Unknown Channel') as channel_name,
  v.rolling_baseline_views::integer as channel_avg_views,
  v.duration,
  v.description
FROM videos v
WHERE NOT is_youtube_short(v.duration, v.title, v.description);

-- Create optimized indexes for fast filtering and sorting
CREATE INDEX idx_packaging_perf_ratio ON packaging_performance (performance_ratio DESC NULLS LAST);
CREATE INDEX idx_packaging_competitor ON packaging_performance (is_competitor);
CREATE INDEX idx_packaging_published ON packaging_performance (published_at DESC);
CREATE INDEX idx_packaging_views ON packaging_performance (view_count DESC);
CREATE INDEX idx_packaging_channel ON packaging_performance (channel_name);
CREATE INDEX idx_packaging_title ON packaging_performance USING gin(to_tsvector('english', title));

-- Enable pg_cron extension for scheduled refreshes
CREATE EXTENSION IF NOT EXISTS pg_cron;

-- Schedule daily refresh at 2 AM
SELECT cron.schedule('daily-packaging-refresh', '0 2 * * *', 'REFRESH MATERIALIZED VIEW packaging_performance;');