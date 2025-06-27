/**
 * YouTube Analytics Refresh Progress API Route
 * Returns current progress of analytics refresh operation
 */

import { NextRequest, NextResponse } from 'next/server';

// This would be shared with the main refresh route in a production app
// For now, we'll implement a simple progress tracking
let refreshProgress = {
  isRunning: false,
  total: 0,
  processed: 0,
  currentVideo: '',
  errors: [] as string[],
};

export async function GET() {
  return NextResponse.json(refreshProgress);
}

// This function would be called by the refresh process to update progress
export function updateProgress(progress: typeof refreshProgress) {
  refreshProgress = { ...progress };
}