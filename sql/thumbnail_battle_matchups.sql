-- Create table for storing thumbnail battle matchups
CREATE TABLE IF NOT EXISTS thumbnail_battle_matchups (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  matchup_id UUID NOT NULL UNIQUE,
  video_a_id UUID NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
  video_b_id UUID NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
  video_a_score DECIMAL(10, 2) NOT NULL,
  video_b_score DECIMAL(10, 2) NOT NULL,
  winner_id UUID NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL,
  -- Optional: Track player selections for analytics
  player_session_id TEXT,
  player_selection CHAR(1), -- 'A' or 'B'
  is_correct BOOLEAN,
  response_time_ms INTEGER,
  answered_at TIMESTAMPTZ
);

-- Create indexes for fast lookups
CREATE INDEX IF NOT EXISTS idx_matchup_id ON thumbnail_battle_matchups(matchup_id);
CREATE INDEX IF NOT EXISTS idx_expires_at ON thumbnail_battle_matchups(expires_at);
CREATE INDEX IF NOT EXISTS idx_created_at ON thumbnail_battle_matchups(created_at);
CREATE INDEX IF NOT EXISTS idx_player_session ON thumbnail_battle_matchups(player_session_id);

-- Create a function to clean up expired matchups (optional, can be run periodically)
CREATE OR REPLACE FUNCTION cleanup_expired_matchups()
RETURNS INTEGER AS $$
DECLARE
  deleted_count INTEGER;
BEGIN
  DELETE FROM thumbnail_battle_matchups
  WHERE expires_at < NOW()
  AND answered_at IS NULL;  -- Only delete unanswered expired matchups
  
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN deleted_count;
END;
$$ LANGUAGE plpgsql;

-- Add comment for documentation
COMMENT ON TABLE thumbnail_battle_matchups IS 'Stores thumbnail battle matchup data with answers for validation and analytics';