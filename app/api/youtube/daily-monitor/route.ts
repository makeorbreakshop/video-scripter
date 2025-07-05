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

    // Step 2: Use the RSS import API to check all channels
    const importResponse = await fetch(`${request.nextUrl.origin}/api/youtube/import-rss`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        channelIds: channelIds,
        userId: userId
      })
    });

    if (!importResponse.ok) {
      throw new Error('Failed to import RSS videos');
    }

    const importResults = await importResponse.json();

    // Step 3: Trigger bulk vectorization for all newly imported videos
    if (importResults.newVideosImported > 0) {
      try {
        console.log(`🔄 Triggering bulk vectorization for ${importResults.newVideosImported} new videos`);
        
        // Get all videos imported today with RSS flag
        const { data: newVideos } = await supabase
          .from('videos')
          .select('id')
          .eq('data_source', 'competitor')
          .eq('import_date::date', new Date().toISOString().split('T')[0])
          .filter('metadata->>rss_import', 'eq', 'true')
          .eq('pinecone_embedded', false);

        if (newVideos && newVideos.length > 0) {
          const videoIds = newVideos.map(v => v.id);
          
          // Process in batches of 50 to avoid timeout
          const batchSize = 50;
          for (let i = 0; i < videoIds.length; i += batchSize) {
            const batch = videoIds.slice(i, i + batchSize);
            
            await fetch(`${request.nextUrl.origin}/api/embeddings/titles/batch`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                video_ids: batch,
                force_re_embed: false
              })
            });
            
            console.log(`🔄 Vectorized batch ${Math.floor(i/batchSize) + 1}/${Math.ceil(videoIds.length/batchSize)} (${batch.length} videos)`);
          }
          
          console.log(`✅ Completed vectorization for ${videoIds.length} RSS imported videos`);
        }
      } catch (vectorizationError) {
        console.warn('Bulk vectorization failed:', vectorizationError);
        // Don't fail the whole monitor if vectorization fails
      }
    }

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

    // Return enhanced results with monitoring summary
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