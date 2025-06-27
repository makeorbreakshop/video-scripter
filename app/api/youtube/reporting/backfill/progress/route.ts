/**
 * YouTube Reporting API Backfill Progress Endpoint
 * 
 * Returns current progress of the backfill operation.
 */

import { NextResponse } from 'next/server';

// Import the shared backfill state from the main backfill endpoint
import { backfillState } from '../route';

export async function GET() {
  return NextResponse.json({
    success: true,
    ...backfillState
  });
}