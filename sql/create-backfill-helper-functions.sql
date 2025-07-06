-- Helper functions for YouTube Channel ID backfill process

-- Function to get channels missing YouTube Channel IDs
CREATE OR REPLACE FUNCTION get_channels_missing_youtube_ids()
RETURNS TABLE(
  channel_id TEXT,
  sample_video_id TEXT,
  video_count BIGINT
)
LANGUAGE sql
STABLE
AS $$
  SELECT 
    v.channel_id,
    (ARRAY_AGG(v.id ORDER BY v.published_at DESC))[1] as sample_video_id,
    COUNT(*) as video_count
  FROM videos v
  WHERE v.channel_id NOT LIKE 'UC%'
    AND (v.metadata->>'youtube_channel_id' IS NULL 
         OR v.metadata->>'youtube_channel_id' NOT LIKE 'UC%')
    AND v.channel_id != 'Make or Break Shop' -- Exclude user's own channel
    AND v.channel_id IS NOT NULL
    AND v.id IS NOT NULL
  GROUP BY v.channel_id
  HAVING COUNT(*) > 0
  ORDER BY COUNT(*) DESC;
$$;

-- Function to create the helper function (for script compatibility)
CREATE OR REPLACE FUNCTION create_missing_channels_function()
RETURNS TEXT
LANGUAGE sql
AS $$
  SELECT 'Helper function already exists'::TEXT;
$$;

-- Verify the functions work
SELECT 'Testing get_channels_missing_youtube_ids function...' as status;
SELECT COUNT(*) as missing_channels_count FROM get_channels_missing_youtube_ids();

SELECT 'Testing get_youtube_channel_ids function...' as status;
SELECT COUNT(*) as monitored_channels_count FROM get_youtube_channel_ids();