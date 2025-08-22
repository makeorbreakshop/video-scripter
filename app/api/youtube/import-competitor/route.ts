/**
 * YouTube Competitor Import API Route
 * Delegates to unified import service for actual processing
 */

import { NextRequest, NextResponse } from 'next/server';
import { getSupabase } from '@/lib/supabase-lazy';


export async function POST(request: NextRequest) {
  const supabase = getSupabase();
  try {
    const { channelId, channelName, timePeriod, maxVideos, excludeShorts, userId } = await request.json();

    if (!channelId || !userId) {
      return NextResponse.json(
        { error: 'Channel ID and user ID are required' },
        { status: 400 }
      );
    }

    if (!process.env.YOUTUBE_API_KEY) {
      return NextResponse.json(
        { error: 'YouTube API key not configured' },
        { status: 500 }
      );
    }

    console.log(`🎯 Starting competitor import for channel ${channelId}`);
    
    try {
      // Call unified video import endpoint
      const unifiedResponse = await fetch(`${request.nextUrl.origin}/api/video-import/unified`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          source: 'competitor',
          channelIds: [channelId],
          useQueue: true, // Use async worker queue for non-blocking processing
          options: {
            batchSize: 50,
            // Enable all processing for competitor imports
            skipEmbeddings: false,
            skipExports: true, // Skip exports to prevent duplicates
            // Pass competitor-specific options
            maxVideosPerChannel: maxVideos === 'all' ? undefined : parseInt(maxVideos),
            timePeriod: timePeriod,
            excludeShorts: excludeShorts,
            userId: userId
          }
        })
      });

      if (!unifiedResponse.ok) {
        const errorData = await unifiedResponse.text();
        throw new Error(`Unified import failed: ${unifiedResponse.status} - ${errorData}`);
      }

      const unifiedResults = await unifiedResponse.json();
      
      if (!unifiedResults.success) {
        throw new Error(`Unified import failed: ${unifiedResults.message}`);
      }

      // Check if it's a queued job
      if (unifiedResults.jobId && unifiedResults.status === 'queued') {
        console.log(`🔄 Import queued with job ID: ${unifiedResults.jobId}`);
        // Return the job info directly for async processing
        return NextResponse.json({
          success: true,
          jobId: unifiedResults.jobId,
          status: 'queued',
          message: unifiedResults.message,
          statusUrl: unifiedResults.statusUrl
        });
      }

      // Otherwise it was processed synchronously
      console.log(`✅ Import completed: ${unifiedResults.videosProcessed} videos processed`);
      if (unifiedResults.embeddingsGenerated) {
        console.log(`📊 Embeddings: ${unifiedResults.embeddingsGenerated.titles} titles, ${unifiedResults.embeddingsGenerated.thumbnails} thumbnails`);
      }
      
      // Get channel info for response
      const apiKey = process.env.YOUTUBE_API_KEY;
      const channelResponse = await fetch(
        `https://www.googleapis.com/youtube/v3/channels?part=snippet,statistics&id=${channelId}&key=${apiKey}`
      );
      const channelData = await channelResponse.json();
      
      if (!channelData.items || channelData.items.length === 0) {
        throw new Error('Channel not found');
      }

      const channelInfo = channelData.items[0];

      // Update channel_import_status table
      try {
        console.log('🔄 Updating channel_import_status for:', channelInfo.snippet.title);
        
        // First check if the channel already exists
        const { data: existingStatus } = await supabase
          .from('channel_import_status')
          .select('id')
          .eq('channel_id', channelId)
          .single();

        const now = new Date().toISOString();
        
        if (existingStatus) {
          // Update existing record
          const { error: statusError } = await supabase
            .from('channel_import_status')
            .update({
              channel_name: channelInfo.snippet.title,
              last_refresh_date: now,
              total_videos_found: unifiedResults.videosProcessed,
              is_fully_imported: timePeriod === 'all' && maxVideos === 'all'
            })
            .eq('channel_id', channelId);

          if (statusError) {
            console.error('❌ Error updating channel import status:', statusError);
          }
        } else {
          // Insert new record with generated UUID
          const { error: statusError } = await supabase
            .from('channel_import_status')
            .insert({
              id: crypto.randomUUID(),
              channel_name: channelInfo.snippet.title,
              channel_id: channelId,
              first_import_date: now,
              last_refresh_date: now,
              total_videos_found: unifiedResults.videosProcessed,
              is_fully_imported: timePeriod === 'all' && maxVideos === 'all'
            });

          if (statusError) {
            console.error('❌ Error inserting channel import status:', statusError);
          }
        }
      } catch (statusError) {
        console.error('❌ Exception updating channel import status:', statusError);
        // Don't fail the whole import if status update fails
      }

      // Refresh materialized view after import
      try {
        console.log('🔄 Refreshing competitor channel summary view...');
        await fetch(`${request.nextUrl.origin}/api/youtube/refresh-competitor-view`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          }
        });
        console.log('✅ Competitor channel summary refreshed');
      } catch (refreshError) {
        console.warn('⚠️ Failed to refresh competitor view:', refreshError);
        // Don't fail the import if view refresh fails
      }

      return NextResponse.json({
        success: true,
        channel: {
          id: channelId,
          name: channelInfo.snippet.title,
          handle: channelInfo.snippet.customUrl || `@${channelInfo.snippet.title.replace(/\s+/g, '')}`,
          subscriber_count: parseInt(channelInfo.statistics.subscriberCount) || 0,
          video_count: parseInt(channelInfo.statistics.videoCount) || 0,
          imported_videos: unifiedResults.videosProcessed
        },
        imported_videos: unifiedResults.videosProcessed,
        message: `Successfully imported ${unifiedResults.videosProcessed} videos from ${channelInfo.snippet.title}`,
        unified: {
          embeddingsGenerated: unifiedResults.embeddingsGenerated,
          exportFiles: unifiedResults.exportFiles,
          processingTime: unifiedResults.processingTime,
          method: 'unified-endpoint'
        }
      });

    } catch (apiError) {
      console.error('Import error:', apiError);
      const errorMessage = apiError instanceof Error ? apiError.message : 'Unknown error';
      return NextResponse.json(
        { error: `Failed to import channel: ${errorMessage}` },
        { status: 400 }
      );
    }

  } catch (error) {
    console.error('Error importing competitor channel:', error);
    return NextResponse.json(
      { error: 'Failed to import competitor channel' },
      { status: 500 }
    );
  }
}