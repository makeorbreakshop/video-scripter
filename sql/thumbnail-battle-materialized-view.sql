-- Drop existing view if it exists
DROP MATERIALIZED VIEW IF EXISTS thumbnail_battle_matchup_pool CASCADE;

-- Create materialized view for fast thumbnail battle matchup selection
-- This pre-computes eligible video pairs from channels with 100K+ subscribers
CREATE MATERIALIZED VIEW thumbnail_battle_matchup_pool AS
WITH eligible_videos AS (
  -- Get all eligible videos with channel data joined
  SELECT 
    v.id,
    v.title,
    v.thumbnail_url,
    v.channel_id,
    v.temporal_performance_score,
    v.view_count,
    v.published_at,
    c.channel_name,
    c.subscriber_count,
    c.thumbnail_url as channel_avatar
  FROM videos v
  INNER JOIN channels c ON v.channel_id = c.channel_id
  WHERE 
    -- Same filtering logic as the game
    v.temporal_performance_score IS NOT NULL
    AND v.temporal_performance_score > 0.1
    AND v.temporal_performance_score <= 100
    AND v.thumbnail_url IS NOT NULL
    AND v.published_at <= CURRENT_DATE - INTERVAL '30 days'
    AND v.is_short = false
    AND v.is_institutional = false
    -- Only channels with 100K+ subscribers
    AND c.subscriber_count >= 100000
),
channel_video_counts AS (
  -- Count videos per channel to ensure we have enough
  SELECT 
    channel_id,
    COUNT(*) as video_count
  FROM eligible_videos
  GROUP BY channel_id
  HAVING COUNT(*) >= 10  -- Need at least 10 videos per channel
),
videos_with_counts AS (
  -- Join back to get only videos from channels with enough content
  SELECT ev.*
  FROM eligible_videos ev
  INNER JOIN channel_video_counts cvc ON ev.channel_id = cvc.channel_id
),
high_low_pairs AS (
  -- Pre-compute high/low performer pairs for each channel
  SELECT DISTINCT ON (h.channel_id, l.id)
    h.id as high_performer_id,
    h.title as high_performer_title,
    h.thumbnail_url as high_performer_thumbnail,
    h.temporal_performance_score as high_performer_score,
    h.view_count as high_performer_views,
    l.id as low_performer_id,
    l.title as low_performer_title,
    l.thumbnail_url as low_performer_thumbnail,
    l.temporal_performance_score as low_performer_score,
    l.view_count as low_performer_views,
    h.channel_id,
    h.channel_name,
    h.subscriber_count,
    h.channel_avatar,
    -- Calculate time difference for variety
    ABS(EXTRACT(EPOCH FROM (h.published_at - l.published_at))) as time_diff_seconds
  FROM videos_with_counts h
  INNER JOIN videos_with_counts l ON h.channel_id = l.channel_id
  WHERE 
    h.temporal_performance_score >= 1.5  -- High performer
    AND l.temporal_performance_score <= 0.8  -- Low performer
    AND h.id != l.id
    -- Prefer videos within 1 year of each other
    AND ABS(EXTRACT(EPOCH FROM (h.published_at - l.published_at))) <= 31536000
  ORDER BY h.channel_id, l.id, RANDOM()
  LIMIT 2000  -- Store top 2000 matchups
)
SELECT 
  -- Generate a unique matchup ID for each pair
  md5(high_performer_id || '-' || low_performer_id)::uuid as matchup_id,
  high_performer_id,
  high_performer_title,
  high_performer_thumbnail,
  high_performer_score,
  high_performer_views,
  low_performer_id,
  low_performer_title,
  low_performer_thumbnail,
  low_performer_score,
  low_performer_views,
  channel_id,
  channel_name,
  subscriber_count,
  -- Fix avatar URL to use s88 (largest size that works with CORS)
  CASE 
    WHEN channel_avatar IS NOT NULL 
    THEN regexp_replace(channel_avatar, 's\d+-c', 's88-c')
    ELSE NULL
  END as channel_avatar,
  -- Determine winner
  CASE 
    WHEN high_performer_score > low_performer_score THEN 'high'
    ELSE 'low'
  END as winner,
  -- Add some randomization seeds for variety
  RANDOM() as random_sort,
  CURRENT_TIMESTAMP as created_at
FROM high_low_pairs

UNION ALL

-- Also include some medium performer pairs for variety
SELECT 
  md5(m1.id || '-' || m2.id)::uuid as matchup_id,
  m1.id as high_performer_id,
  m1.title as high_performer_title,
  m1.thumbnail_url as high_performer_thumbnail,
  m1.temporal_performance_score as high_performer_score,
  m1.view_count as high_performer_views,
  m2.id as low_performer_id,
  m2.title as low_performer_title,
  m2.thumbnail_url as low_performer_thumbnail,
  m2.temporal_performance_score as low_performer_score,
  m2.view_count as low_performer_views,
  m1.channel_id,
  m1.channel_name,
  m1.subscriber_count,
  CASE 
    WHEN m1.channel_avatar IS NOT NULL 
    THEN regexp_replace(m1.channel_avatar, 's\d+-c', 's88-c')
    ELSE NULL
  END as channel_avatar,
  CASE 
    WHEN m1.temporal_performance_score > m2.temporal_performance_score THEN 'high'
    ELSE 'low'
  END as winner,
  RANDOM() as random_sort,
  CURRENT_TIMESTAMP as created_at
FROM videos_with_counts m1
INNER JOIN videos_with_counts m2 ON m1.channel_id = m2.channel_id
WHERE 
  m1.temporal_performance_score BETWEEN 0.8 AND 1.5  -- Medium performers
  AND m2.temporal_performance_score BETWEEN 0.8 AND 1.5
  AND m1.id < m2.id  -- Avoid duplicates
  AND ABS(m1.temporal_performance_score - m2.temporal_performance_score) >= 0.3  -- Some difference
  AND ABS(EXTRACT(EPOCH FROM (m1.published_at - m2.published_at))) <= 31536000
ORDER BY RANDOM()
LIMIT 1000;

-- Create indexes for fast querying
CREATE INDEX idx_matchup_pool_random ON thumbnail_battle_matchup_pool(random_sort);
CREATE INDEX idx_matchup_pool_channel ON thumbnail_battle_matchup_pool(channel_id);
CREATE INDEX idx_matchup_pool_created ON thumbnail_battle_matchup_pool(created_at);

-- Refresh policy (add to your pg_cron or run manually)
-- SELECT pg_cron.schedule('refresh-thumbnail-battle-pool', '0 */6 * * *', 'REFRESH MATERIALIZED VIEW CONCURRENTLY thumbnail_battle_matchup_pool;');