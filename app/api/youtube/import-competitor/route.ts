/**
 * YouTube Competitor Import API Route
 * Imports competitor channel videos using public YouTube Data API only
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { createHash } from 'crypto';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

interface YouTubeChannelResponse {
  items: Array<{
    id: string;
    snippet: {
      title: string;
      description: string;
      customUrl?: string;
      thumbnails: {
        default: { url: string };
        medium: { url: string };
        high: { url: string };
      };
    };
    statistics: {
      viewCount: string;
      subscriberCount: string;
      videoCount: string;
    };
    contentDetails: {
      relatedPlaylists: {
        uploads: string;
      };
    };
  }>;
}

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
  nextPageToken?: string;
}

export async function POST(request: NextRequest) {
  try {
    const { channelId, channelName, timePeriod, maxVideos, userId } = await request.json();

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

    const apiKey = process.env.YOUTUBE_API_KEY;
    const maxResults = Math.min(parseInt(maxVideos) || 50, 200);
    const daysAgo = parseInt(timePeriod) || 90;
    const publishedAfter = new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000).toISOString();

    // Step 1: Get channel details (channelId is already provided from search)
    let channelInfo: any;

    try {
      console.log('Using provided channelId:', channelId);
      const channelResponse = await fetch(
        `https://www.googleapis.com/youtube/v3/channels?part=snippet,statistics,contentDetails&id=${channelId}&key=${apiKey}`
      );
      const channelData: YouTubeChannelResponse = await channelResponse.json();

      if (!channelData.items || channelData.items.length === 0) {
        throw new Error('Channel not found');
      }

      channelInfo = channelData.items[0];
      const uploadsPlaylistId = channelInfo.contentDetails.relatedPlaylists.uploads;

      // Step 2: Get videos from uploads playlist
      const videos: any[] = [];
      let nextPageToken: string | undefined;
      let totalProcessed = 0;

      do {
        const playlistResponse = await fetch(
          `https://www.googleapis.com/youtube/v3/playlistItems?part=snippet&playlistId=${uploadsPlaylistId}&maxResults=50${nextPageToken ? `&pageToken=${nextPageToken}` : ''}&key=${apiKey}`
        );
        const playlistData = await playlistResponse.json();

        if (playlistData.items) {
          // Filter videos by publish date
          const recentVideos = playlistData.items.filter((item: any) => {
            const publishedAt = new Date(item.snippet.publishedAt);
            const cutoffDate = new Date(publishedAfter);
            return publishedAt >= cutoffDate;
          });

          // Get detailed video information
          if (recentVideos.length > 0) {
            const videoIds = recentVideos.map((item: any) => item.snippet.resourceId.videoId).join(',');
            const videoResponse = await fetch(
              `https://www.googleapis.com/youtube/v3/videos?part=snippet,statistics,contentDetails&id=${videoIds}&key=${apiKey}`
            );
            const videoData: YouTubeVideoResponse = await videoResponse.json();

            if (videoData.items) {
              videos.push(...videoData.items);
            }
          }

          totalProcessed += playlistData.items.length;
          nextPageToken = playlistData.nextPageToken;
        } else {
          break;
        }
      } while (nextPageToken && videos.length < maxResults && totalProcessed < 500);

      // Limit to maxResults
      const limitedVideos = videos.slice(0, maxResults);

      // Step 3: Calculate channel baseline for performance ratios
      const channelViewCounts = limitedVideos.map(v => parseInt(v.statistics.viewCount) || 0);
      const channelAvgViews = channelViewCounts.length > 0 
        ? channelViewCounts.reduce((a, b) => a + b, 0) / channelViewCounts.length 
        : 0;

      // Step 4: Store videos in database
      const videosToInsert = limitedVideos.map(video => {
        const viewCount = parseInt(video.statistics.viewCount) || 0;
        const performanceRatio = channelAvgViews > 0 ? viewCount / channelAvgViews : 1;

        return {
          id: video.id,
          title: video.snippet.title,
          description: video.snippet.description,
          channel_id: video.snippet.channelTitle, // Store channel name like existing videos
          published_at: video.snippet.publishedAt,
          duration: video.contentDetails.duration,
          view_count: viewCount,
          like_count: parseInt(video.statistics.likeCount) || 0,
          comment_count: parseInt(video.statistics.commentCount) || 0,
          thumbnail_url: video.snippet.thumbnails.maxres?.url || 
                        video.snippet.thumbnails.high?.url || 
                        video.snippet.thumbnails.medium?.url,
          performance_ratio: performanceRatio,
          channel_avg_views: Math.round(channelAvgViews),
          data_source: 'competitor',
          is_competitor: true,
          imported_by: userId,
          import_date: new Date().toISOString(),
          user_id: userId,
          metadata: {
            tags: video.snippet.tags || [],
            categoryId: video.snippet.categoryId || '',
            competitor_import: true,
            youtube_channel_id: video.snippet.channelId, // Store actual YouTube channel ID here
            import_settings: {
              time_period: timePeriod,
              max_videos: maxVideos,
              actual_imported: limitedVideos.length
            },
            channel_stats: {
              subscriber_count: parseInt(channelInfo.statistics.subscriberCount) || 0,
              total_videos: parseInt(channelInfo.statistics.videoCount) || 0,
              total_views: parseInt(channelInfo.statistics.viewCount) || 0,
              channel_thumbnail: channelInfo.snippet.thumbnails.high?.url || 
                               channelInfo.snippet.thumbnails.medium?.url || 
                               channelInfo.snippet.thumbnails.default?.url
            }
          }
        };
      });

      // Insert videos (upsert to handle duplicates)
      const { data: insertedVideos, error: insertError } = await supabase
        .from('videos')
        .upsert(videosToInsert, { 
          onConflict: 'id',
          ignoreDuplicates: false 
        })
        .select('id, title, view_count, performance_ratio');

      if (insertError) {
        console.error('Error inserting videos:', insertError);
        throw insertError;
      }

      return NextResponse.json({
        success: true,
        channel: {
          id: channelId,
          name: channelInfo.snippet.title,
          handle: channelInfo.snippet.customUrl || `@${channelInfo.snippet.title.replace(/\s+/g, '')}`,
          subscriber_count: parseInt(channelInfo.statistics.subscriberCount) || 0,
          video_count: parseInt(channelInfo.statistics.videoCount) || 0,
          imported_videos: limitedVideos.length,
          channel_avg_views: Math.round(channelAvgViews)
        },
        imported_videos: insertedVideos?.length || 0,
        message: `Successfully imported ${limitedVideos.length} videos from ${channelInfo.snippet.title}`
      });

    } catch (apiError) {
      console.error('YouTube API error:', apiError);
      return NextResponse.json(
        { error: `Failed to fetch channel data: ${apiError.message}` },
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