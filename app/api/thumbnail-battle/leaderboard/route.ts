import { NextResponse } from 'next/server';
import { getSupabase } from '@/lib/supabase-lazy';

export async function GET(request: Request) {
  const supabase = getSupabase();
  const { searchParams } = new URL(request.url);
  const type = searchParams.get('type') || 'best_score';
  const limit = parseInt(searchParams.get('limit') || '10');

  try {
    let query = supabase
      .from('thumbnail_battle_players')
      .select('player_name, best_score, total_battles, total_wins, created_at');

    // Different leaderboard types
    switch (type) {
      case 'best_score':
        query = query
          .order('best_score', { ascending: false })
          .limit(limit);
        break;
      
      case 'most_battles':
        query = query
          .order('total_battles', { ascending: false })
          .limit(limit);
        break;
      
      case 'today':
        // Players who played today, ordered by best streak
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        query = query
          .gte('last_played', today.toISOString())
          .order('best_score', { ascending: false })
          .limit(limit);
        break;
    }

    const { data, error } = await query;

    if (error) throw error;

    // Calculate accuracy for each player
    const leaderboard = data?.map(player => ({
      ...player,
      accuracy: player.total_battles > 0 
        ? Math.round((player.total_wins / player.total_battles) * 100)
        : 0
    }));

    return NextResponse.json({ leaderboard });
  } catch (error) {
    console.error('Error fetching leaderboard:', error);
    return NextResponse.json({ error: 'Failed to fetch leaderboard' }, { status: 500 });
  }
}