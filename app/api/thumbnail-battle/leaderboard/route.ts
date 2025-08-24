import { NextResponse } from 'next/server';
import { getSupabase } from '@/lib/supabase-lazy';

// Test players to filter out from leaderboards
function filterTestPlayers(leaderboard: any[]) {
  return leaderboard?.filter(entry => 
    entry.player_name?.toLowerCase() !== 'dev0'
  );
}

export async function GET(request: Request) {
  const supabase = getSupabase();
  const { searchParams } = new URL(request.url);
  const type = searchParams.get('type') || 'best_games';
  const limit = parseInt(searchParams.get('limit') || '15');

  try {
    let query;

    // Different leaderboard types
    switch (type) {
      case 'best_games':
      default:
        // Get game records only - all scores now migrated to games table
        const gameResult = await supabase
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
          .limit(limit);
          
        if (gameResult.error) throw gameResult.error;
        
        // Get player names for games  
        const gameSessionIds = gameResult.data?.map(g => g.player_session_id).filter(Boolean) || [];
        const gamePlayers = await supabase
          .from('thumbnail_battle_players')
          .select('session_id, player_name')
          .in('session_id', gameSessionIds);
        
        const gamePlayerMap = new Map(gamePlayers.data?.map(p => [p.session_id, p.player_name]) || []);
        
        // Convert games to leaderboard entries
        const leaderboard = gameResult.data?.map(game => ({
          player_name: gamePlayerMap.get(game.player_session_id) || 'Unknown',
          best_score: game.final_score,
          total_battles: game.battles_played,
          total_wins: game.battles_won,
          created_at: game.ended_at,
          accuracy: game.battles_played > 0 
            ? Math.round((game.battles_won / game.battles_played) * 100)
            : 0,
          game_duration_ms: game.game_duration_ms
        })) || [];
        
        return NextResponse.json({ leaderboard: filterTestPlayers(leaderboard) });
        break;
      
      case 'best_players':
        // Show best players (consolidated by name)
        query = supabase
          .from('thumbnail_battle_players')
          .select('player_name, best_score, total_battles, total_wins, created_at')
          .order('best_score', { ascending: false })
          .limit(limit);
        break;
      
      case 'most_battles':
        query = supabase
          .from('thumbnail_battle_players')
          .select('player_name, best_score, total_battles, total_wins, created_at')
          .order('total_battles', { ascending: false })
          .limit(limit);
        break;
      
      case 'recent':
        // Recent games by time (newest first)
        const { data: recentRawData, error: recentRawError } = await supabase.rpc('get_recent_games', { 
          game_limit: limit 
        });
        
        if (recentRawError) {
          // Fallback to manual query, excluding timeout games
          const recentResult = await supabase
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
            .order('ended_at', { ascending: false })
            .limit(limit);
            
          if (recentResult.error) throw recentResult.error;
          
          // Get player names
          const sessionIds = recentResult.data?.map(g => g.player_session_id).filter(Boolean) || [];
          const players = await supabase
            .from('thumbnail_battle_players')
            .select('session_id, player_name')
            .in('session_id', sessionIds);
          
          const playerMap = new Map(players.data?.map(p => [p.session_id, p.player_name]) || []);
          
          const leaderboard = recentResult.data?.map(game => ({
            player_name: playerMap.get(game.player_session_id) || 'Unknown',
            best_score: game.final_score,
            total_battles: game.battles_played,
            total_wins: game.battles_won,
            created_at: game.ended_at,
            accuracy: game.battles_played > 0 
              ? Math.round((game.battles_won / game.battles_played) * 100)
              : 0,
            game_duration_ms: game.game_duration_ms
          }));
          
          return NextResponse.json({ leaderboard: filterTestPlayers(leaderboard) });
        }
        
        // Format RPC data if it worked
        const recentLeaderboard = recentRawData?.map((game: any) => ({
          player_name: game.player_name,
          best_score: game.final_score,
          total_battles: game.battles_played,
          total_wins: game.battles_won,
          created_at: game.ended_at,
          accuracy: game.battles_played > 0 
            ? Math.round((game.battles_won / game.battles_played) * 100)
            : 0,
          game_duration_ms: game.game_duration_ms
        }));
        
        return NextResponse.json({ leaderboard: filterTestPlayers(recentLeaderboard) });
        break;

      case 'today':
        // Games played today, excluding timeout games
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        query = supabase
          .from('thumbnail_battle_games')
          .select(`
            final_score,
            battles_played,
            battles_won,
            ended_at,
            game_duration_ms,
            thumbnail_battle_players!inner(player_name)
          `)
          .not('ended_at', 'is', null)
          .neq('is_timeout', true)
          .gte('ended_at', today.toISOString())
          .order('final_score', { ascending: false })
          .limit(limit);
        break;
    }

    const { data, error } = await query;

    if (error) throw error;

    let leaderboard;
    
    if (type === 'best_games' || type === 'today') {
      // Transform game data for leaderboard display
      leaderboard = data?.map(game => ({
        player_name: game.thumbnail_battle_players.player_name,
        best_score: game.final_score,
        total_battles: game.battles_played,
        total_wins: game.battles_won,
        created_at: game.ended_at, // Use game end time, not player creation time
        accuracy: game.battles_played > 0 
          ? Math.round((game.battles_won / game.battles_played) * 100)
          : 0,
        game_duration_ms: game.game_duration_ms
      }));
    } else {
      // Calculate accuracy for player-based leaderboards
      leaderboard = data?.map(player => ({
        ...player,
        accuracy: player.total_battles > 0 
          ? Math.round((player.total_wins / player.total_battles) * 100)
          : 0
      }));
    }

    return NextResponse.json({ leaderboard: filterTestPlayers(leaderboard) });
  } catch (error) {
    console.error('Error fetching leaderboard:', error);
    return NextResponse.json({ error: 'Failed to fetch leaderboard' }, { status: 500 });
  }
}