-- Fix channel name population for existing competitor videos
-- The issue: channel names are stored in channel_id field, need to copy them to channel_name

-- Step 1: Fix competitor videos where channel_id contains the actual channel name
UPDATE videos 
SET channel_name = channel_id
WHERE is_competitor = true 
  AND (channel_name IS NULL OR channel_name = 'Unknown Channel')
  AND channel_id NOT LIKE 'UC%'  -- Don't touch actual YouTube channel IDs (they start with UC)
  AND LENGTH(channel_id) < 50     -- Only update reasonable channel names
  AND channel_id != '';

-- Step 2: Show results of the fix
SELECT 
  'After Fix - Competitor Videos' as status,
  COUNT(*) as total_competitor_videos,
  COUNT(channel_name) FILTER (WHERE channel_name != 'Unknown Channel') as videos_with_real_names,
  COUNT(channel_name) FILTER (WHERE channel_name = 'Unknown Channel') as videos_still_unknown
FROM videos 
WHERE is_competitor = true;

-- Step 3: Show sample of fixed data
SELECT 
  channel_id,
  channel_name,
  is_competitor,
  title
FROM videos 
WHERE is_competitor = true
  AND channel_name != 'Unknown Channel'
ORDER BY channel_name
LIMIT 10;