-- Create a materialized view for competitor channel summary
CREATE MATERIALIZED VIEW IF NOT EXISTS competitor_channel_summary AS
WITH channel_aggregates AS (
  SELECT 
    v.channel_id,
    COUNT(*) as video_count,
    MAX(v.import_date) as last_import,
    (ARRAY_AGG(
      v.metadata ORDER BY 
      CASE 
        WHEN v.metadata->'channel_stats' IS NOT NULL THEN 0
        ELSE 1
      END,
      v.import_date DESC
    ))[1] as best_metadata
  FROM videos v
  WHERE v.is_competitor = true
  GROUP BY v.channel_id
)
SELECT
  ca.channel_id,
  COALESCE(ca.best_metadata->>'youtube_channel_id', ca.channel_id) as youtube_channel_id,
  COALESCE(ca.best_metadata->>'channel_name', ca.best_metadata->>'channel_title', ca.channel_id) as channel_name,
  ca.best_metadata->>'channel_title' as channel_title,
  ca.best_metadata->>'channel_handle' as channel_handle,
  COALESCE((ca.best_metadata->'channel_stats'->'subscriber_count')::text::integer, 0) as subscriber_count,
  ca.video_count::integer as video_count,
  ca.last_import,
  ca.best_metadata->'channel_stats'->>'channel_thumbnail' as channel_thumbnail
FROM channel_aggregates ca;

-- Create an index for fast sorting
CREATE INDEX idx_competitor_channel_summary_video_count ON competitor_channel_summary(video_count DESC);

-- Refresh the materialized view (run this after importing new videos)
REFRESH MATERIALIZED VIEW competitor_channel_summary;