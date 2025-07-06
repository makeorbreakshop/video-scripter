-- Fix get_youtube_channel_ids() RPC function to return ALL YouTube Channel IDs
-- Current function only returns 85 channels, should return 162

-- Drop the existing broken function
DROP FUNCTION IF EXISTS get_youtube_channel_ids();

-- Create the corrected function that returns ALL YouTube Channel IDs
CREATE OR REPLACE FUNCTION get_youtube_channel_ids()
RETURNS TABLE(youtube_channel_id TEXT)
LANGUAGE sql
STABLE
AS $$
  SELECT DISTINCT metadata->>'youtube_channel_id' as youtube_channel_id
  FROM videos 
  WHERE metadata->>'youtube_channel_id' IS NOT NULL
    AND metadata->>'youtube_channel_id' LIKE 'UC%'
  ORDER BY youtube_channel_id;
$$;

-- Test the function
SELECT COUNT(*) as total_channels_returned FROM get_youtube_channel_ids();

-- Verify we're getting the missing channels
SELECT youtube_channel_id FROM get_youtube_channel_ids() 
WHERE youtube_channel_id IN ('UCtinbF-Q-fVthA0qrFQTgXQ', 'UC4v2tQ8GqP0RbmAzhp4IFkQ', 'UC6x7GwJxuoABSosgVXDYtTw');