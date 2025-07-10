-- Fix the materialized view to handle various integer formats
DROP MATERIALIZED VIEW IF EXISTS competitor_channel_summary;

CREATE MATERIALIZED VIEW competitor_channel_summary AS
WITH channel_aggregates AS (
  SELECT 
    v.channel_id,
    COUNT(*) as video_count,
    MAX(v.import_date) as last_import,
    -- Get the metadata with the best channel_stats (prioritize non-null)
    (array_agg(v.metadata ORDER BY 
      CASE WHEN v.metadata -> 'channel_stats' IS NOT NULL THEN 0 ELSE 1 END,
      v.import_date DESC
    ))[1] as best_metadata
  FROM videos v
  WHERE v.is_competitor = true
  GROUP BY v.channel_id
)
SELECT 
  ca.channel_id,
  COALESCE(
    ca.best_metadata ->> 'youtube_channel_id',
    ca.channel_id
  ) as youtube_channel_id,
  COALESCE(
    ca.best_metadata ->> 'channel_name',
    ca.best_metadata ->> 'channel_title',
    ca.channel_id
  ) as channel_name,
  ca.best_metadata ->> 'channel_title' as channel_title,
  ca.best_metadata ->> 'channel_handle' as channel_handle,
  -- Fixed integer casting to handle various formats
  COALESCE(
    CASE 
      WHEN ca.best_metadata -> 'channel_stats' -> 'subscriber_count' IS NULL THEN 0
      WHEN ca.best_metadata -> 'channel_stats' ->> 'subscriber_count' = '' THEN 0
      ELSE 
        -- Remove any extra quotes and convert to integer
        REPLACE(
          REPLACE(
            ca.best_metadata -> 'channel_stats' ->> 'subscriber_count',
            '"', ''
          ),
          '''', ''
        )::integer
    END,
    0
  ) as subscriber_count,
  ca.video_count::integer,
  ca.last_import,
  ca.best_metadata -> 'channel_stats' ->> 'channel_thumbnail' as channel_thumbnail
FROM channel_aggregates ca;

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_competitor_channel_summary_channel_id 
  ON competitor_channel_summary(channel_id);
CREATE INDEX IF NOT EXISTS idx_competitor_channel_summary_subscriber_count 
  ON competitor_channel_summary(subscriber_count);

-- Refresh the view with the new data
SELECT refresh_competitor_channel_summary();