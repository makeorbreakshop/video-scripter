/**
 * YouTube Discovery Import Approved Channels API Route
 * Imports approved channels using the full competitor analysis workflow:
 * 1. Fetch channel videos via YouTube API
 * 2. Import videos to database
 * 3. Generate title embeddings 
 * 4. Add to RSS monitoring
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

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
    const { channelIds, userId, maxVideos = 50, timePeriod = 90, excludeShorts = true } = await request.json();

    if (!channelIds || !Array.isArray(channelIds) || channelIds.length === 0) {
      return NextResponse.json(
        { error: 'Channel IDs array is required' },
        { status: 400 }
      );
    }

    if (!userId) {
      return NextResponse.json(
        { error: 'User ID is required' },
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
    const daysAgo = isAllTime ? 0 : parseInt(timePeriod) || 90;
    const publishedAfter = isAllTime ? null : new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000).toISOString();

    const results = {
      success: true,
      channelsProcessed: 0,
      totalVideosImported: 0,
      channelsImported: [] as any[],
      errors: [] as string[],
      vectorizationTriggered: false,
      rssChannelsAdded: [] as string[]
    };

    // Process each approved channel
    for (const channelId of channelIds) {
      try {
        console.log(`🔄 Processing approved channel: ${channelId}`);

        // Step 1: Get channel details
        const channelResponse = await fetch(
          `https://www.googleapis.com/youtube/v3/channels?part=snippet,statistics,contentDetails&id=${channelId}&key=${apiKey}`
        );
        const channelData: YouTubeChannelResponse = await channelResponse.json();

        if (!channelData.items || channelData.items.length === 0) {
          throw new Error(`Channel not found: ${channelId}`);
        }

        const channelInfo = channelData.items[0];
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

        if (limitedVideos.length === 0) {
          console.log(`⚠️ No videos found for channel: ${channelInfo.snippet.title}`);
          results.errors.push(`No videos found for channel: ${channelInfo.snippet.title}`);
          continue;
        }

        // Step 3: Calculate channel baseline for performance ratios
        const channelViewCounts = limitedVideos.map(v => parseInt(v.statistics.viewCount) || 0);
        const channelAvgViews = channelViewCounts.length > 0 
          ? channelViewCounts.reduce((a, b) => a + b, 0) / channelViewCounts.length 
          : 0;

        // Step 4: Store videos in database (using same format as competitor import)
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
            imported_by: userId === 'discovery-system' ? null : userId,
            import_date: new Date().toISOString(),
            user_id: userId === 'discovery-system' ? '4d154389-9f5f-4a97-83ab-528e3adf6c0e' : userId,
            pinecone_embedded: false,
            metadata: {
              tags: video.snippet.tags || [],
              categoryId: video.snippet.categoryId || '',
              import_source: 'discovery_system',
              youtube_channel_id: video.snippet.channelId, // Store actual YouTube channel ID here
              channel_title: video.snippet.channelTitle, // Add channel_title for semantic search compatibility
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

        const importedCount = insertedVideos?.length || 0;
        console.log(`✅ Imported ${importedCount} videos from ${channelInfo.snippet.title}`);

        // Step 5: Mark discovery entries as imported
        const { error: discoveryUpdateError } = await supabase
          .from('channel_discovery')
          .update({ 
            validation_status: 'imported',
            updated_at: new Date().toISOString()
          })
          .eq('discovered_channel_id', channelId);

        if (discoveryUpdateError) {
          console.warn('Failed to update discovery status:', discoveryUpdateError);
          // Don't fail the whole process for this
        }

        results.channelsProcessed++;
        results.totalVideosImported += importedCount;
        results.channelsImported.push({
          channelId: channelId,
          channelTitle: channelInfo.snippet.title,
          subscriberCount: parseInt(channelInfo.statistics.subscriberCount) || 0,
          videosImported: importedCount,
          channelAvgViews: Math.round(channelAvgViews)
        });

        // Collect channel IDs for RSS monitoring
        results.rssChannelsAdded.push(channelId);

      } catch (error) {
        console.error(`Error processing channel ${channelId}:`, error);
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        results.errors.push(`Channel ${channelId}: ${errorMessage}`);
      }
    }

    // Step 6: Trigger vectorization for all imported videos (in background)
    if (results.totalVideosImported > 0) {
      try {
        // Get all video IDs that need vectorization
        const { data: allImportedVideos } = await supabase
          .from('videos')
          .select('id')
          .eq('data_source', 'competitor')
          .eq('pinecone_embedded', false)
          .contains('metadata', { import_source: 'discovery_system' });

        if (allImportedVideos && allImportedVideos.length > 0) {
          const videoIds = allImportedVideos.map(v => v.id);
          
          const vectorizeResponse = await fetch(`${request.nextUrl.origin}/api/embeddings/titles/batch`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              video_ids: videoIds,
              force_re_embed: false
            })
          });

          if (vectorizeResponse.ok) {
            results.vectorizationTriggered = true;
            console.log(`🔄 Triggered vectorization for ${videoIds.length} discovery imported videos`);
          } else {
            console.warn('Vectorization request failed:', await vectorizeResponse.text());
          }
        }
      } catch (vectorizationError) {
        console.warn('Vectorization failed for discovery import:', vectorizationError);
        results.errors.push('Vectorization failed but import succeeded');
      }
    }

    // Step 7: Add channels to RSS monitoring (they now have videos in the database)
    // The RSS system will automatically detect channels with YouTube Channel IDs in metadata
    console.log(`📡 Added ${results.rssChannelsAdded.length} channels to RSS monitoring via metadata`);

    return NextResponse.json({
      success: results.errors.length === 0, // Only success if no errors
      ...results,
      message: `Successfully imported ${results.totalVideosImported} videos from ${results.channelsProcessed} channels. ${results.vectorizationTriggered ? 'Vectorization triggered.' : ''} RSS monitoring enabled.`
    });

  } catch (error) {
    console.error('Error in discovery import:', error);
    return NextResponse.json(
      { error: 'Failed to import approved channels' },
      { status: 500 }
    );
  }
}

// GET endpoint to check import-eligible channels
export async function GET() {
  try {
    const { data: approvedChannels, error } = await supabase
      .from('channel_discovery')
      .select('discovered_channel_id, channel_metadata, subscriber_count, video_count, validation_status')
      .eq('validation_status', 'approved');

    if (error) {
      throw error;
    }

    const eligibleChannels = approvedChannels?.map(channel => ({
      channelId: channel.discovered_channel_id,
      channelTitle: channel.channel_metadata?.title || 'Unknown Channel',
      subscriberCount: channel.subscriber_count,
      videoCount: channel.video_count,
      readyForImport: true
    })) || [];

    return NextResponse.json({
      success: true,
      approvedChannels: eligibleChannels.length,
      channels: eligibleChannels
    });

  } catch (error) {
    console.error('Error fetching approved channels:', error);
    return NextResponse.json(
      { error: 'Failed to fetch approved channels' },
      { status: 500 }
    );
  }
}