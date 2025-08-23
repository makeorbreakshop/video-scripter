import { NextResponse } from 'next/server';
import { getSupabase } from '@/lib/supabase-lazy';

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
        // Use raw SQL for the join since Supabase join syntax is tricky
        const { data: rawData, error: rawError } = await supabase.rpc('get_leaderboard_games', { 
          game_limit: limit 
        });
        
        if (rawError) {
          // Fallback to manual query if RPC doesn't exist
          const result = await supabase
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
            .order('final_score', { ascending: false })
            .limit(limit);
            
          if (result.error) throw result.error;
          
          // Get player names separately
          const sessionIds = result.data?.map(g => g.player_session_id).filter(Boolean) || [];
          const players = await supabase
            .from('thumbnail_battle_players')
            .select('session_id, player_name')
            .in('session_id', sessionIds);
          
          const playerMap = new Map(players.data?.map(p => [p.session_id, p.player_name]) || []);
          
          const leaderboard = result.data?.map(game => ({
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
          
          return NextResponse.json({ leaderboard });
        }
        
        // If RPC worked, format the data
        const leaderboard = rawData?.map((game: any) => ({
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
        
        return NextResponse.json({ leaderboard });
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
      
      case 'today':
        // Games played today
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

    return NextResponse.json({ leaderboard });
  } catch (error) {
    console.error('Error fetching leaderboard:', error);
    return NextResponse.json({ error: 'Failed to fetch leaderboard' }, { status: 500 });
  }
}