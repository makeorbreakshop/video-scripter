-- Add channel_name column to videos table and populate it
-- This will fix the display of channel names in the packaging interface

-- Step 1: Add channel_name column
ALTER TABLE videos ADD COLUMN channel_name TEXT;

-- Step 2: Create index for performance
CREATE INDEX idx_videos_channel_name ON videos (channel_name);

-- Step 3: Populate channel_name from channel_discovery table for competitor videos
UPDATE videos 
SET channel_name = cd.channel_metadata->>'title'
FROM channel_discovery cd
WHERE videos.channel_id = cd.discovered_channel_id
  AND videos.is_competitor = true
  AND cd.channel_metadata->>'title' IS NOT NULL;

-- Step 4: Set channel name for user videos (Make or Break Shop)
UPDATE videos 
SET channel_name = 'Make or Break Shop'
WHERE is_competitor = false;

-- Step 5: Show results of the population
SELECT 
  'Population Results' as status,
  COUNT(*) as total_videos,
  COUNT(channel_name) as videos_with_names,
  COUNT(*) - COUNT(channel_name) as videos_missing_names,
  ROUND(100.0 * COUNT(channel_name) / COUNT(*), 1) as percentage_populated
FROM videos;

-- Step 6: Show sample of populated data
SELECT 
  channel_id,
  channel_name,
  is_competitor,
  title
FROM videos 
WHERE channel_name IS NOT NULL
ORDER BY is_competitor, channel_name
LIMIT 10;