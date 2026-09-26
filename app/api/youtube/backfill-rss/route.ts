/**
 * RSS Backfill API Route
 * Updates RSS imported videos with proper YouTube API data
 */

import { NextRequest, NextResponse } from 'next/server';
import { getSupabase } from '@/lib/supabase-lazy';
import { q } from '@/lib/admin/db';
import { VIDEO_TEXT_JOIN, videosTextPayload, writeVideoTextFields } from '@/lib/app/video-text';

// `metadata` lives in video_text; the rss_import flag is read through the side table, with the
// accessor's coalesce idiom, so this keeps working once videos.metadata is cleared.
const NEEDS_BACKFILL_WHERE = `
   where coalesce(vt.metadata, v.metadata)->>'rss_import' = 'true'
     and (v.view_count = 0 or v.duration = 'PT0S')`;

interface YouTubeVideoResponse {
  items: Array<{
    id: string;
    snippet: {
      title: string;
      description: string;
      publishedAt: string;
      thumbnails: {
        default: { url: string };
        medium: { url: string };
        high: { url: string };
        maxres?: { url: string };
      };
      channelId: string;
      channelTitle: string;
      tags?: string[];
      categoryId: string;
    };
    statistics: {
      viewCount: string;
      likeCount: string;
      commentCount: string;
    };
    contentDetails: {
      duration: string;
    };
  }>;
}

export async function POST(request: NextRequest) {
  const supabase = getSupabase();
  try {
    const { batchSize = 50 } = await request.json();

    if (!process.env.YOUTUBE_API_KEY) {
      return NextResponse.json(
        { error: 'YouTube API key not configured' },
        { status: 500 }
      );
    }

    const apiKey = process.env.YOUTUBE_API_KEY;

    // Get videos that need backfilling
    let videosNeedingUpdate: { id: string; title: string; channel_id: string }[] | null = null;
    let fetchError: unknown = null;
    try {
      videosNeedingUpdate = await q<{ id: string; title: string; channel_id: string }>(
        `select v.id, v.title, v.channel_id from videos v ${VIDEO_TEXT_JOIN} ${NEEDS_BACKFILL_WHERE} limit $1`,
        [batchSize],
      );
    } catch (e) {
      fetchError = e;
    }

    if (fetchError) {
      console.error('Error fetching videos for backfill:', fetchError);
      return NextResponse.json(
        { error: 'Failed to fetch videos for backfill' },
        { status: 500 }
      );
    }

    if (!videosNeedingUpdate || videosNeedingUpdate.length === 0) {
      return NextResponse.json({
        success: true,
        message: 'No videos need backfilling',
        processed: 0,
        updated: 0,
        failed: 0
      });
    }

    console.log(`🔄 Starting backfill for ${videosNeedingUpdate.length} videos`);

    let totalUpdated = 0;
    let totalFailed = 0;
    const errors: string[] = [];

    // Process in chunks of 50 (YouTube API limit)
    const chunkSize = 50;
    for (let i = 0; i < videosNeedingUpdate.length; i += chunkSize) {
      const chunk = videosNeedingUpdate.slice(i, i + chunkSize);
      const videoIds = chunk.map(v => v.id).join(',');

      try {
        // Get detailed video information from YouTube API
        const videoResponse = await fetch(
          `https://www.googleapis.com/youtube/v3/videos?part=snippet,statistics,contentDetails&id=${videoIds}&key=${apiKey}`
        );
        const videoData: YouTubeVideoResponse = await videoResponse.json();

        if (videoData.items) {
          // Update each video with YouTube API data
          for (const video of videoData.items) {
            try {
              const viewCount = parseInt(video.statistics.viewCount) || 0;
              const likeCount = parseInt(video.statistics.likeCount) || 0;
              const commentCount = parseInt(video.statistics.commentCount) || 0;

              const text = {
                description: video.snippet.description || '',
                metadata: {
                  ...chunk.find(v => v.id === video.id) ? {} : {},
                  rss_import: true,
                  backfilled: true,
                  backfill_date: new Date().toISOString(),
                  youtube_channel_id: video.snippet.channelId,
                  tags: video.snippet.tags || [],
                  categoryId: video.snippet.categoryId || '',
                  channel_title: video.snippet.channelTitle
                }
              };
              const { error: updateError } = await supabase
                .from('videos')
                .update({
                  title: video.snippet.title,
                  // description/metadata only while they are still stored on videos (CLEARED_COLUMNS)
                  ...videosTextPayload(text),
                  channel_id: video.snippet.channelTitle, // Use channel name for consistency
                  duration: video.contentDetails.duration,
                  view_count: viewCount,
                  like_count: likeCount,
                  comment_count: commentCount,
                  thumbnail_url: video.snippet.thumbnails.maxres?.url || 
                                video.snippet.thumbnails.high?.url || 
                                video.snippet.thumbnails.medium?.url,
                })
                .eq('id', video.id);

              if (updateError) {
                console.error(`Failed to update video ${video.id}:`, updateError);
                totalFailed++;
                errors.push(`${video.id}: ${updateError.message}`);
              } else {
                // The update overwrote both fields, so overwrite the side copy too.
                await writeVideoTextFields([{ videoId: video.id, ...text }], { onConflict: 'update' });
                totalUpdated++;
                console.log(`✅ Updated video: ${video.snippet.title}`);
              }
            } catch (videoError) {
              console.error(`Error processing video ${video.id}:`, videoError);
              totalFailed++;
              errors.push(`${video.id}: ${videoError instanceof Error ? videoError.message : 'Unknown error'}`);
            }
          }
        }

        // Add small delay to respect YouTube API rate limits
        if (i + chunkSize < videosNeedingUpdate.length) {
          await new Promise(resolve => setTimeout(resolve, 100));
        }

      } catch (chunkError) {
        console.error(`Error processing chunk starting at ${i}:`, chunkError);
        totalFailed += chunk.length;
        errors.push(`Chunk ${i}: ${chunkError instanceof Error ? chunkError.message : 'Unknown error'}`);
      }
    }

    console.log(`🏁 Backfill completed: ${totalUpdated} updated, ${totalFailed} failed`);

    return NextResponse.json({
      success: true,
      message: `Backfill completed: ${totalUpdated} videos updated, ${totalFailed} failed`,
      processed: videosNeedingUpdate.length,
      updated: totalUpdated,
      failed: totalFailed,
      errors: errors.slice(0, 10) // Limit error list
    });

  } catch (error) {
    console.error('Error in RSS backfill:', error);
    return NextResponse.json(
      { 
        error: 'Failed to backfill RSS videos',
        details: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  }
}

export async function GET(request: NextRequest) {
  try {
    // Get count of videos that need backfilling
    // A count, not every matching id shipped to the client just to take .length.
    let needsBackfill = 0;
    let error: unknown = null;
    try {
      const [row] = await q<{ n: number }>(
        `select count(*)::int as n from videos v ${VIDEO_TEXT_JOIN} ${NEEDS_BACKFILL_WHERE}`,
      );
      needsBackfill = row?.n ?? 0;
    } catch (e) {
      error = e;
    }

    if (error) {
      return NextResponse.json(
        { error: 'Failed to check backfill status' },
        { status: 500 }
      );
    }

    return NextResponse.json({
      videos_needing_backfill: needsBackfill,
      status: 'ready'
    });

  } catch (error) {
    console.error('Error checking backfill status:', error);
    return NextResponse.json(
      { error: 'Failed to check backfill status' },
      { status: 500 }
    );
  }
}