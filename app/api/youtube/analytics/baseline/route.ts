/**
 * YouTube Analytics Baseline Collection API
 * 
 * Collects lifetime cumulative analytics for all videos using Analytics API.
 * One-time collection from video publication date to present day.
 * Cost: ~329 quota units for complete historical baseline establishment.
 */

import { NextRequest, NextResponse } from 'next/server';
import { youtubeAnalyticsBaseline } from '@/lib/youtube-analytics-baseline';

// Global progress state for baseline collection
let globalProgress = {
  isRunning: false,
  totalVideos: 0,
  processedVideos: 0,
  successfulVideos: 0,
  failedVideos: 0,
  currentVideo: '',
  quotaUsed: 0,
  errors: [],
  estimatedTimeRemaining: '',
  startTime: 0,
  results: []
};

/**
 * POST /api/youtube/analytics/baseline
 * Start baseline collection for all videos
 */
export async function POST(request: NextRequest) {
  try {
    // Check if baseline collection is already running
    if (globalProgress.isRunning) {
      return NextResponse.json({
        success: false,
        error: 'Baseline collection already in progress',
        progress: globalProgress
      }, { status: 409 });
    }

    // Get access token from request
    const authHeader = request.headers.get('authorization');
    const accessToken = authHeader?.replace('Bearer ', '');
    
    if (!accessToken) {
      return NextResponse.json({
        success: false,
        error: 'No access token provided'
      }, { status: 401 });
    }

    // Parse request body for any options
    const body = await request.json().catch(() => ({}));
    const { videoIds, dryRun = false } = body;

    // Initialize progress tracking
    globalProgress = {
      isRunning: true,
      totalVideos: 0,
      processedVideos: 0,
      successfulVideos: 0,
      failedVideos: 0,
      currentVideo: '',
      quotaUsed: 0,
      errors: [],
      estimatedTimeRemaining: 'Calculating...',
      startTime: Date.now(),
      results: []
    };

    // Start baseline collection asynchronously
    collectBaselinesAsync(accessToken, videoIds, dryRun);

    return NextResponse.json({
      success: true,
      message: 'Baseline collection started',
      progress: globalProgress,
      estimatedQuota: videoIds?.length ? videoIds.length * 5 : 329 * 5,
      estimatedTime: '30-45 minutes for all videos'
    });

  } catch (error) {
    console.error('Baseline collection error:', error);
    globalProgress.isRunning = false;
    
    return NextResponse.json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error occurred'
    }, { status: 500 });
  }
}

/**
 * GET /api/youtube/analytics/baseline
 * Get current baseline collection progress
 */
export async function GET() {
  try {
    return NextResponse.json({
      success: true,
      progress: globalProgress,
      isComplete: !globalProgress.isRunning && globalProgress.processedVideos > 0
    });
  } catch (error) {
    console.error('Get baseline progress error:', error);
    return NextResponse.json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error occurred'
    }, { status: 500 });
  }
}

/**
 * DELETE /api/youtube/analytics/baseline
 * Stop baseline collection process
 */
export async function DELETE() {
  try {
    globalProgress.isRunning = false;
    globalProgress.estimatedTimeRemaining = 'Stopped by user';
    
    return NextResponse.json({
      success: true,
      message: 'Baseline collection stopped',
      progress: globalProgress
    });
  } catch (error) {
    console.error('Stop baseline collection error:', error);
    return NextResponse.json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error occurred'
    }, { status: 500 });
  }
}

/**
 * Collect baselines asynchronously with progress tracking
 */
async function collectBaselinesAsync(
  accessToken: string, 
  videoIds?: string[], 
  dryRun: boolean = false
) {
  try {
    console.log('🎯 Starting baseline collection...');
    console.log(`📊 Mode: ${dryRun ? 'DRY RUN' : 'PRODUCTION'}`);
    console.log(`🎬 Scope: ${videoIds?.length ? `${videoIds.length} specific videos` : 'All videos'}`);

    // Progress callback to update global state
    const onProgress = (progress: any) => {
      globalProgress = {
        ...globalProgress,
        ...progress,
        startTime: globalProgress.startTime // Preserve start time
      };
      
      // Log significant milestones
      if (progress.processedVideos % 10 === 0 || progress.processedVideos === 1) {
        console.log(`📈 Progress: ${progress.processedVideos}/${progress.totalVideos} videos (${progress.successfulVideos} successful, ${progress.failedVideos} failed)`);
      }
    };

    // Collect baseline analytics
    const results = await youtubeAnalyticsBaseline.collectAllBaselines(
      accessToken,
      onProgress,
      videoIds
    );

    globalProgress.results = results;

    if (!dryRun && results.length > 0) {
      console.log(`💾 Saving ${results.length} baseline records to database...`);
      await youtubeAnalyticsBaseline.saveBaselines(results);
      console.log('✅ Baseline data saved successfully');
    } else if (dryRun) {
      console.log(`🔍 DRY RUN: Would save ${results.length} baseline records`);
    }

    // Final progress update
    globalProgress.isRunning = false;
    globalProgress.estimatedTimeRemaining = 'Complete';
    
    const elapsed = Date.now() - globalProgress.startTime;
    const elapsedMinutes = Math.round(elapsed / 60000);
    
    console.log('🎉 Baseline collection complete!');
    console.log(`⏱️  Total time: ${elapsedMinutes} minutes`);
    console.log(`📊 Results: ${globalProgress.successfulVideos} successful, ${globalProgress.failedVideos} failed`);
    console.log(`🔋 Quota used: ~${globalProgress.quotaUsed} units`);

    if (globalProgress.errors.length > 0) {
      console.log(`⚠️  Errors: ${globalProgress.errors.length}`);
      globalProgress.errors.slice(0, 5).forEach(error => console.log(`   - ${error}`));
    }

  } catch (error) {
    console.error('❌ Baseline collection failed:', error);
    globalProgress.isRunning = false;
    globalProgress.errors.push(`Fatal error: ${error instanceof Error ? error.message : 'Unknown error'}`);
    globalProgress.estimatedTimeRemaining = 'Failed';
  }
}

/**
 * Get baseline analytics summary
 */
export async function PATCH() {
  try {
    // Get existing baselines for analysis
    const baselines = await youtubeAnalyticsBaseline.getExistingBaselines();
    
    if (baselines.length === 0) {
      return NextResponse.json({
        success: true,
        summary: {
          totalVideos: 0,
          totalViews: 0,
          totalWatchTime: 0,
          avgViewsPerVideo: 0,
          mostRecentBaseline: null
        }
      });
    }

    // Calculate summary statistics
    const totalViews = baselines.reduce((sum, b) => sum + (b.views || 0), 0);
    const totalWatchTime = baselines.reduce((sum, b) => sum + (b.estimated_minutes_watched || 0), 0);
    const avgViewsPerVideo = Math.round(totalViews / baselines.length);
    const mostRecentBaseline = baselines.sort((a, b) => 
      new Date(b.baseline_date).getTime() - new Date(a.baseline_date).getTime()
    )[0];

    return NextResponse.json({
      success: true,
      summary: {
        totalVideos: baselines.length,
        totalViews,
        totalWatchTime,
        avgViewsPerVideo,
        mostRecentBaseline: mostRecentBaseline?.baseline_date || null,
        topPerformers: baselines
          .sort((a, b) => (b.views || 0) - (a.views || 0))
          .slice(0, 5)
          .map(b => ({
            video_id: b.video_id,
            views: b.views,
            estimated_minutes_watched: b.estimated_minutes_watched
          }))
      }
    });

  } catch (error) {
    console.error('Get baseline summary error:', error);
    return NextResponse.json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error occurred'
    }, { status: 500 });
  }
}