import { NextResponse } from 'next/server';
import { getSupabase } from '@/lib/supabase-lazy';

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
        
        // Find player's rank by matching name and score
        let playerIndex = allScores.findIndex(entry => 
          entry.player_name === playerName && entry.best_score === finalScore
        );

        // If exact match not found, find insertion point for this score
        if (playerIndex === -1) {
          playerIndex = allScores.findIndex(entry => entry.best_score < finalScore) ?? allScores.length;
          
          // If score is 0 or very low, show bottom of leaderboard
          if (finalScore <= 0) {
            playerIndex = Math.max(0, allScores.length - 6);
          }
        }

        // Get context window (5 above, player, 5 below)
        const start = Math.max(0, playerIndex - 5);
        const end = Math.min(allScores.length, playerIndex + 6);
        const exactMatch = allScores.some(entry => 
          entry.player_name === playerName && entry.best_score === finalScore
        );

        const contextData = allScores.slice(start, end).map((entry, index) => ({
          player_name: entry.player_name,
          best_score: entry.best_score,
          rank: start + index + 1,
          total_battles: entry.total_battles,
          total_wins: entry.total_wins,
          created_at: entry.last_played,
          accuracy: entry.accuracy,
          game_duration_ms: entry.game_duration_ms,
          is_current_player: entry.player_name === playerName && entry.best_score === finalScore
        }));

        // If no exact match, add estimated position info
        if (!exactMatch && finalScore > 0) {
          const virtualPlayer = {
            player_name: playerName,
            best_score: finalScore,
            rank: playerIndex + 1,
            total_battles: 0,
            total_wins: 0,
            created_at: new Date().toISOString(),
            accuracy: 0,
            game_duration_ms: 0,
            is_current_player: true
          };

          // Insert at the correct position
          const insertAt = Math.min(5, Math.max(0, playerIndex - start));
          contextData.splice(insertAt, 0, virtualPlayer);
          
          // Update ranks after insertion
          contextData.forEach((entry, idx) => {
            if (idx > insertAt && !entry.is_current_player) {
              entry.rank = start + idx + 1;
            }
          });
          
          // Keep only 11 entries (5 above, player, 5 below)
          if (contextData.length > 11) {
            contextData.splice(11);
          }
        }

        return NextResponse.json({ 
          leaderboard_context: contextData,
          player_rank: playerIndex + 1
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

        // Find player's rank by matching name and best score
        let playerIndex = allScores?.findIndex(player => 
          player.player_name === playerName && player.best_score === finalScore
        ) ?? -1;

        // If exact match not found, try to find where this score would rank
        if (playerIndex === -1) {
          // Find insertion point for this score
          playerIndex = allScores?.findIndex(player => player.best_score < finalScore) ?? allScores?.length ?? 0;
          
          // If score is 0 or very low, show bottom of leaderboard
          if (finalScore <= 0) {
            playerIndex = Math.max(0, (allScores?.length ?? 0) - 6); // Show last 6 entries
          }
        }

        // Get context window (5 above, player, 5 below)
        const start = Math.max(0, playerIndex - 5);
        const end = Math.min(allScores.length, playerIndex + 6);
        const exactMatch = allScores?.some(player => 
          player.player_name === playerName && player.best_score === finalScore
        );

        const contextData = allScores.slice(start, end).map((player, index) => ({
          player_name: player.player_name || 'Unknown',
          best_score: player.best_score,
          rank: start + index + 1,
          total_battles: player.total_battles,
          total_wins: player.total_wins,
          created_at: player.last_played,
          accuracy: player.total_battles > 0 
            ? Math.round((player.total_wins / player.total_battles) * 100)
            : 0,
          is_current_player: player.player_name === playerName && player.best_score === finalScore
        }));

        // If no exact match, add estimated position info
        if (!exactMatch && finalScore > 0) {
          // Insert a virtual entry for the current player at their estimated position
          const virtualPlayer = {
            player_name: playerName,
            best_score: finalScore,
            rank: playerIndex + 1,
            total_battles: 0,
            total_wins: 0,
            created_at: new Date().toISOString(),
            accuracy: 0,
            is_current_player: true
          };

          // Insert at the correct position
          const insertAt = Math.min(5, Math.max(0, playerIndex - start));
          contextData.splice(insertAt, 0, virtualPlayer);
          
          // Update ranks after insertion
          contextData.forEach((entry, idx) => {
            if (idx > insertAt && !entry.is_current_player) {
              entry.rank = start + idx + 1;
            }
          });
          
          // Keep only 11 entries (5 above, player, 5 below)
          if (contextData.length > 11) {
            contextData.splice(11);
          }
        }

        return NextResponse.json({ 
          leaderboard_context: contextData,
          player_rank: playerIndex + 1
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