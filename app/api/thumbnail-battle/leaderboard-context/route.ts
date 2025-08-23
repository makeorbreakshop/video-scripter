import { NextResponse } from 'next/server';
import { getSupabase } from '@/lib/supabase-lazy';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const playerName = searchParams.get('player_name');
  const finalScore = parseInt(searchParams.get('final_score') || '0');

  if (!playerName || !finalScore) {
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
      // Fallback to manual query if RPC doesn't exist
      console.log('RPC failed, using fallback query:', error);
      
      // Manual fallback - query tables separately and join in JS
      const [gamesResult, playersResult] = await Promise.all([
        supabase
          .from('thumbnail_battle_games')
          .select('final_score, ended_at, battles_played, battles_won, player_session_id')
          .not('ended_at', 'is', null)
          .order('final_score', { ascending: false }),
        supabase
          .from('thumbnail_battle_players')
          .select('session_id, player_name')
      ]);

      if (gamesResult.error) throw gamesResult.error;
      if (playersResult.error) throw playersResult.error;

      // Create a lookup map for players
      const playerLookup = new Map();
      playersResult.data?.forEach(player => {
        playerLookup.set(player.session_id, player.player_name);
      });

      // Join games with player names
      const allScores = gamesResult.data?.map(game => ({
        ...game,
        player_name: playerLookup.get(game.player_session_id) || 'Unknown'
      })) || [];

      const fetchError = null; // No error if we get here

      if (fetchError) throw fetchError;

      // Find player's rank  
      const playerIndex = allScores?.findIndex(game => 
        game.player_name === playerName && game.final_score === finalScore
      ) ?? -1;

      if (playerIndex === -1) {
        return NextResponse.json({ error: 'Player score not found' }, { status: 404 });
      }

      // Get context window (5 above, player, 5 below)
      const start = Math.max(0, playerIndex - 5);
      const end = Math.min(allScores.length, playerIndex + 6);
      const contextData = allScores.slice(start, end).map((game, index) => ({
        player_name: game.player_name || 'Unknown',
        best_score: game.final_score,
        rank: start + index + 1,
        total_battles: game.battles_played,
        total_wins: game.battles_won,
        created_at: game.ended_at,
        accuracy: game.battles_played > 0 
          ? Math.round((game.battles_won / game.battles_played) * 100)
          : 0,
        is_current_player: game.player_name === playerName && game.final_score === finalScore
      }));

      return NextResponse.json({ 
        leaderboard_context: contextData,
        player_rank: playerIndex + 1
      });
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