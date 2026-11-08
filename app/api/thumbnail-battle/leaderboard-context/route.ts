import { NextResponse } from 'next/server';
import { getSupabase } from '@/lib/supabase-lazy';
import {
  computeRankContextWindow,
  ScoreRow,
  WINDOW_ABOVE,
  WINDOW_BELOW,
} from '@/lib/thumbnail-battle/rank-core';

// Game-over rank and the 5 rows above/below the player.
//
// This used to call a `get_leaderboard_context` RPC that does not exist in the
// database (it failed on every request) and then download the ENTIRE games or
// players table to find one position. Now it counts the rows that beat the
// score and fetches only a ~60-row window around that position.
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const playerName = searchParams.get('player_name');
  const finalScoreParam = searchParams.get('final_score');
  const useGamesTable = searchParams.get('use_games_table') === 'true';
  const finalScore = parseInt(finalScoreParam || '0');

  if (!playerName || finalScoreParam === null) {
    return NextResponse.json({ error: 'Missing player_name or final_score' }, { status: 400 });
  }

  try {
    const supabase = getSupabase();

    if (useGamesTable) {
      // Games table ranking, matching the main leaderboard.
      const { count: above, error: countError } = await supabase
        .from('thumbnail_battle_games')
        .select('id', { count: 'exact', head: true })
        .not('ended_at', 'is', null)
        .neq('is_timeout', true)
        .gt('final_score', finalScore);
      if (countError) throw countError;

      const offset = Math.max(0, (above ?? 0) - WINDOW_ABOVE);
      const { data: gameScores, error: gameError } = await supabase
        .from('thumbnail_battle_games')
        .select('final_score, battles_played, battles_won, ended_at, game_duration_ms, player_session_id')
        .not('ended_at', 'is', null)
        .neq('is_timeout', true)
        .order('final_score', { ascending: false })
        .order('battles_played', { ascending: true })
        .order('ended_at', { ascending: false })
        .range(offset, offset + WINDOW_ABOVE + WINDOW_BELOW - 1);
      if (gameError) throw gameError;

      const sessionIds = [...new Set((gameScores || []).map((g) => g.player_session_id).filter(Boolean))];
      const { data: players } = sessionIds.length
        ? await supabase
            .from('thumbnail_battle_players')
            .select('session_id, player_name')
            .in('session_id', sessionIds)
        : { data: [] as { session_id: string; player_name: string }[] };
      const nameBySession = new Map<string, string>(((players || []) as any[]).map((p) => [p.session_id, p.player_name]));

      const rows: ScoreRow[] = ((gameScores || []) as any[]).map((game) => ({
        player_name: nameBySession.get(game.player_session_id) || 'Unknown',
        best_score: game.final_score,
        total_battles: game.battles_played,
        total_wins: game.battles_won,
        last_played: game.ended_at,
        accuracy: game.battles_played > 0 ? Math.round((game.battles_won / game.battles_played) * 100) : 0,
        game_duration_ms: game.game_duration_ms,
      }));

      const { playerRank, context } = computeRankContextWindow(rows, offset, playerName, finalScore);
      return NextResponse.json({ leaderboard_context: context, player_rank: playerRank });
    }

    // Legacy: rank by each player's best score.
    const { count: above, error: countError } = await supabase
      .from('thumbnail_battle_players')
      .select('session_id', { count: 'exact', head: true })
      .gt('best_score', finalScore);
    if (countError) throw countError;

    const offset = Math.max(0, (above ?? 0) - WINDOW_ABOVE);
    const { data: allScores, error: fetchError } = await supabase
      .from('thumbnail_battle_players')
      .select('player_name, best_score, total_battles, total_wins, last_played')
      .order('best_score', { ascending: false })
      .order('total_battles', { ascending: true }) // Tiebreaker: fewer battles = higher rank
      .order('last_played', { ascending: false }) // Second tiebreaker: more recent = higher rank
      .range(offset, offset + WINDOW_ABOVE + WINDOW_BELOW - 1);
    if (fetchError) throw fetchError;

    const legacyScores: ScoreRow[] = ((allScores || []) as any[]).map((p) => ({
      player_name: p.player_name || 'Unknown',
      best_score: p.best_score,
      total_battles: p.total_battles,
      total_wins: p.total_wins,
      last_played: p.last_played,
      accuracy: p.total_battles > 0 ? Math.round((p.total_wins / p.total_battles) * 100) : 0,
      game_duration_ms: null,
    }));

    const { playerRank, context } = computeRankContextWindow(legacyScores, offset, playerName, finalScore);
    return NextResponse.json({ leaderboard_context: context, player_rank: playerRank });
  } catch (error) {
    console.error('Error fetching leaderboard context:', error);
    return NextResponse.json({ error: 'Failed to fetch leaderboard context' }, { status: 500 });
  }
}
