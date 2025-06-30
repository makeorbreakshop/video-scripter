-- Add competitor support fields to videos table
ALTER TABLE videos 
ADD COLUMN IF NOT EXISTS data_source TEXT DEFAULT 'owner' CHECK (data_source IN ('owner', 'competitor')),
ADD COLUMN IF NOT EXISTS is_competitor BOOLEAN DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS imported_by UUID REFERENCES auth.users(id),
ADD COLUMN IF NOT EXISTS import_date TIMESTAMPTZ DEFAULT NOW();

-- Create index for faster competitor queries
CREATE INDEX IF NOT EXISTS idx_videos_competitor ON videos(is_competitor, data_source);
CREATE INDEX IF NOT EXISTS idx_videos_channel_competitor ON videos(channel_id, is_competitor);

-- Add comment to document the new fields
COMMENT ON COLUMN videos.data_source IS 'Source of video data: owner (YouTube Analytics API) or competitor (public YouTube Data API)';
COMMENT ON COLUMN videos.is_competitor IS 'Whether this video belongs to a competitor channel';
COMMENT ON COLUMN videos.imported_by IS 'User who imported this competitor video';
COMMENT ON COLUMN videos.import_date IS 'When this video was imported into the system';