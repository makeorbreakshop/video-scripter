/**
 * Fix Channel IDs API Route
 * Updates channel_id from YouTube channel ID to channel name for RSS imports
 */

import { NextRequest, NextResponse } from 'next/server';
import { getSupabase } from '@/lib/supabase-lazy';
import { q } from '@/lib/admin/db';
import { VIDEO_TEXT_JOIN } from '@/lib/app/video-text';

// `metadata` lives in video_text; read it through the side table with the accessor's coalesce
// idiom, so this keeps working once videos.metadata is cleared.
const NEEDS_FIX_WHERE = `
   where coalesce(vt.metadata, v.metadata)->>'rss_import' = 'true'
     and v.channel_id like 'UC%'`;


export async function POST(request: NextRequest) {
  const supabase = getSupabase();
  try {
    const { batchSize = 100 } = await request.json();

    // Get videos with YouTube channel IDs that need fixing
    let videosNeedingFix: { id: string; channel_id: string; metadata: any }[] | null = null;
    let fetchError: unknown = null;
    try {
      videosNeedingFix = await q<{ id: string; channel_id: string; metadata: any }>(
        `select v.id, v.channel_id, coalesce(vt.metadata, v.metadata) as metadata
           from videos v ${VIDEO_TEXT_JOIN} ${NEEDS_FIX_WHERE} limit $1`,
        [batchSize],
      );
    } catch (e) {
      fetchError = e;
    }

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
    // Get count of videos that need channel ID fixing — a count, not every id shipped to take .length.
    let needsFix = 0;
    let error: unknown = null;
    try {
      const [row] = await q<{ n: number }>(`select count(*)::int as n from videos v ${VIDEO_TEXT_JOIN} ${NEEDS_FIX_WHERE}`);
      needsFix = row?.n ?? 0;
    } catch (e) {
      error = e;
    }

    if (error) {
      return NextResponse.json(
        { error: 'Failed to check channel ID fix status' },
        { status: 500 }
      );
    }

    return NextResponse.json({
      videos_needing_channel_fix: needsFix,
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