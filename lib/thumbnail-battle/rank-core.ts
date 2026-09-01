// Pure ranking/context logic for the Thumbnail Battle game-over screen.
// Extracted from app/api/thumbnail-battle/leaderboard-context so the rank
// math is testable. Fixes the `findIndex(...) ?? length` bug: findIndex
// returns -1 (never null), so a score lower than everything on the board
// produced playerIndex -1 and a displayed rank of #0.

export interface ScoreRow {
  player_name: string;
  best_score: number;
  total_battles: number;
  total_wins: number;
  last_played: string | null;
  accuracy: number;
  game_duration_ms: number | null;
}

export interface ContextEntry extends Omit<ScoreRow, 'last_played'> {
  rank: number;
  created_at: string | null;
  is_current_player: boolean;
}

export interface RankContext {
  playerRank: number; // 1-based, never 0
  context: ContextEntry[];
}

// allScores must already be sorted best-first (score desc, then tiebreakers).
export function computeRankContext(
  allScores: ScoreRow[],
  playerName: string,
  finalScore: number
): RankContext {
  const exactIndex = allScores.findIndex(
    (e) => e.player_name === playerName && e.best_score === finalScore
  );

  let playerIndex: number;
  if (exactIndex !== -1) {
    playerIndex = exactIndex;
  } else {
    const insertion = allScores.findIndex((e) => e.best_score < finalScore);
    playerIndex = insertion === -1 ? allScores.length : insertion;
  }

  const start = Math.max(0, playerIndex - 5);
  const end = Math.min(allScores.length, playerIndex + 6);

  const context: ContextEntry[] = allScores.slice(start, end).map((e, i) => ({
    player_name: e.player_name,
    best_score: e.best_score,
    rank: start + i + 1,
    total_battles: e.total_battles,
    total_wins: e.total_wins,
    created_at: e.last_played,
    accuracy: e.accuracy,
    game_duration_ms: e.game_duration_ms,
    is_current_player: start + i === playerIndex && exactIndex !== -1,
  }));

  if (exactIndex === -1) {
    // Virtual row for a game not (yet) persisted on the board.
    const insertAt = Math.min(context.length, Math.max(0, playerIndex - start));
    context.splice(insertAt, 0, {
      player_name: playerName,
      best_score: finalScore,
      rank: playerIndex + 1,
      total_battles: 0,
      total_wins: 0,
      created_at: null,
      accuracy: 0,
      game_duration_ms: null,
      is_current_player: true,
    });
    // Rows below the virtual player shift down one rank.
    context.forEach((e, i) => {
      if (i > insertAt) e.rank = e.rank + 1;
    });
    if (context.length > 11) context.splice(11);
  }

  return { playerRank: playerIndex + 1, context };
}
