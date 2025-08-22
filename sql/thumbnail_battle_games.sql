-- Thumbnail Battle Games Table
-- Tracks individual game sessions (collections of battles)

CREATE TABLE IF NOT EXISTS thumbnail_battle_games (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  game_id UUID NOT NULL UNIQUE,
  player_session_id TEXT NOT NULL,
  final_score INTEGER NOT NULL DEFAULT 0,
  battles_played INTEGER NOT NULL DEFAULT 0,
  battles_won INTEGER NOT NULL DEFAULT 0,
  lives_remaining INTEGER NOT NULL DEFAULT 0,
  game_duration_ms INTEGER, -- Total time from start to finish
  started_at TIMESTAMPTZ DEFAULT NOW(),
  ended_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for efficient queries
CREATE INDEX IF NOT EXISTS idx_thumbnail_battle_games_player_session 
ON thumbnail_battle_games(player_session_id);

CREATE INDEX IF NOT EXISTS idx_thumbnail_battle_games_final_score 
ON thumbnail_battle_games(final_score DESC);

CREATE INDEX IF NOT EXISTS idx_thumbnail_battle_games_ended_at 
ON thumbnail_battle_games(ended_at DESC);

-- Add game_id foreign key to matchups table to link battles to games
ALTER TABLE thumbnail_battle_matchups 
ADD COLUMN IF NOT EXISTS game_id UUID REFERENCES thumbnail_battle_games(game_id);

-- Index for the new foreign key
CREATE INDEX IF NOT EXISTS idx_thumbnail_battle_matchups_game_id 
ON thumbnail_battle_matchups(game_id);