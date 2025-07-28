-- Create a dedicated transcripts table
CREATE TABLE IF NOT EXISTS transcripts (
  video_id TEXT PRIMARY KEY REFERENCES videos(id) ON DELETE CASCADE,
  transcript TEXT NOT NULL,
  language TEXT DEFAULT 'en',
  available_languages TEXT[],
  segments JSONB, -- Store timestamp data if needed
  word_count INTEGER,
  character_count INTEGER,
  fetched_at TIMESTAMPTZ DEFAULT NOW(),
  fetched_from TEXT DEFAULT 'supadata',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create index for faster lookups
CREATE INDEX idx_transcripts_video_id ON transcripts(video_id);
CREATE INDEX idx_transcripts_language ON transcripts(language);

-- Add RLS policies
ALTER TABLE transcripts ENABLE ROW LEVEL SECURITY;

-- Users can view transcripts for videos they can see
CREATE POLICY "Users can view transcripts" ON transcripts
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM videos 
      WHERE videos.id = transcripts.video_id 
      AND videos.user_id = auth.uid()
    )
  );

-- Users can insert transcripts for their videos
CREATE POLICY "Users can insert transcripts" ON transcripts
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM videos 
      WHERE videos.id = transcripts.video_id 
      AND videos.user_id = auth.uid()
    )
  );

-- Add a view for easy joining
CREATE VIEW videos_with_transcripts AS
SELECT 
  v.*,
  t.transcript,
  t.language as transcript_language,
  t.word_count,
  t.fetched_at as transcript_fetched_at
FROM videos v
LEFT JOIN transcripts t ON v.id = t.video_id;