-- Create a materialized view for topic distribution statistics
-- This pre-calculates counts to avoid the 1000 row limit on client queries

-- Drop existing view if it exists
DROP MATERIALIZED VIEW IF EXISTS topic_distribution_stats CASCADE;

-- Create the materialized view
CREATE MATERIALIZED VIEW topic_distribution_stats AS
WITH topic_counts AS (
  SELECT 
    -- Level 1 (Domain)
    COALESCE(topic_domain, 'Uncategorized') as domain,
    -- Level 2 (Niche)
    COALESCE(topic_niche, 'Other') as niche,
    -- Level 3 (Micro-topic)
    COALESCE(topic_micro, 'Unknown') as micro_topic,
    -- Cluster ID
    topic_cluster_id,
    -- Count videos
    COUNT(*) as video_count
  FROM videos
  WHERE bertopic_version = 'v1_2025-08-01'
  GROUP BY topic_domain, topic_niche, topic_micro, topic_cluster_id
),
domain_totals AS (
  SELECT 
    domain,
    SUM(video_count) as domain_total
  FROM topic_counts
  GROUP BY domain
),
niche_totals AS (
  SELECT 
    domain,
    niche,
    SUM(video_count) as niche_total
  FROM topic_counts
  GROUP BY domain, niche
),
total_videos AS (
  SELECT COUNT(*) as total_count
  FROM videos
  WHERE bertopic_version = 'v1_2025-08-01'
)
SELECT 
  tc.domain,
  tc.niche,
  tc.micro_topic,
  tc.topic_cluster_id,
  tc.video_count,
  dt.domain_total,
  nt.niche_total,
  tv.total_count,
  -- Percentages
  ROUND((tc.video_count::numeric / tv.total_count) * 100, 2) as micro_topic_percentage,
  ROUND((nt.niche_total::numeric / tv.total_count) * 100, 2) as niche_percentage,
  ROUND((dt.domain_total::numeric / tv.total_count) * 100, 2) as domain_percentage,
  -- Rankings
  RANK() OVER (ORDER BY tc.video_count DESC) as overall_rank,
  RANK() OVER (PARTITION BY tc.domain ORDER BY tc.video_count DESC) as domain_rank,
  RANK() OVER (PARTITION BY tc.domain, tc.niche ORDER BY tc.video_count DESC) as niche_rank
FROM topic_counts tc
JOIN domain_totals dt ON tc.domain = dt.domain
JOIN niche_totals nt ON tc.domain = nt.domain AND tc.niche = nt.niche
CROSS JOIN total_videos tv
ORDER BY tc.video_count DESC;

-- Create indexes for better query performance
CREATE INDEX idx_topic_dist_domain ON topic_distribution_stats(domain);
CREATE INDEX idx_topic_dist_niche ON topic_distribution_stats(domain, niche);
CREATE INDEX idx_topic_dist_cluster ON topic_distribution_stats(topic_cluster_id);
CREATE INDEX idx_topic_dist_count ON topic_distribution_stats(video_count DESC);

-- Grant permissions
GRANT SELECT ON topic_distribution_stats TO authenticated;
GRANT SELECT ON topic_distribution_stats TO anon;

-- Create a simple summary view for domain-level stats
DROP VIEW IF EXISTS topic_domain_summary CASCADE;
CREATE VIEW topic_domain_summary AS
SELECT 
  domain,
  MAX(domain_total) as video_count,
  MAX(domain_percentage) as percentage,
  COUNT(DISTINCT niche) as niche_count,
  COUNT(DISTINCT micro_topic) as micro_topic_count,
  MAX(total_count) as total_videos
FROM topic_distribution_stats
GROUP BY domain
ORDER BY video_count DESC;

-- Grant permissions
GRANT SELECT ON topic_domain_summary TO authenticated;
GRANT SELECT ON topic_domain_summary TO anon;

-- Create a refresh function
CREATE OR REPLACE FUNCTION refresh_topic_distribution_stats()
RETURNS void AS $$
BEGIN
  REFRESH MATERIALIZED VIEW topic_distribution_stats;
END;
$$ LANGUAGE plpgsql;

-- Add a comment explaining the view
COMMENT ON MATERIALIZED VIEW topic_distribution_stats IS 
'Pre-calculated topic distribution statistics to avoid 1000 row limit. 
Includes counts and percentages at domain, niche, and micro-topic levels.
Refresh with: SELECT refresh_topic_distribution_stats();';

-- Refresh the view immediately
REFRESH MATERIALIZED VIEW topic_distribution_stats;