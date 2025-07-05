/**
 * Fix Channel IDs API Route
 * Updates channel_id from YouTube channel ID to channel name for RSS imports
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

export async function POST(request: NextRequest) {
  try {
    const { batchSize = 100 } = await request.json();

    // Get videos with YouTube channel IDs that need fixing
    const { data: videosNeedingFix, error: fetchError } = await supabase
      .from('videos')
      .select('id, channel_id, metadata')
      .filter('metadata->>rss_import', 'eq', 'true')
      .like('channel_id', 'UC%')
      .limit(batchSize);

    if (fetchError) {
      console.error('Error fetching videos for channel ID fix:', fetchError);
      return NextResponse.json(
        { error: 'Failed to fetch videos for channel ID fix' },
        { status: 500 }
      );
    }

    if (!videosNeedingFix || videosNeedingFix.length === 0) {
      return NextResponse.json({
        success: true,
        message: 'No videos need channel ID fixing',
        processed: 0,
        updated: 0,
        failed: 0
      });
    }

    console.log(`🔄 Fixing channel IDs for ${videosNeedingFix.length} videos`);

    let totalUpdated = 0;
    let totalFailed = 0;
    const errors: string[] = [];

    // Update each video with proper channel name
    for (const video of videosNeedingFix) {
      try {
        const channelTitle = video.metadata?.channel_title;
        
        if (channelTitle) {
          const { error: updateError } = await supabase
            .from('videos')
            .update({
              channel_id: channelTitle
            })
            .eq('id', video.id);

          if (updateError) {
            console.error(`Failed to update channel ID for video ${video.id}:`, updateError);
            totalFailed++;
            errors.push(`${video.id}: ${updateError.message}`);
          } else {
            totalUpdated++;
            console.log(`✅ Fixed channel ID: ${video.channel_id} → ${channelTitle}`);
          }
        } else {
          console.warn(`No channel_title in metadata for video ${video.id}`);
          totalFailed++;
          errors.push(`${video.id}: No channel_title in metadata`);
        }
      } catch (videoError) {
        console.error(`Error processing video ${video.id}:`, videoError);
        totalFailed++;
        errors.push(`${video.id}: ${videoError instanceof Error ? videoError.message : 'Unknown error'}`);
      }
    }

    console.log(`🏁 Channel ID fix completed: ${totalUpdated} updated, ${totalFailed} failed`);

    return NextResponse.json({
      success: true,
      message: `Channel ID fix completed: ${totalUpdated} videos updated, ${totalFailed} failed`,
      processed: videosNeedingFix.length,
      updated: totalUpdated,
      failed: totalFailed,
      errors: errors.slice(0, 10) // Limit error list
    });

  } catch (error) {
    console.error('Error in channel ID fix:', error);
    return NextResponse.json(
      { 
        error: 'Failed to fix channel IDs',
        details: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  }
}

export async function GET(request: NextRequest) {
  try {
    // Get count of videos that need channel ID fixing
    const { data: needsFix, error } = await supabase
      .from('videos')
      .select('id', { count: 'exact' })
      .filter('metadata->>rss_import', 'eq', 'true')
      .like('channel_id', 'UC%');

    if (error) {
      return NextResponse.json(
        { error: 'Failed to check channel ID fix status' },
        { status: 500 }
      );
    }

    return NextResponse.json({
      videos_needing_channel_fix: needsFix?.length || 0,
      status: 'ready'
    });

  } catch (error) {
    console.error('Error checking channel ID fix status:', error);
    return NextResponse.json(
      { error: 'Failed to check channel ID fix status' },
      { status: 500 }
    );
  }
}