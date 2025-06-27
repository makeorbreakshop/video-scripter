import { NextRequest, NextResponse } from 'next/server';
import { youtubeAnalyticsDailyService, DailyImportProgress } from '@/lib/youtube-analytics-daily';

/**
 * POST /api/youtube/analytics/daily-import
 * Import YouTube Analytics data for a specific date
 * Replaces the YouTube Reporting API CSV-based approach
 */
export async function POST(request: NextRequest) {
  try {
    const { date, accessToken, refreshToken } = await request.json();

    // Validate required parameters
    if (!accessToken) {
      return NextResponse.json(
        { error: 'Access token is required' },
        { status: 400 }
      );
    }

    // Validate date parameter
    if (!date) {
      return NextResponse.json(
        { error: 'Date parameter is required (YYYY-MM-DD format)' },
        { status: 400 }
      );
    }

    // Validate date format
    const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
    if (!dateRegex.test(date)) {
      return NextResponse.json(
        { error: 'Invalid date format. Use YYYY-MM-DD format' },
        { status: 400 }
      );
    }

    // Validate date is not in the future
    const targetDate = new Date(date);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    if (targetDate > today) {
      return NextResponse.json(
        { error: 'Cannot import data for future dates' },
        { status: 400 }
      );
    }

    console.log(`🚀 Starting Analytics API daily import for ${date}`);

    // Store progress for streaming response (if needed)
    let latestProgress: DailyImportProgress | null = null;

    // Import analytics data
    const finalProgress = await youtubeAnalyticsDailyService.importDailyAnalytics(
      date,
      accessToken,
      (progress) => {
        latestProgress = progress;
        console.log(`📊 Progress: ${progress.processedVideos}/${progress.totalVideos} videos, ${progress.quotaUsed} quota used`);
      }
    );

    // Return success response with detailed progress
    return NextResponse.json({
      success: true,
      date,
      progress: finalProgress,
      summary: {
        totalVideos: finalProgress.totalVideos,
        successfulImports: finalProgress.successfulImports,
        failedImports: finalProgress.failedImports,
        quotaUsed: finalProgress.quotaUsed,
        errorCount: finalProgress.errors.length
      },
      message: `Successfully imported analytics data for ${date}`
    });

  } catch (error) {
    console.error('❌ Analytics daily import error:', error);
    
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error occurred',
        details: 'Failed to import daily analytics data'
      },
      { status: 500 }
    );
  }
}

/**
 * GET /api/youtube/analytics/daily-import
 * Get information about daily import capabilities and quota usage
 */
export async function GET(request: NextRequest) {
  try {
    // Note: GET requests for service info don't require authentication

    const { searchParams } = new URL(request.url);
    const startDate = searchParams.get('startDate');
    const endDate = searchParams.get('endDate');

    // If date range provided, calculate quota usage
    if (startDate && endDate) {
      const quotaInfo = await youtubeAnalyticsDailyService.validateQuotaUsage(startDate, endDate);
      
      return NextResponse.json({
        dateRange: {
          startDate,
          endDate,
          totalDays: quotaInfo.totalDays
        },
        quotaAnalysis: {
          totalVideos: quotaInfo.totalVideos,
          estimatedQuotaUsage: quotaInfo.estimatedQuotaUsage,
          dailyQuotaPercentage: quotaInfo.dailyQuotaPercentage,
          dailyQuotaLimit: 10000
        },
        recommendation: quotaInfo.dailyQuotaPercentage > 50 
          ? 'High quota usage - consider reducing batch size or date range'
          : 'Quota usage within acceptable limits'
      });
    }

    // Get video count for basic info
    const videoIds = await youtubeAnalyticsDailyService.getVideoIdsForAnalytics();
    
    return NextResponse.json({
      analyticsService: 'YouTube Analytics API (v2)',
      totalVideos: videoIds.length,
      quotaPerVideo: 1,
      dailyQuotaUsage: `${videoIds.length} units (${((videoIds.length / 10000) * 100).toFixed(2)}% of daily limit)`,
      dailyQuotaLimit: 10000,
      supportedMetrics: [
        'views',
        'impressions',
        'impressions_ctr_rate',
        'engaged_views',
        'estimated_minutes_watched',
        'average_view_duration',
        'average_view_percentage',
        'likes',
        'comments',
        'shares',
        'subscribers_gained',
        'estimated_revenue',
        'cpm'
      ],
      endpoints: {
        dailyImport: '/api/youtube/analytics/daily-import',
        historicalBackfill: '/api/youtube/analytics/historical-backfill'
      }
    });

  } catch (error) {
    console.error('❌ Analytics daily import info error:', error);
    
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : 'Unknown error occurred'
      },
      { status: 500 }
    );
  }
}