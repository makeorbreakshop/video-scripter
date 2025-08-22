import { NextResponse } from 'next/server';
import { getMatchup } from '@/lib/thumbnail-battle-store';

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { matchup_id, selection, clicked_at } = body;
    
    if (!matchup_id || !selection) {
      return NextResponse.json(
        { error: 'Missing matchup_id or selection' },
        { status: 400 }
      );
    }
    
    // Get the stored matchup
    const matchup = getMatchup(matchup_id);
    
    if (!matchup) {
      return NextResponse.json(
        { error: 'Invalid or expired matchup' },
        { status: 404 }
      );
    }
    
    // Check if answer is correct
    const correct = selection === matchup.winner;
    
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
    
    console.log(`[CHECK-ANSWER] Matchup ${matchup_id}: Selected ${selection}, Winner was ${matchup.winner}, Correct: ${correct}, Points: ${points}`);
    
    // Return the result with the scores now that they've made their choice
    return NextResponse.json({
      correct,
      points,
      winner: matchup.winner,
      videoA_score: matchup.videoA_score,
      videoB_score: matchup.videoB_score
    });
    
  } catch (error) {
    console.error('Error checking answer:', error);
    return NextResponse.json(
      { error: 'Failed to check answer' },
      { status: 500 }
    );
  }
}