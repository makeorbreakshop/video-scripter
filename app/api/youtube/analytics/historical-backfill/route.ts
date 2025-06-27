import { NextRequest, NextResponse } from 'next/server';
import { youtubeAnalyticsDailyService, DailyImportProgress } from '@/lib/youtube-analytics-daily';
import { refreshAccessToken } from '@/lib/youtube-oauth';
import crypto from 'crypto';

/**
 * POST /api/youtube/analytics/historical-backfill
 * Import YouTube Analytics data for a date range
 * Flexible endpoint that can handle any date range (not limited to 50 days)
 */
export async function POST(request: NextRequest) {
  // Set a longer timeout for this endpoint
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 5 * 60 * 1000); // 5 minute timeout
  
  try {
    // Get access token from Authorization header (like baseline analytics)
    const authHeader = request.headers.get('authorization');
    const accessToken = authHeader?.replace('Bearer ', '');
    
    if (!accessToken) {
      return NextResponse.json(
        { error: 'No access token provided in Authorization header' },
        { status: 401 }
      );
    }
    
    const { startDate, endDate, refreshToken } = await request.json();

    // Create token refresh callback for long-running operations
    const refreshTokenCallback = refreshToken ? async (): Promise<string | null> => {
      console.log('🔄 Refreshing access token for continued backfill...');
      try {
        const newTokens = await refreshAccessToken(refreshToken);
        if (newTokens) {
          console.log('✅ Access token refreshed successfully');
          return newTokens.access_token;
        }
        console.error('❌ Failed to refresh access token');
        return null;
      } catch (error) {
        console.error('❌ Token refresh error:', error);
        return null;
      }
    } : undefined;

    // Validate required parameters
    if (!startDate || !endDate) {
      return NextResponse.json(
        { error: 'Both startDate and endDate parameters are required (YYYY-MM-DD format)' },
        { status: 400 }
      );
    }

    // Validate date format
    const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
    if (!dateRegex.test(startDate) || !dateRegex.test(endDate)) {
      return NextResponse.json(
        { error: 'Invalid date format. Use YYYY-MM-DD format for both dates' },
        { status: 400 }
      );
    }

    // Validate date range
    const start = new Date(startDate);
    const end = new Date(endDate);
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    if (start > end) {
      return NextResponse.json(
        { error: 'Start date must be before or equal to end date' },
        { status: 400 }
      );
    }

    if (end > today) {
      return NextResponse.json(
        { error: 'End date cannot be in the future' },
        { status: 400 }
      );
    }

    // Calculate backfill scope
    const totalDays = Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)) + 1;
    const quotaInfo = await youtubeAnalyticsDailyService.validateQuotaUsage(startDate, endDate);

    console.log(`🚀 Starting Analytics API historical backfill`);
    console.log(`📅 Date range: ${startDate} to ${endDate} (${totalDays} days)`);
    console.log(`📊 Videos: ${quotaInfo.totalVideos}`);
    console.log(`💰 Estimated quota: ${quotaInfo.estimatedQuotaUsage} units (${quotaInfo.dailyQuotaPercentage.toFixed(2)}% of daily limit)`);

    // Warn if quota usage is very high
    if (quotaInfo.dailyQuotaPercentage > 80) {
      console.warn(`⚠️ High quota usage detected: ${quotaInfo.dailyQuotaPercentage.toFixed(2)}%`);
    }

    // Generate unique operation ID for progress tracking
    const operationId = crypto.randomUUID();
    console.log(`🔍 Starting backfill operation: ${operationId}`);
    
    // Initialize progress tracking
    await fetch(`${request.nextUrl.origin}/api/youtube/analytics/progress`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        operationId,
        operation: `Analytics Backfill: ${startDate} to ${endDate}`,
        progress: {
          status: 'starting',
          dateRange: { startDate, endDate, totalDays },
          totalVideos: quotaInfo.totalVideos,
          estimatedQuota: quotaInfo.estimatedQuotaUsage
        },
        isActive: true
      })
    }).catch(err => console.warn('Progress tracking unavailable:', err));

    // Store progress for potential streaming response
    let latestProgress: DailyImportProgress | null = null;

    // Execute historical backfill with enhanced progress callback
    const finalProgress = await youtubeAnalyticsDailyService.backfillHistoricalData(
      startDate,
      endDate,
      accessToken,
      async (progress) => {
        latestProgress = progress;
        
        // Enhanced progress logging
        const completionPercent = ((progress.processedVideos / progress.totalVideos) * 100).toFixed(1);
        const queriesPerMin = progress.queriesPerMinute || 0;
        const rateLimitPercent = ((queriesPerMin / 720) * 100).toFixed(1);
        
        console.log(`📊 Backfill progress: ${completionPercent}% complete (${progress.successfulImports}/${progress.totalVideos} successful)`);
        console.log(`⚡ Rate limit: ${queriesPerMin}/720 queries/min (${rateLimitPercent}%), quota used: ${progress.quotaUsed}`);
        
        if (progress.estimatedTimeRemaining) {
          const eta = new Date(Date.now() + progress.estimatedTimeRemaining * 1000);
          console.log(`⏰ ETA: ${eta.toLocaleTimeString()} (${Math.round(progress.estimatedTimeRemaining / 60)} minutes remaining)`);
        }
        
        // Update progress tracking
        await fetch(`${request.nextUrl.origin}/api/youtube/analytics/progress`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            operationId,
            progress: {
              ...progress,
              completionPercent: parseFloat(completionPercent),
              rateLimitUtilization: parseFloat(rateLimitPercent),
              status: 'processing'
            },
            isActive: true
          })
        }).catch(err => console.warn('Progress update failed:', err));
      },
      refreshTokenCallback
    );
    
    // Mark operation as completed
    await fetch(`${request.nextUrl.origin}/api/youtube/analytics/progress`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        operationId,
        progress: {
          ...finalProgress,
          status: 'completed',
          completionPercent: 100
        },
        isActive: false
      })
    }).catch(err => console.warn('Progress completion failed:', err));

    // Return success response with comprehensive details
    // Clear the timeout
    clearTimeout(timeoutId);
    
    // Log first few errors for debugging
    if (finalProgress.errors.length > 0) {
      console.error('Sample errors from backfill:');
      finalProgress.errors.slice(0, 5).forEach(error => {
        console.error(`  - ${error}`);
      });
      if (finalProgress.errors.length > 5) {
        console.error(`  ... and ${finalProgress.errors.length - 5} more errors`);
      }
    }
    
    return NextResponse.json({
      success: true,
      operationId, // Include operation ID for progress tracking
      dateRange: {
        startDate,
        endDate,
        totalDays
      },
      progress: finalProgress,
      summary: {
        totalVideodays: finalProgress.totalVideos,
        successfulImports: finalProgress.successfulImports,
        failedImports: finalProgress.failedImports,
        quotaUsed: finalProgress.quotaUsed,
        quotaPercentage: ((finalProgress.quotaUsed / 100000) * 100).toFixed(2),
        errorCount: finalProgress.errors.length,
        successRate: finalProgress.totalVideos > 0 
          ? ((finalProgress.successfulImports / finalProgress.totalVideos) * 100).toFixed(2)
          : '0',
        rateLimitUtilization: finalProgress.rateLimitStatus ? 
          ((finalProgress.rateLimitStatus.queriesInCurrentWindow / finalProgress.rateLimitStatus.maxQueriesPerMinute) * 100).toFixed(2) + '%' : 'N/A'
      },
      message: `Successfully completed historical backfill for ${totalDays} days`,
      progressTrackingUrl: `/api/youtube/analytics/progress?id=${operationId}`
    });

  } catch (error) {
    console.error('❌ Analytics historical backfill error:', error);
    
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error occurred',
        details: 'Failed to complete historical backfill'
      },
      { status: 500 }
    );
  }
}

/**
 * GET /api/youtube/analytics/historical-backfill
 * Get quota estimation and backfill planning information
 */
export async function GET(request: NextRequest) {
  try {
    // Note: GET requests for quota estimation don't require authentication

    const { searchParams } = new URL(request.url);
    const startDate = searchParams.get('startDate');
    const endDate = searchParams.get('endDate');

    if (!startDate || !endDate) {
      return NextResponse.json(
        { error: 'Both startDate and endDate query parameters are required' },
        { status: 400 }
      );
    }

    // Calculate quota estimation
    const quotaInfo = await youtubeAnalyticsDailyService.validateQuotaUsage(startDate, endDate);
    
    // Calculate estimated time
    const estimatedMinutes = Math.ceil(quotaInfo.totalVideos * quotaInfo.totalDays * 0.5 / 60); // ~0.5 seconds per video
    
    return NextResponse.json({
      backfillPlan: {
        dateRange: {
          startDate,
          endDate,
          totalDays: quotaInfo.totalDays
        },
        scope: {
          totalVideos: quotaInfo.totalVideos,
          totalVideodays: quotaInfo.totalVideos * quotaInfo.totalDays
        },
        quotaAnalysis: {
          estimatedQuotaUsage: quotaInfo.estimatedQuotaUsage,
          dailyQuotaPercentage: quotaInfo.dailyQuotaPercentage,
          dailyQuotaLimit: 100000,
          canCompleteInOneDay: quotaInfo.dailyQuotaPercentage <= 100
        },
        timeEstimate: {
          estimatedMinutes,
          estimatedHours: Math.ceil(estimatedMinutes / 60)
        },
        recommendations: {
          ...(quotaInfo.dailyQuotaPercentage > 90 && {
            warning: 'Very high quota usage - consider splitting into multiple days'
          }),
          ...(quotaInfo.dailyQuotaPercentage > 50 && quotaInfo.dailyQuotaPercentage <= 90 && {
            caution: 'Moderate quota usage - monitor progress carefully'
          }),
          ...(quotaInfo.dailyQuotaPercentage <= 50 && {
            safe: 'Quota usage within safe limits'
          })
        }
      }
    });

  } catch (error) {
    console.error('❌ Analytics backfill planning error:', error);
    
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : 'Unknown error occurred'
      },
      { status: 500 }
    );
  }
}