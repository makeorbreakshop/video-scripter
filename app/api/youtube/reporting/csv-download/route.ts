/**
 * YouTube Reporting API CSV Download Endpoint
 * 
 * Downloads CSV data collected during backfill operations for debugging.
 */

import { NextResponse } from 'next/server';
import { backfillState } from '../backfill/route';

export async function GET() {
  try {
    if (!backfillState.csvData || Object.keys(backfillState.csvData).length === 0) {
      return NextResponse.json({
        success: false,
        error: 'No CSV data available. Run a backfill with downloadCsv=true first.'
      }, { status: 404 });
    }

    // Create a comprehensive CSV download
    const csvPackage = {
      metadata: {
        downloadedAt: new Date().toISOString(),
        totalDates: Object.keys(backfillState.csvData).length,
        dates: Object.keys(backfillState.csvData).sort()
      },
      csvData: backfillState.csvData
    };

    return NextResponse.json({
      success: true,
      message: 'CSV data package ready for download',
      data: csvPackage
    });

  } catch (error) {
    console.error('❌ CSV download error:', error);
    return NextResponse.json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 });
  }
}

export async function DELETE() {
  try {
    // Clear stored CSV data
    backfillState.csvData = {};
    
    return NextResponse.json({
      success: true,
      message: 'CSV data cleared'
    });

  } catch (error) {
    console.error('❌ CSV clear error:', error);
    return NextResponse.json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 });
  }
}