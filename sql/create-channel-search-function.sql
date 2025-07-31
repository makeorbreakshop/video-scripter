-- Create an optimized function for channel search
CREATE OR REPLACE FUNCTION search_channels(
  search_query TEXT,
  result_limit INTEGER DEFAULT 20
)
RETURNS TABLE (
  channel_id TEXT,
  channel_name TEXT,
  channel_thumbnail TEXT,
  video_count BIGINT,
  total_views BIGINT
) AS $$
BEGIN
  RETURN QUERY
  WITH channel_stats AS (
    SELECT 
      v.channel_id,
      v.channel_name,
      COUNT(*)::BIGINT as video_count,
      SUM(v.view_count)::BIGINT as total_views,
      MAX((v.metadata->'channel_stats'->>'channel_thumbnail')::TEXT) as channel_thumbnail
    FROM videos v
    WHERE v.channel_name ILIKE search_query
      AND v.channel_id IS NOT NULL
    GROUP BY v.channel_id, v.channel_name
    ORDER BY total_views DESC NULLS LAST
    LIMIT result_limit
  )
  SELECT 
    cs.channel_id,
    cs.channel_name,
    cs.channel_thumbnail,
    cs.video_count,
    cs.total_views
  FROM channel_stats cs;
END;
$$ LANGUAGE plpgsql;

-- Create an index to speed up channel name searches if not exists
CREATE INDEX IF NOT EXISTS idx_videos_channel_name_pattern ON videos USING gin(channel_name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_videos_channel_id_name ON videos(channel_id, channel_name) WHERE channel_id IS NOT NULL;