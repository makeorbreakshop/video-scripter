/**
 * YouTube Reporting API Backfill Endpoint
 * 
 * Web-based historical data backfill that processes multiple days of 
 * YouTube Reporting API data systematically with progress tracking.
 */

import { NextRequest, NextResponse } from 'next/server';

interface BackfillState {
  isRunning: boolean;
  totalDays: number;
  processedDays: number;
  successfulDays: number;
  failedDays: number;
  currentDate: string;
  recordsProcessed: number;
  totalViews: number;
  totalWatchTime: number;
  quotaUsed: number;
  errors: string[];
  startTime: string;
  estimatedTimeRemaining: string;
  csvData?: { [date: string]: any };
}

// Global state for backfill progress (in production, use Redis or database)
export let backfillState: BackfillState = {
  isRunning: false,
  totalDays: 0,
  processedDays: 0,
  successfulDays: 0,
  failedDays: 0,
  currentDate: '',
  recordsProcessed: 0,
  totalViews: 0,
  totalWatchTime: 0,
  quotaUsed: 0,
  errors: [],
  startTime: '',
  estimatedTimeRemaining: '',
  csvData: {}
};

/**
 * Generate date range for backfill
 */
function generateDateRange(daysBack: number): string[] {
  const dates = [];
  const today = new Date();
  
  for (let i = 1; i <= daysBack; i++) {
    const date = new Date(today);
    date.setDate(date.getDate() - i);
    dates.push(date.toISOString().split('T')[0]);
  }
  
  return dates.reverse(); // Process oldest to newest
}

/**
 * Process a single date
 */
async function processDate(date: string, accessToken: string, refreshToken?: string, downloadCsv = false): Promise<{
  success: boolean;
  recordsProcessed: number;
  views: number;
  watchTime: number;
  quotaUsed: number;
  error?: string;
  csvData?: any;
}> {
  try {
    console.log(`📅 Processing backfill for date: ${date}`);
    
    const response = await fetch('http://localhost:3000/api/youtube/reporting/daily-import', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        accessToken,
        refreshToken,
        targetDate: date,
        downloadCsv
      })
    });
    
    if (!response.ok) {
      throw new Error(`Import failed for ${date}: ${response.status}`);
    }
    
    const result = await response.json();
    
    if (!result.success) {
      throw new Error(`Import failed for ${date}: ${result.message}`);
    }
    
    return {
      success: true,
      recordsProcessed: result.summary.recordsCreated + result.summary.recordsUpdated,
      views: result.summary.totalViews,
      watchTime: result.summary.totalWatchTime,
      quotaUsed: result.summary.quotaUsed,
      csvData: downloadCsv ? result.csvData : undefined
    };
    
  } catch (error) {
    console.error(`❌ Failed to process ${date}:`, error);
    return {
      success: false,
      recordsProcessed: 0,
      views: 0,
      watchTime: 0,
      quotaUsed: 0,
      error: error instanceof Error ? error.message : 'Unknown error'
    };
  }
}

/**
 * Run backfill process
 */
async function runBackfill(daysBack: number, accessToken: string, refreshToken?: string, downloadCsv = false) {
  try {
    console.log(`🚀 Starting web-based backfill for ${daysBack} days`);
    
    // Generate date range
    const dates = generateDateRange(daysBack);
    
    // Initialize state
    backfillState = {
      isRunning: true,
      totalDays: dates.length,
      processedDays: 0,
      successfulDays: 0,
      failedDays: 0,
      currentDate: '',
      recordsProcessed: 0,
      totalViews: 0,
      totalWatchTime: 0,
      quotaUsed: 0,
      errors: [],
      startTime: new Date().toISOString(),
      estimatedTimeRemaining: 'Calculating...',
      csvData: downloadCsv ? {} : undefined
    };
    
    // Process each date
    for (const date of dates) {
      if (!backfillState.isRunning) {
        console.log('🛑 Backfill stopped by user');
        break;
      }
      
      backfillState.currentDate = date;
      
      const result = await processDate(date, accessToken, refreshToken, downloadCsv);
      
      // Update state
      backfillState.processedDays++;
      
      if (result.success) {
        backfillState.successfulDays++;
        backfillState.recordsProcessed += result.recordsProcessed;
        backfillState.totalViews += result.views;
        backfillState.totalWatchTime += result.watchTime;
        
        // Store CSV data if requested
        if (result.csvData) {
          backfillState.csvData = backfillState.csvData || {};
          backfillState.csvData[date] = result.csvData;
        }
      } else {
        backfillState.failedDays++;
        if (result.error) {
          backfillState.errors.push(`${date}: ${result.error}`);
        }
      }
      
      backfillState.quotaUsed += result.quotaUsed;
      
      // Calculate estimated time remaining
      const elapsed = Date.now() - new Date(backfillState.startTime).getTime();
      const avgTimePerDay = elapsed / backfillState.processedDays;
      const remainingDays = backfillState.totalDays - backfillState.processedDays;
      const estimatedMs = remainingDays * avgTimePerDay;
      backfillState.estimatedTimeRemaining = estimatedMs > 0 ? 
        `${Math.ceil(estimatedMs / 60000)} minutes` : 'Complete';
      
      console.log(`✅ Processed ${date}: ${backfillState.processedDays}/${backfillState.totalDays} complete`);
      
      // Longer delay to prevent overwhelming the API and reduce rate limiting
      await new Promise(resolve => setTimeout(resolve, 5000));
    }
    
    backfillState.isRunning = false;
    backfillState.currentDate = '';
    backfillState.estimatedTimeRemaining = 'Complete';
    
    console.log(`🎉 Backfill complete: ${backfillState.successfulDays}/${backfillState.totalDays} days successful`);
    
  } catch (error) {
    console.error('💥 Critical backfill error:', error);
    backfillState.isRunning = false;
    backfillState.errors.push(`Critical error: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

/**
 * POST: Start backfill process
 */
export async function POST(request: NextRequest) {
  try {
    const { daysBack, accessToken, refreshToken, downloadCsv = false } = await request.json();
    
    if (!daysBack || daysBack < 1 || daysBack > 365) {
      return NextResponse.json({
        success: false,
        error: 'Invalid daysBack parameter. Must be between 1 and 365.'
      }, { status: 400 });
    }

    if (!accessToken) {
      return NextResponse.json({
        success: false,
        error: 'Access token is required.'
      }, { status: 400 });
    }
    
    if (backfillState.isRunning) {
      return NextResponse.json({
        success: false,
        error: 'Backfill is already running. Stop the current process first.'
      }, { status: 409 });
    }
    
    // Start backfill in background
    runBackfill(daysBack, accessToken, refreshToken, downloadCsv);
    
    return NextResponse.json({
      success: true,
      message: `Backfill started for ${daysBack} days`,
      daysBack
    });
    
  } catch (error) {
    console.error('❌ Backfill start error:', error);
    return NextResponse.json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 });
  }
}

/**
 * GET: Get current backfill status
 */
export async function GET() {
  return NextResponse.json({
    success: true,
    ...backfillState
  });
}