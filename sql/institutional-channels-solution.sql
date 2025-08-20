-- Institutional Channels Solution
-- This creates a channel-level system to track and filter institutional content

-- Step 1: Create table to track institutional channels
CREATE TABLE IF NOT EXISTS institutional_channels (
  channel_id TEXT PRIMARY KEY,
  channel_name TEXT NOT NULL,
  added_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  added_by TEXT,
  notes TEXT
);

-- Add index for fast lookups
CREATE INDEX IF NOT EXISTS idx_institutional_channels_name 
ON institutional_channels(channel_name);

-- Add comment
COMMENT ON TABLE institutional_channels IS 'Tracks news and institutional channels that should be filtered from discovery features';

-- Step 2: Populate with known news channels from your data
INSERT INTO institutional_channels (channel_id, channel_name, notes)
VALUES 
  ('UCBi2mrWuNuyYy4gbM6fU18Q', 'ABC News', 'Major news network'),
  ('UCeY0bbntWzzVIaj2z3QigXg', 'NBC News', 'Major news network'),
  ('UCknLrEdhRCp1aegoMqRaCZg', 'DW News', 'International news'),
  ('UCvJJ_dzjViJCoLf5uKUTwoA', 'CNBC', 'Business news'),
  ('UCJCdiZtw9zStiR3xgnp7qlg', 'First Coast News', 'Local news'),
  ('UC1VKVKhJLc7PjdPPVxTDk0Q', 'NBC4 Washington', 'Local NBC affiliate'),
  ('UCF8HUTbUwPKh2Q-KpGOCVGw', 'CNBC International Live', 'International business news'),
  ('UCup3etEdjyF1L3sRbU-rKLw', '24 News', 'News channel'),
  ('UC8urSFTmQDxaPDEIZ2Fd63Q', 'RTÉ News', 'Irish news'),
  ('UC6ZFN9Tx6xh-skXCuRHCDpQ', 'PBS NewsHour', 'Public broadcasting news'),
  ('UC5bKZHg4PzURMOWcvanl6nA', 'FOX 13 Seattle', 'Local FOX affiliate'),
  ('UCyWF77WR3CfkZ52cc9XK5wQ', 'KPTV FOX 12 | Local news, weather Portland, Oregon', 'Local FOX affiliate'),
  ('UCUKyRkZuMdNv87E8xbObN4g', 'KSL News Utah', 'Local news'),
  ('UCnWi59TPymx0_qt7PX3VeNA', 'PIX11 News', 'Local news'),
  ('UCjkETDTi-OBxrN4z5lvaL5A', 'CHCH News', 'Canadian news'),
  ('UCV5KgNhOM87RJB7Fbv8C2CQ', 'Idaho News 6', 'Local news'),
  ('UCry2gCVdntv6r661sKUiKXw', 'WCCO - CBS Minnesota', 'CBS affiliate')
ON CONFLICT (channel_id) DO NOTHING;

-- Step 3: Mark all existing videos from these channels as institutional
UPDATE videos v
SET is_institutional = true
FROM institutional_channels ic
WHERE v.channel_id = ic.channel_id
  AND v.is_institutional = false;

-- Step 4: Create a function to automatically mark videos as institutional
CREATE OR REPLACE FUNCTION mark_institutional_videos()
RETURNS TRIGGER AS $$
BEGIN
  -- Check if the video's channel is in the institutional_channels table
  IF EXISTS (SELECT 1 FROM institutional_channels WHERE channel_id = NEW.channel_id) THEN
    NEW.is_institutional = true;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Step 5: Create triggers for both INSERT and UPDATE operations
DROP TRIGGER IF EXISTS mark_institutional_on_insert ON videos;
CREATE TRIGGER mark_institutional_on_insert
  BEFORE INSERT ON videos
  FOR EACH ROW
  EXECUTE FUNCTION mark_institutional_videos();

DROP TRIGGER IF EXISTS mark_institutional_on_update ON videos;
CREATE TRIGGER mark_institutional_on_update
  BEFORE UPDATE ON videos
  FOR EACH ROW
  WHEN (NEW.channel_id IS DISTINCT FROM OLD.channel_id)
  EXECUTE FUNCTION mark_institutional_videos();

-- Step 6: Add more common news channels based on patterns
INSERT INTO institutional_channels (channel_id, channel_name, notes)
SELECT DISTINCT channel_id, channel_name, 'Auto-detected news channel'
FROM videos
WHERE (
  channel_name ILIKE '%cbs news%' OR
  channel_name ILIKE '%nbc news%' OR
  channel_name ILIKE '%abc news%' OR
  channel_name ILIKE '%fox news%' OR
  channel_name ILIKE '%cnn%' OR
  channel_name ILIKE '%msnbc%' OR
  channel_name ILIKE '%bloomberg%' OR
  channel_name ILIKE '%reuters%' OR
  channel_name ILIKE '%associated press%' OR
  channel_name ILIKE '%bbc news%' OR
  channel_name ILIKE '%sky news%' OR
  channel_name ILIKE '%al jazeera%' OR
  channel_name ILIKE '%euronews%' OR
  channel_name ILIKE '%france 24%' OR
  channel_name ILIKE '%npr%' OR
  channel_name ILIKE '%c-span%' OR
  channel_name ILIKE '%pbs news%' OR
  channel_name ILIKE '%washington post%' OR
  channel_name ILIKE '%new york times%' OR
  channel_name ILIKE '%guardian news%' OR
  channel_name ILIKE '%wall street journal%' OR
  channel_name ILIKE '%politico%' OR
  channel_name ILIKE '%axios%' OR
  channel_name ILIKE '%the hill%' OR
  channel_name ILIKE '%newsmax%' OR
  channel_name ILIKE '%oann%' OR
  channel_name ILIKE '%rt america%' OR
  channel_name ILIKE '%democracy now%' OR
  channel_name ILIKE '%the young turks%' OR
  channel_name ILIKE '%breaking points%'
)
AND channel_id NOT IN (SELECT channel_id FROM institutional_channels)
ON CONFLICT (channel_id) DO NOTHING;

-- Step 7: Mark all videos from newly added channels as institutional
UPDATE videos v
SET is_institutional = true
FROM institutional_channels ic
WHERE v.channel_id = ic.channel_id
  AND v.is_institutional = false;

-- Step 8: Create a view to help identify potential institutional channels
CREATE OR REPLACE VIEW potential_institutional_channels AS
SELECT 
  channel_id,
  channel_name,
  COUNT(*) as video_count,
  SUM(CASE WHEN is_institutional = true THEN 1 ELSE 0 END) as marked_count,
  'Not in list' as reason
FROM videos
WHERE channel_id NOT IN (SELECT channel_id FROM institutional_channels)
  AND (
    channel_name ILIKE '%news%' OR
    channel_name ILIKE '%cbs%' OR
    channel_name ILIKE '%nbc%' OR
    channel_name ILIKE '%abc%' OR
    channel_name ILIKE '%fox%' OR
    channel_name ILIKE '%cnn%' OR
    channel_name ILIKE '%bbc%' OR
    channel_name ILIKE '%npr%' OR
    channel_name ILIKE '%times%' OR
    channel_name ILIKE '%post%' OR
    channel_name ILIKE '%journal%'
  )
GROUP BY channel_id, channel_name
HAVING COUNT(*) > 10
ORDER BY video_count DESC;

-- Step 9: Report on the results
SELECT 
  'Total institutional channels' as metric,
  COUNT(*) as value
FROM institutional_channels
UNION ALL
SELECT 
  'Total videos marked institutional',
  COUNT(*)
FROM videos
WHERE is_institutional = true
UNION ALL
SELECT 
  'Videos that will be filtered from Idea Heist',
  COUNT(*)
FROM videos
WHERE is_institutional = true;