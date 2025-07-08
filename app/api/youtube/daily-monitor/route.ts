/**
 * YouTube Daily Monitor API Route
 * Checks all channels for new videos using RSS feeds and imports them
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

export async function POST(request: NextRequest) {
  try {
    const { userId } = await request.json();

    if (!userId) {
      return NextResponse.json(
        { error: 'User ID is required' },
        { status: 400 }
      );
    }

    console.log('🔍 Starting daily channel monitor for user:', userId);

    // Step 1: Get all unique YouTube channel IDs from the database
    const channelsResponse = await fetch(`${request.nextUrl.origin}/api/youtube/get-channels`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
      },
    });

    if (!channelsResponse.ok) {
      throw new Error('Failed to fetch channels');
    }

    const channelsData = await channelsResponse.json();
    const channelIds = channelsData.channels || [];

    if (channelIds.length === 0) {
      return NextResponse.json({
        success: true,
        message: 'No channels found to monitor',
        channelsProcessed: 0,
        totalVideosFound: 0,
        newVideosImported: 0,
        errors: [],
        channels: []
      });
    }

    console.log(`📺 Found ${channelIds.length} channels to monitor`);

    // Step 2: Use the unified video import API to check all channels
    // Convert channel IDs to RSS feed URLs for unified processing
    const rssFeedUrls = channelIds.map((channelId: string) => 
      `https://www.youtube.com/feeds/videos.xml?channel_id=${channelId}`
    );

    const importResponse = await fetch(`${request.nextUrl.origin}/api/video-import/unified`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        source: 'rss',
        rssFeedUrls: rssFeedUrls,
        options: {
          batchSize: 50,
          // Enable all processing including embeddings and exports
          skipEmbeddings: false,
          skipExports: false
        }
      })
    });

    if (!importResponse.ok) {
      throw new Error('Failed to import RSS videos via unified endpoint');
    }

    const unifiedResults = await importResponse.json();

    // Map unified results to legacy format for backward compatibility
    const importResults = {
      channelsProcessed: channelIds.length,
      totalVideosFound: unifiedResults.videosProcessed,
      newVideosImported: unifiedResults.videosProcessed,
      errors: unifiedResults.errors,
      channels: channelIds.map((channelId: string) => ({
        channelId,
        newVideosImported: Math.ceil(unifiedResults.videosProcessed / channelIds.length),
        status: unifiedResults.success ? 'success' : 'error'
      }))
    };

    // Step 3: Embeddings and exports are now handled by unified endpoint
    // Log the enhanced results
    console.log(`✅ Unified daily monitor completed: ${unifiedResults.videosProcessed} videos processed`);
    console.log(`📊 Embeddings generated: ${unifiedResults.embeddingsGenerated.titles} titles, ${unifiedResults.embeddingsGenerated.thumbnails} thumbnails`);
    console.log(`📁 Export files created: ${unifiedResults.exportFiles.length}`);

    // Include processing metrics in the summary
    const processingMetrics = {
      processingTime: unifiedResults.processingTime,
      embeddingsGenerated: unifiedResults.embeddingsGenerated,
      exportFiles: unifiedResults.exportFiles,
      processedVideoIds: unifiedResults.processedVideoIds
    };

    // Step 4: Log the monitoring activity
    const logData = {
      user_id: userId,
      channels_checked: importResults.channelsProcessed,
      videos_found: importResults.totalVideosFound,
      new_videos_imported: importResults.newVideosImported,
      error_count: importResults.errors.length,
      checked_at: new Date().toISOString(),
      status: importResults.errors.length === 0 ? 'success' : 'partial_success',
      details: {
        channels: importResults.channels,
        errors: importResults.errors
      }
    };

    // Optional: Store monitoring log in database (create table if needed)
    try {
      const { error: logError } = await supabase
        .from('rss_feed_log')
        .insert(logData);
      
      if (logError && logError.code !== '42P01') { // Ignore table doesn't exist error
        console.warn('Failed to log monitoring activity:', logError);
      }
    } catch (logError) {
      console.warn('Failed to log monitoring activity:', logError);
    }

    console.log(`✅ Daily monitor completed: ${importResults.newVideosImported} new videos imported from ${importResults.channelsProcessed} channels`);

    // Return enhanced results with monitoring summary and unified processing metrics
    return NextResponse.json({
      success: true,
      message: `Daily monitor completed: ${importResults.newVideosImported} new videos found across ${importResults.channelsProcessed} channels`,
      channelsProcessed: importResults.channelsProcessed,
      totalVideosFound: importResults.totalVideosFound,
      newVideosImported: importResults.newVideosImported,
      errors: importResults.errors,
      channels: importResults.channels,
      summary: {
        channels_with_new_videos: importResults.channels.filter((c: any) => c.newVideosImported > 0).length,
        channels_with_errors: importResults.errors.length,
        success_rate: importResults.channelsProcessed > 0 
          ? Math.round(((importResults.channelsProcessed - importResults.errors.length) / importResults.channelsProcessed) * 100)
          : 100
      },
      // Enhanced unified processing metrics
      unified: {
        processingTime: processingMetrics.processingTime,
        embeddingsGenerated: processingMetrics.embeddingsGenerated,
        exportFiles: processingMetrics.exportFiles,
        processedVideoIds: processingMetrics.processedVideoIds,
        method: 'unified-endpoint'
      }
    });

  } catch (error) {
    console.error('Error in daily monitor:', error);
    return NextResponse.json(
      { 
        error: 'Failed to run daily monitor',
        details: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  }
}