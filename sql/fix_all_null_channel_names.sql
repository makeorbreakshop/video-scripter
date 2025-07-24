-- Fix all videos where channel_name is NULL but channel_id contains 'Make or Break Shop'
-- This appears to be a data import issue where channel name was stored in the wrong field

-- First, let's see what we're about to fix
SELECT 
  id,
  title,
  published_at,
  channel_name,
  channel_id
FROM videos 
WHERE channel_name IS NULL 
  AND channel_id = 'Make or Break Shop';

-- Fix the data by copying channel_id to channel_name
UPDATE videos 
SET channel_name = channel_id
WHERE channel_name IS NULL 
  AND channel_id = 'Make or Break Shop';

-- Verify the fix
SELECT 
  id,
  title,
  published_at,
  channel_name,
  channel_id
FROM videos 
WHERE channel_id = 'Make or Break Shop'
ORDER BY published_at DESC;

-- Note: The channel_id field still contains the channel name instead of the actual YouTube channel ID
-- This should be fixed in a future migration to use the proper YouTube channel ID format (UC...)