-- Fix channel_id consistency for RSS imported videos
-- This updates videos that have YouTube channel IDs in metadata but channel names in channel_id
-- Run this script to fix existing data after deploying the RSS filtering fix

-- First, check how many videos need to be updated
SELECT 
    COUNT(*) as videos_to_update,
    COUNT(DISTINCT channel_id) as channels_affected
FROM videos 
WHERE metadata->>'youtube_channel_id' IS NOT NULL 
  AND metadata->>'youtube_channel_id' != ''
  AND channel_id != metadata->>'youtube_channel_id'
  AND metadata->>'youtube_channel_id' LIKE 'UC%';

-- Update the channel_id field to use YouTube channel IDs for consistency
UPDATE videos 
SET channel_id = metadata->>'youtube_channel_id',
    updated_at = NOW()
WHERE metadata->>'youtube_channel_id' IS NOT NULL 
  AND metadata->>'youtube_channel_id' != ''
  AND channel_id != metadata->>'youtube_channel_id'
  AND metadata->>'youtube_channel_id' LIKE 'UC%';

-- Verify the update
SELECT 
    COUNT(*) as total_videos,
    COUNT(CASE WHEN channel_id LIKE 'UC%' THEN 1 END) as videos_with_youtube_channel_id,
    COUNT(CASE WHEN metadata->>'youtube_channel_id' IS NOT NULL THEN 1 END) as videos_with_metadata_channel_id
FROM videos 
WHERE metadata->>'rss_import' = 'true';