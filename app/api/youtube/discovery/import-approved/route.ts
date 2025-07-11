import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { Database } from '@/types/database';

const supabase = createClient<Database>(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const YOUTUBE_API_KEY = process.env.YOUTUBE_API_KEY!;

// Helper function to convert various time periods to publishedAfter date
function getPublishedAfterDate(timePeriod: string): string | null {
  const now = new Date();
  
  switch (timePeriod) {
    case '24h':
      now.setDate(now.getDate() - 1);
      break;
    case '7d':
      now.setDate(now.getDate() - 7);
      break;
    case '30d':
      now.setDate(now.getDate() - 30);
      break;
    case '90d':
      now.setDate(now.getDate() - 90);
      break;
    case '1y':
      now.setFullYear(now.getFullYear() - 1);
      break;
    case 'all':
      return null;
    default:
      // Default to 30 days if unrecognized
      now.setDate(now.getDate() - 30);
  }
  
  return now.toISOString();
}

// Types for YouTube API response
interface YouTubeChannelResponse {
  items: Array<{
    id: string;
    snippet: {
      title: string;
      description: string;
      customUrl?: string;
      publishedAt: string;
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
  nextPageToken?: string;
}

async function processChannel(channelId: string, apiKey: string, maxResults: number, publishedAfter: string | null, excludeShorts: boolean, userId: string, results: any) {
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

        // Filter out shorts if requested
        const filteredVideos = excludeShorts ? recentVideos.filter((item: any) => {
          const title = item.snippet.title.toLowerCase();
          return !title.includes('#shorts') && !title.includes('#short');
        }) : recentVideos;

        videos.push(...filteredVideos);
        totalProcessed += filteredVideos.length;
        nextPageToken = playlistData.nextPageToken;
      }
    } while (nextPageToken && totalProcessed < maxResults);

    // Step 3: Process videos and save to database
    const processedVideos = [];
    for (const video of videos.slice(0, maxResults)) {
      try {
        const videoData = {
          video_id: video.snippet.resourceId.videoId,
          title: video.snippet.title,
          description: video.snippet.description,
          channel_id: channelId,
          channel_title: channelInfo.snippet.title,
          published_at: video.snippet.publishedAt,
          thumbnail_url: video.snippet.thumbnails?.maxres?.url || video.snippet.thumbnails?.high?.url,
          user_id: userId,
          source: 'approved_discovery',
          tags: video.snippet.tags || [],
          duration: null,
          view_count: null,
          like_count: null,
          comment_count: null,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        };

        const { data, error } = await supabase
          .from('videos')
          .upsert(videoData, { onConflict: 'video_id' })
          .select()
          .single();

        if (error) {
          console.error(`❌ Error saving video ${videoData.video_id}:`, error);
          results.errors.push({
            video_id: videoData.video_id,
            error: error.message
          });
        } else {
          processedVideos.push(data);
          results.videos.push(data);
        }
      } catch (error) {
        console.error(`❌ Error processing video:`, error);
        results.errors.push({
          video_id: video.snippet.resourceId.videoId,
          error: error instanceof Error ? error.message : 'Unknown error'
        });
      }
    }

    // Update channel discovery status
    await supabase
      .from('channel_discovery')
      .update({
        validation_status: 'imported',
        imported_videos: processedVideos.length,
        updated_at: new Date().toISOString()
      })
      .eq('discovered_channel_id', channelId);

    console.log(`✅ Successfully processed ${processedVideos.length} videos from channel ${channelId}`);
    results.channels.push({
      channelId,
      channelTitle: channelInfo.snippet.title,
      videosProcessed: processedVideos.length
    });

  } catch (error) {
    console.error(`❌ Error processing channel ${channelId}:`, error);
    results.errors.push({
      channelId,
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
}

export async function POST(request: NextRequest) {
  try {
    const { channelIds, userId, maxVideos = 'all', timePeriod = 'all', excludeShorts = true } = await request.json();

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

    // Get API key
    const apiKey = YOUTUBE_API_KEY;
    if (!apiKey) {
      throw new Error('YouTube API key not configured');
    }

    // Convert time period to publishedAfter date
    const publishedAfter = getPublishedAfterDate(timePeriod);

    // Determine max results per channel
    const maxResults = maxVideos === 'all' ? 1000 : parseInt(maxVideos);

    // Process channels in batches of 5 to avoid rate limiting
    const BATCH_SIZE = 5;
    const channelBatches = [];
    for (let i = 0; i < channelIds.length; i += BATCH_SIZE) {
      channelBatches.push(channelIds.slice(i, i + BATCH_SIZE));
    }

    const results = {
      success: true,
      channelsProcessed: 0,
      totalVideosImported: 0,
      channelsImported: [],
      errors: [],
      vectorizationTriggered: false,
      rssChannelsAdded: []
    };

    // First, try to use the unified import system
    try {
      const unifiedImportUrl = `${process.env.NEXT_PUBLIC_SUPABASE_URL?.replace('/rest/v1', '')}/api/video-import/unified`;
      
      for (const channelBatch of channelBatches) {
        const unifiedPayload = {
          source: 'discovery',
          channelIds: channelBatch,
          userId: userId,
          options: {
            batchSize: 50,
            skipEmbeddings: false,
            skipExports: false,
            timePeriod: timePeriod,
            maxVideos: maxVideos,
            excludeShorts: excludeShorts
          }
        };

        const unifiedResponse = await fetch(unifiedImportUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'User-Agent': 'video-scripter-discovery'
          },
          body: JSON.stringify(unifiedPayload)
        });

        const unifiedResult = await unifiedResponse.json();
        
        if (unifiedResult.success) {
          results.channelsProcessed += channelBatch.length;
          results.totalVideosImported += unifiedResult.videosProcessed || 0;
          results.vectorizationTriggered = unifiedResult.embeddingsGenerated?.titles > 0;
          results.rssChannelsAdded.push(...channelBatch);
          
          console.log(`✅ Unified system successfully processed batch of ${channelBatch.length} channels`);
          
          // Update channel discovery status for successfully imported channels
          await supabase
            .from('channel_discovery')
            .update({
              validation_status: 'imported',
              imported_videos: Math.floor(unifiedResult.videosProcessed / channelBatch.length),
              updated_at: new Date().toISOString()
            })
            .in('discovered_channel_id', channelBatch);
        } else {
          console.log('⚠️ Unified system failed for batch, falling back to original method');
          throw new Error('Unified system failed');
        }
      }
      
      // If we made it here, unified system worked for all batches
      if (results.totalVideosImported > 0) {
        return NextResponse.json({
          success: true,
          channelsProcessed: results.channelsProcessed,
          totalVideosImported: results.totalVideosImported,
          channelsImported: channelIds.map(id => ({ channelId: id, videosImported: Math.floor(results.totalVideosImported / channelIds.length) })),
          errors: results.errors || [],
          vectorizationTriggered: results.vectorizationTriggered,
          rssChannelsAdded: channelIds,
          unifiedSystemUsed: true
        });
      }
    } catch (error) {
      console.error('❌ Unified system error, falling back to original method:', error);
    }

    // Reset results for fallback method
    results.channels = [];
    results.videos = [];
    results.errors = [];

    // Fallback: Process each batch of channels in parallel using original method
    for (const batch of channelBatches) {
      const batchPromises = batch.map(channelId => processChannel(channelId, apiKey, maxResults, publishedAfter, excludeShorts, userId, results));
      await Promise.allSettled(batchPromises);
    }

    // Get approved channels to import
    const { data: approvedChannels, error } = await supabase
      .from('channel_discovery')
      .select('discovered_channel_id, channel_metadata, subscriber_count, video_count, validation_status')
      .eq('validation_status', 'approved');

    if (error) {
      throw error;
    }

    if (!approvedChannels || approvedChannels.length === 0) {
      return NextResponse.json({
        success: false,
        message: 'No approved channels found to import',
        totalChannels: 0,
        channelsImported: []
      });
    }

    const processedChannels = approvedChannels.map(channel => ({
      channelId: channel.discovered_channel_id,
      channelTitle: channel.channel_metadata?.title || 'Unknown Channel',
      subscriberCount: channel.subscriber_count,
      videoCount: channel.video_count
    }));

    if (processedChannels.length === 0) {
      return NextResponse.json({
        success: false,
        message: 'No channels selected for import',
        totalChannels: 0,
        channelsImported: []
      });
    }

    const approvedChannelIds = processedChannels.map(c => c.channelId);
    
    // Use the unified import system
    const unifiedImportUrl = `${process.env.NEXT_PUBLIC_SUPABASE_URL?.replace('/rest/v1', '')}/api/video-import/unified`;
    const unifiedPayload = {
      source: 'discovery',
      channelIds: approvedChannelIds,
      userId: userId,
      options: {
        batchSize: 50,
        skipEmbeddings: false,
        skipExports: false,
        timePeriod: timePeriod,
        maxVideos: maxVideos,
        excludeShorts: excludeShorts
      }
    };

    const unifiedResponse = await fetch(unifiedImportUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'video-scripter-discovery'
      },
      body: JSON.stringify(unifiedPayload)
    });

    const unifiedResult = await unifiedResponse.json();
    
    if (unifiedResult.success) {
      // Update channel discovery status for successfully imported channels
      const allImportedVideos = Object.values(unifiedResult.data.videosByChannel).flat();
      const totalVideosImported = allImportedVideos?.length || 0;
      const channelsImported = Object.keys(unifiedResult.data.videosByChannel || {});
      
      // Update all channels to imported status
      await supabase
        .from('channel_discovery')
        .update({
          validation_status: 'imported',
          imported_videos: totalVideosImported,
          updated_at: new Date().toISOString()
        })
        .in('discovered_channel_id', approvedChannelIds);

      console.log(`✅ Successfully imported ${totalVideosImported} videos from ${channelsImported.length} channels via unified system`);
      
      return NextResponse.json({
        success: results.errors.length === 0, // Only success if no errors
        channelsProcessed: results.channelsProcessed,
        totalVideosImported: results.totalVideosImported,
        channelsImported: results.channelsImported,
        errors: results.errors.length > 0 ? results.errors : undefined,
        vectorizationTriggered: results.vectorizationTriggered,
        rssChannelsAdded: results.rssChannelsAdded,
        unifiedSystemUsed: true
      });
    } else {
      return NextResponse.json({
        success: results.errors.length === 0, // Only success if no errors
        ...results,
        message: `Successfully imported ${results.totalVideosImported} videos from ${results.channelsProcessed} channels. ${results.vectorizationTriggered ? 'Vectorization triggered.' : ''} RSS monitoring enabled.`
      });
    }

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