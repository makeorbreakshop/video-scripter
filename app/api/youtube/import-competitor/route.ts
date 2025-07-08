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

    const apiKey = process.env.YOUTUBE_API_KEY;
    const maxResults = maxVideos === 'all' ? 999999 : Math.min(parseInt(maxVideos) || 50, 500);
    const isAllTime = timePeriod === 'all';
    const daysAgo = isAllTime ? 0 : parseInt(timePeriod) || 3650; // Default to 10 years instead of 90 days
    const publishedAfter = isAllTime ? null : new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000).toISOString();

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
          // Filter videos by publish date (if not all-time)
          const recentVideos = publishedAfter ? playlistData.items.filter((item: any) => {
            const publishedAt = new Date(item.snippet.publishedAt);
            const cutoffDate = new Date(publishedAfter);
            return publishedAt >= cutoffDate;
          }) : playlistData.items;

          // Get detailed video information
          if (recentVideos.length > 0) {
            const videoIds = recentVideos.map((item: any) => item.snippet.resourceId.videoId).join(',');
            const videoResponse = await fetch(
              `https://www.googleapis.com/youtube/v3/videos?part=snippet,statistics,contentDetails&id=${videoIds}&key=${apiKey}`
            );
            const videoData: YouTubeVideoResponse = await videoResponse.json();

            if (videoData.items) {
              let filteredVideos = videoData.items;
              
              // Filter out shorts if requested
              if (excludeShorts) {
                filteredVideos = videoData.items.filter(video => {
                  const duration = video.contentDetails.duration;
                  // Parse ISO 8601 duration (PT1M30S = 1 minute 30 seconds)
                  const match = duration.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
                  if (!match) return true; // If we can't parse, assume it's not a short
                  
                  const hours = parseInt(match[1] || '0');
                  const minutes = parseInt(match[2] || '0');
                  const seconds = parseInt(match[3] || '0');
                  const totalSeconds = hours * 3600 + minutes * 60 + seconds;
                  
                  return totalSeconds >= 60; // Exclude videos under 60 seconds
                });
              }
              
              videos.push(...filteredVideos);
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
          channel_id: video.snippet.channelId, // Store actual YouTube channel ID
          channel_name: video.snippet.channelTitle, // Store channel name in new column
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
            channel_title: video.snippet.channelTitle, // Keep for backwards compatibility
            import_settings: {
              time_period: timePeriod,
              max_videos: maxVideos,
              exclude_shorts: excludeShorts,
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

      // Update channel_import_status table
      try {
        console.log('🔄 Updating channel_import_status for:', channelInfo.snippet.title);
        
        const supabaseAdmin = createClient(
          process.env.NEXT_PUBLIC_SUPABASE_URL!,
          process.env.SUPABASE_SERVICE_ROLE_KEY!,
          {
            auth: {
              autoRefreshToken: false,
              persistSession: false
            }
          }
        );

        // First check if the channel already exists
        const { data: existingStatus } = await supabaseAdmin
          .from('channel_import_status')
          .select('id')
          .eq('channel_id', channelId)
          .single();

        const now = new Date().toISOString();
        
        if (existingStatus) {
          // Update existing record
          const { data: statusResult, error: statusError } = await supabaseAdmin
            .from('channel_import_status')
            .update({
              channel_name: channelInfo.snippet.title,
              last_refresh_date: now,
              total_videos_found: limitedVideos.length,
              is_fully_imported: timePeriod === 'all' && maxVideos === 'all'
            })
            .eq('channel_id', channelId)
            .select();

          if (statusError) {
            console.error('❌ Error updating channel import status:', statusError);
            console.error('Full error details:', JSON.stringify(statusError, null, 2));
          } else {
            console.log('✅ Successfully updated channel_import_status:', statusResult);
          }
        } else {
          // Insert new record with generated UUID
          const statusData = {
            id: crypto.randomUUID(),
            channel_name: channelInfo.snippet.title,
            channel_id: channelId,
            first_import_date: now,
            last_refresh_date: now,
            total_videos_found: limitedVideos.length,
            is_fully_imported: timePeriod === 'all' && maxVideos === 'all'
          };
          
          console.log('📝 Status data to insert:', statusData);

          const { data: statusResult, error: statusError } = await supabaseAdmin
            .from('channel_import_status')
            .insert(statusData)
            .select();

          if (statusError) {
            console.error('❌ Error inserting channel import status:', statusError);
            console.error('Full error details:', JSON.stringify(statusError, null, 2));
          } else {
            console.log('✅ Successfully inserted channel_import_status:', statusResult);
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

      // Trigger vectorization for newly imported videos
      try {
        const videoIds = insertedVideos?.map(v => v.id) || [];
        if (videoIds.length > 0) {
          await fetch(`${request.nextUrl.origin}/api/embeddings/titles/batch`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              video_ids: videoIds,
              force_re_embed: false
            })
          });
          console.log(`🔄 Triggered vectorization for ${videoIds.length} competitor videos`);
        }
      } catch (vectorizationError) {
        console.warn('Vectorization failed for competitor import:', vectorizationError);
        // Don't fail the whole import if vectorization fails
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
      const errorMessage = apiError instanceof Error ? apiError.message : 'Unknown error';
      return NextResponse.json(
        { error: `Failed to fetch channel data: ${errorMessage}` },
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