import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

function getSupabaseClient() {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error('Missing Supabase environment variables');
  }
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  );
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { matchup_id, selection, clicked_at, session_id } = body;
    
    if (!matchup_id || !selection) {
      return NextResponse.json(
        { error: 'Missing matchup_id or selection' },
        { status: 400 }
      );
    }
    
    const supabase = getSupabaseClient();
    
    // Get the stored matchup from database
    const { data: matchup, error: fetchError } = await supabase
      .from('thumbnail_battle_matchups')
      .select('*')
      .eq('matchup_id', matchup_id)
      .single();
    
    if (fetchError || !matchup) {
      console.error('Matchup not found:', fetchError);
      return NextResponse.json(
        { error: 'Invalid or expired matchup' },
        { status: 404 }
      );
    }
    
    // Check if matchup has expired
    if (new Date(matchup.expires_at) < new Date()) {
      return NextResponse.json(
        { error: 'Matchup has expired' },
        { status: 404 }
      );
    }
    
    // Determine the winner based on scores
    const winner = matchup.video_a_score > matchup.video_b_score ? 'A' : 'B';
    
    // Check if answer is correct
    const correct = selection === winner;
    
    // Calculate points based on response time
    let points = 500; // Default points
    if (clicked_at) {
      // clicked_at is already the elapsed time in milliseconds from the client
      const elapsed = clicked_at;
      
      if (elapsed <= 500) {
        points = 1000;
      } else if (elapsed >= 10000) {
        points = 500;
      } else {
        const timeRange = 10000 - 500;
        const timeInRange = elapsed - 500;
        const percentThroughRange = timeInRange / timeRange;
        const pointsLost = 500 * percentThroughRange;
        points = Math.floor(1000 - pointsLost);
      }
    }
    
    // Only give points if correct
    if (!correct) {
      points = 0;
    }
    
    // Update the matchup record with player's answer for analytics
    if (session_id) {
      const { error: updateError } = await supabase
        .from('thumbnail_battle_matchups')
        .update({
          player_session_id: session_id,
          player_selection: selection,
          is_correct: correct,
          response_time_ms: clicked_at || null,
          answered_at: new Date().toISOString()
        })
        .eq('matchup_id', matchup_id);
      
      if (updateError) {
        console.error('Failed to update matchup with player answer:', updateError);
        // Continue anyway - this is just for analytics
      }
    }
    
    console.log(`[CHECK-ANSWER] Matchup ${matchup_id}: Selected ${selection}, Winner was ${winner}, Correct: ${correct}, Points: ${points}`);
    
    // Return the result with the scores now that they've made their choice
    return NextResponse.json({
      correct,
      points,
      winner,
      videoA_score: Number(matchup.video_a_score),
      videoB_score: Number(matchup.video_b_score)
    });
    
  } catch (error) {
    console.error('Error checking answer:', error);
    return NextResponse.json(
      { error: 'Failed to check answer' },
      { status: 500 }
    );
  }
}