import { NextResponse } from 'next/server';
import { getSupabase } from '@/lib/supabase-lazy';
import { computeRankContext, ScoreRow } from '@/lib/thumbnail-battle/rank-core';

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
    
    // Use a SQL function for efficient window query
    const { data, error } = await supabase.rpc('get_leaderboard_context', {
      target_player: playerName,
      target_score: finalScore,
      context_size: 5  // 5 above and 5 below
    });

    if (error) {
      // Fallback to manual query if RPC doesn't exist (expected)
      
      if (useGamesTable) {
        // Use games table for scalable ranking - matches main leaderboard
        const { data: gameScores, error: gameError } = await supabase
          .from('thumbnail_battle_games')
          .select(`
            final_score,
            battles_played,
            battles_won,
            ended_at,
            game_duration_ms,
            player_session_id
          `)
          .not('ended_at', 'is', null)
          .neq('is_timeout', true)
          .order('final_score', { ascending: false })
          .order('battles_played', { ascending: true })
          .order('ended_at', { ascending: false });
        
        if (gameError) throw gameError;
        
        // Get player names for games  
        const gameSessionIds = gameScores?.map(g => g.player_session_id).filter(Boolean) || [];
        const gamePlayers = await supabase
          .from('thumbnail_battle_players')
          .select('session_id, player_name')
          .in('session_id', gameSessionIds);
        
        const gamePlayerMap = new Map(gamePlayers.data?.map(p => [p.session_id, p.player_name]) || []);
        
        // Convert games to leaderboard entries
        const allScores = gameScores?.map(game => ({
          player_name: gamePlayerMap.get(game.player_session_id) || 'Unknown',
          best_score: game.final_score,
          total_battles: game.battles_played,
          total_wins: game.battles_won,
          last_played: game.ended_at,
          accuracy: game.battles_played > 0 
            ? Math.round((game.battles_won / game.battles_played) * 100)
            : 0,
          game_duration_ms: game.game_duration_ms
        })) || [];
        
        // Rank math lives in lib/thumbnail-battle/rank-core (tested; fixes
        // the findIndex(-1) → rank #0 regression).
        const { playerRank, context } = computeRankContext(
          allScores as ScoreRow[],
          playerName,
          finalScore
        );
        return NextResponse.json({
          leaderboard_context: context,
          player_rank: playerRank,
        });
        
      } else {
        // Legacy fallback - query player best scores 
        const { data: allScores, error: fetchError } = await supabase
          .from('thumbnail_battle_players')
          .select('player_name, best_score, total_battles, total_wins, last_played')
          .order('best_score', { ascending: false })
          .order('total_battles', { ascending: true }) // Tiebreaker: fewer battles = higher rank
          .order('last_played', { ascending: false }); // Second tiebreaker: more recent = higher rank

        if (fetchError) throw fetchError;

        const legacyScores: ScoreRow[] = (allScores || []).map((p) => ({
          player_name: p.player_name || 'Unknown',
          best_score: p.best_score,
          total_battles: p.total_battles,
          total_wins: p.total_wins,
          last_played: p.last_played,
          accuracy: p.total_battles > 0 ? Math.round((p.total_wins / p.total_battles) * 100) : 0,
          game_duration_ms: null,
        }));

        const { playerRank, context } = computeRankContext(legacyScores, playerName, finalScore);
        return NextResponse.json({
          leaderboard_context: context,
          player_rank: playerRank,
        });
      }
    }

    // Format RPC data if it worked
    const formattedData = data?.map((entry: any) => ({
      player_name: entry.player_name,
      best_score: entry.final_score,
      rank: entry.rank,
      total_battles: entry.battles_played || 0,
      total_wins: entry.battles_won || 0,
      created_at: entry.ended_at,
      accuracy: entry.battles_played > 0 
        ? Math.round((entry.battles_won / entry.battles_played) * 100)
        : 0,
      is_current_player: entry.player_name === playerName && entry.final_score === finalScore
    }));

    const playerRank = formattedData?.find((entry: any) => entry.is_current_player)?.rank || null;

    return NextResponse.json({ 
      leaderboard_context: formattedData,
      player_rank: playerRank
    });

  } catch (error) {
    console.error('Error fetching leaderboard context:', error);
    return NextResponse.json({ error: 'Failed to fetch leaderboard context' }, { status: 500 });
  }
}