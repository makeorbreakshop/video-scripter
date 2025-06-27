/**
 * YouTube Reporting API Backfill Stop Endpoint
 * 
 * Stops the currently running backfill operation.
 */

import { NextResponse } from 'next/server';

export async function POST() {
  try {
    // Import the shared backfill state and stop the process
    const { backfillState } = await import('../route');
    
    if (backfillState.isRunning) {
      backfillState.isRunning = false;
      console.log('🛑 Backfill stop signal sent');
    }
    
    return NextResponse.json({
      success: true,
      message: 'Backfill stop signal sent'
    });
    
  } catch (error) {
    console.error('❌ Stop backfill error:', error);
    return NextResponse.json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 });
  }
}