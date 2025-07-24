-- Fix the F2 video's channel fields
-- The channel_id is incorrectly set to "Make or Break Shop" (which should be the channel_name)
-- and channel_name is NULL

UPDATE videos 
SET channel_name = 'Make or Break Shop'
WHERE id = '2iEHEDWaHOw' 
  AND channel_id = 'Make or Break Shop';

-- Verify the fix
SELECT id, title, channel_name, channel_id 
FROM videos 
WHERE id = '2iEHEDWaHOw';