import { NextResponse } from 'next/server';
import { getSupabase } from '@/lib/supabase-lazy';

// GET player by session_id
export async function GET(request: Request) {
  const supabase = getSupabase();
  const { searchParams } = new URL(request.url);
  const sessionId = searchParams.get('session_id');

  if (!sessionId) {
    return NextResponse.json({ error: 'Session ID required' }, { status: 400 });
  }

  try {
    const { data, error } = await supabase
      .from('thumbnail_battle_players')
      .select('*')
      .eq('session_id', sessionId)
      .single();

    if (error && error.code !== 'PGRST116') { // PGRST116 = no rows returned
      throw error;
    }

    return NextResponse.json({ player: data });
  } catch (error) {
    console.error('Error fetching player:', error);
    return NextResponse.json({ error: 'Failed to fetch player' }, { status: 500 });
  }
}

// POST create new player
export async function POST(request: Request) {
  const supabase = getSupabase();
  try {
    const body = await request.json();
    const { session_id, player_name } = body;

    if (!session_id || !player_name) {
      return NextResponse.json({ error: 'Session ID and name required' }, { status: 400 });
    }

    const { data, error } = await supabase
      .from('thumbnail_battle_players')
      .insert({
        session_id,
        player_name: player_name.substring(0, 30) // Limit name length
      })
      .select()
      .single();

    if (error) throw error;

    return NextResponse.json({ player: data });
  } catch (error) {
    console.error('Error creating player:', error);
    return NextResponse.json({ error: 'Failed to create player' }, { status: 500 });
  }
}

// PATCH update player stats
export async function PATCH(request: Request) {
  const supabase = getSupabase();
  try {
    const body = await request.json();
    const { session_id, updates } = body;

    if (!session_id) {
      return NextResponse.json({ error: 'Session ID required' }, { status: 400 });
    }

    // Check if we need to reset attempts_today
    const { data: currentPlayer } = await supabase
      .from('thumbnail_battle_players')
      .select('last_played, attempts_today')
      .eq('session_id', session_id)
      .single();

    let finalUpdates = { ...updates, last_played: new Date().toISOString() };

    if (currentPlayer) {
      const lastPlayed = new Date(currentPlayer.last_played);
      const today = new Date();
      
      // Reset attempts if it's a new day
      if (lastPlayed.toDateString() !== today.toDateString()) {
        finalUpdates.attempts_today = 1;
      }
    }

    const { data, error } = await supabase
      .from('thumbnail_battle_players')
      .update(finalUpdates)
      .eq('session_id', session_id)
      .select()
      .single();

    if (error) throw error;

    return NextResponse.json({ player: data });
  } catch (error) {
    console.error('Error updating player:', error);
    return NextResponse.json({ error: 'Failed to update player' }, { status: 500 });
  }
}