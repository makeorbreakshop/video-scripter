/**
 * RSS Backfill API Route
 * Updates RSS imported videos with proper YouTube API data
 */

import { NextRequest, NextResponse } from 'next/server';
import { getSupabase } from '@/lib/supabase-lazy';

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
    const { data: videosNeedingUpdate, error: fetchError } = await supabase
      .from('videos')
      .select('id, title, channel_id')
      .filter('metadata->>rss_import', 'eq', 'true')
      .or('view_count.eq.0,duration.eq.PT0S')
      .limit(batchSize);

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

              const { error: updateError } = await supabase
                .from('videos')
                .update({
                  title: video.snippet.title,
                  description: video.snippet.description || '',
                  channel_id: video.snippet.channelTitle, // Use channel name for consistency
                  duration: video.contentDetails.duration,
                  view_count: viewCount,
                  like_count: likeCount,
                  comment_count: commentCount,
                  thumbnail_url: video.snippet.thumbnails.maxres?.url || 
                                video.snippet.thumbnails.high?.url || 
                                video.snippet.thumbnails.medium?.url,
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
                })
                .eq('id', video.id);

              if (updateError) {
                console.error(`Failed to update video ${video.id}:`, updateError);
                totalFailed++;
                errors.push(`${video.id}: ${updateError.message}`);
              } else {
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
  const supabase = getSupabase();
  try {
    // Get count of videos that need backfilling
    const { data: needsBackfill, error } = await supabase
      .from('videos')
      .select('id', { count: 'exact' })
      .filter('metadata->>rss_import', 'eq', 'true')
      .or('view_count.eq.0,duration.eq.PT0S');

    if (error) {
      return NextResponse.json(
        { error: 'Failed to check backfill status' },
        { status: 500 }
      );
    }

    return NextResponse.json({
      videos_needing_backfill: needsBackfill?.length || 0,
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