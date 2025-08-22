import { NextResponse } from 'next/server';
import { getSupabase } from '@/lib/supabase-lazy';

export async function GET(request: Request) {
  const supabase = getSupabase();
  const { searchParams } = new URL(request.url);
  const type = searchParams.get('type') || 'highest_scores';
  const limit = parseInt(searchParams.get('limit') || '10');

  try {
    let gameQuery;

    // First, get the games data
    switch (type) {
      case 'highest_scores':
        gameQuery = supabase
          .from('thumbnail_battle_games')
          .select('*')
          .not('ended_at', 'is', null) // Only completed games
          .order('final_score', { ascending: false })
          .limit(limit);
        break;

      case 'recent_games':
        gameQuery = supabase
          .from('thumbnail_battle_games')
          .select('*')
          .not('ended_at', 'is', null) // Only completed games
          .order('ended_at', { ascending: false })
          .limit(limit);
        break;

      case 'longest_streaks':
        gameQuery = supabase
          .from('thumbnail_battle_games')
          .select('*')
          .not('ended_at', 'is', null) // Only completed games
          .order('battles_won', { ascending: false })
          .limit(limit);
        break;

      default:
        return NextResponse.json({ error: 'Invalid leaderboard type' }, { status: 400 });
    }

    const { data: games, error: gameError } = await gameQuery;
    if (gameError) throw gameError;

    if (!games || games.length === 0) {
      return NextResponse.json({ 
        leaderboard: [],
        type,
        total_games: 0
      });
    }

    // Get player names for these games
    const sessionIds = [...new Set(games.map(g => g.player_session_id))];
    const { data: players, error: playersError } = await supabase
      .from('thumbnail_battle_players')
      .select('session_id, player_name')
      .in('session_id', sessionIds);

    if (playersError) {
      console.error('Error fetching players:', playersError);
      // Continue without player names
    }

    // Create a map for quick player name lookup
    const playerMap = new Map();
    if (players) {
      players.forEach(p => playerMap.set(p.session_id, p.player_name));
    }

    // Format the leaderboard data to match the expected structure
    const gameLeaderboard = games.map(game => ({
      // Match the LeaderboardEntry interface from frontend
      player_name: playerMap.get(game.player_session_id) || 'Anonymous',
      best_score: game.final_score, // Use final_score as the displayed score
      total_battles: game.battles_played,
      total_wins: game.battles_won,
      accuracy: game.battles_played > 0 
        ? Math.round((game.battles_won / game.battles_played) * 100)
        : 0,
      created_at: game.ended_at, // Use ended_at as the timestamp
      
      // Additional game-specific data (not shown in UI but available)
      game_id: game.game_id,
      game_duration_ms: game.game_duration_ms,
      started_at: game.started_at,
      ended_at: game.ended_at
    }));

    return NextResponse.json({ 
      leaderboard: gameLeaderboard,
      type,
      total_games: gameLeaderboard.length
    });
    
  } catch (error) {
    console.error('Error fetching game leaderboard:', error);
    return NextResponse.json({ error: 'Failed to fetch game leaderboard' }, { status: 500 });
  }
}