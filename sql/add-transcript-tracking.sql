-- Add transcript tracking to videos table
ALTER TABLE videos 
ADD COLUMN IF NOT EXISTS has_transcript BOOLEAN DEFAULT FALSE;

-- Create index for efficient filtering
CREATE INDEX IF NOT EXISTS idx_videos_has_transcript ON videos(has_transcript);

-- Update existing videos that have transcripts
UPDATE videos v
SET has_transcript = TRUE
WHERE EXISTS (
  SELECT 1 FROM transcripts t 
  WHERE t.video_id = v.id
);

-- Check results
SELECT 
  COUNT(*) as total_videos,
  COUNT(CASE WHEN has_transcript THEN 1 END) as with_transcripts,
  COUNT(CASE WHEN NOT has_transcript THEN 1 END) as without_transcripts
FROM videos;