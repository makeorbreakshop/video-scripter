import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import crypto from 'crypto';

function getSupabaseClient() {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error('Missing Supabase environment variables');
  }
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  );
}

// POST: Start a new game session
export async function POST(request: Request) {
  try {
    const { player_session_id } = await request.json();
    
    if (!player_session_id) {
      return NextResponse.json({ error: 'Missing player_session_id' }, { status: 400 });
    }

    const supabase = getSupabaseClient();
    const game_id = crypto.randomUUID();

    // Create new game record
    const { data: gameData, error: gameError } = await supabase
      .from('thumbnail_battle_games')
      .insert({
        game_id,
        player_session_id,
        final_score: 0,
        battles_played: 0,
        battles_won: 0,
        lives_remaining: 3, // Start with 3 lives
        started_at: new Date().toISOString()
      })
      .select()
      .single();

    if (gameError) {
      console.error('Failed to create game:', gameError);
      return NextResponse.json({ error: 'Failed to create game' }, { status: 500 });
    }

    console.log(`[GAME] Started new game ${game_id} for player ${player_session_id}`);

    return NextResponse.json({
      game_id,
      started_at: gameData.started_at,
      lives_remaining: 3
    });

  } catch (error) {
    console.error('Error creating game:', error);
    return NextResponse.json({ error: 'Failed to create game' }, { status: 500 });
  }
}

// PATCH: Update game progress (after each battle)
export async function PATCH(request: Request) {
  try {
    const { game_id, current_score, battles_played, battles_won, lives_remaining, is_game_over } = await request.json();
    
    if (!game_id) {
      return NextResponse.json({ error: 'Missing game_id' }, { status: 400 });
    }

    const supabase = getSupabaseClient();

    const updates: any = {
      battles_played,
      battles_won,
      lives_remaining
    };

    // If game is over, record final stats
    if (is_game_over) {
      updates.final_score = current_score;
      updates.ended_at = new Date().toISOString();
      
      // Calculate game duration
      const { data: gameData } = await supabase
        .from('thumbnail_battle_games')
        .select('started_at')
        .eq('game_id', game_id)
        .single();
      
      if (gameData?.started_at) {
        const started = new Date(gameData.started_at);
        const ended = new Date();
        updates.game_duration_ms = ended.getTime() - started.getTime();
      }
    }

    const { data: updatedGame, error: updateError } = await supabase
      .from('thumbnail_battle_games')
      .update(updates)
      .eq('game_id', game_id)
      .select()
      .single();

    if (updateError) {
      console.error('Failed to update game:', updateError);
      return NextResponse.json({ error: 'Failed to update game' }, { status: 500 });
    }

    console.log(`[GAME] Updated game ${game_id}: ${battles_played} battles, ${battles_won} wins, ${lives_remaining} lives`);

    return NextResponse.json({ success: true, game: updatedGame });

  } catch (error) {
    console.error('Error updating game:', error);
    return NextResponse.json({ error: 'Failed to update game' }, { status: 500 });
  }
}

// GET: Get game details
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const game_id = searchParams.get('game_id');
    
    if (!game_id) {
      return NextResponse.json({ error: 'Missing game_id parameter' }, { status: 400 });
    }

    const supabase = getSupabaseClient();

    const { data: gameData, error: gameError } = await supabase
      .from('thumbnail_battle_games')
      .select('*')
      .eq('game_id', game_id)
      .single();

    if (gameError || !gameData) {
      return NextResponse.json({ error: 'Game not found' }, { status: 404 });
    }

    return NextResponse.json({ game: gameData });

  } catch (error) {
    console.error('Error fetching game:', error);
    return NextResponse.json({ error: 'Failed to fetch game' }, { status: 500 });
  }
}