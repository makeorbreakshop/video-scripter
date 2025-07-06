/**
 * YouTube RSS Import API Route
 * Imports new videos from RSS feeds for specified channels
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { fetchChannelRSSFeed, filterNewVideos } from '@/lib/rss-channel-monitor';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

export async function POST(request: NextRequest) {
  try {
    const { channelIds, userId } = await request.json();

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

    const results = {
      success: true,
      channelsProcessed: 0,
      totalVideosFound: 0,
      newVideosImported: 0,
      errors: [] as string[],
      channels: [] as any[]
    };

    // Process channels in batches to avoid overwhelming the system
    const BATCH_SIZE = 10;
    const batches = [];
    
    for (let i = 0; i < channelIds.length; i += BATCH_SIZE) {
      batches.push(channelIds.slice(i, i + BATCH_SIZE));
    }

    for (const batch of batches) {
      const batchPromises = batch.map(async (channelId: string) => {
        try {
          // Fetch RSS feed for this channel
          const rssResult = await fetchChannelRSSFeed(channelId);
          
          if (rssResult.error) {
            throw new Error(rssResult.error);
          }

          // Get existing videos for this channel to determine what's new
          // Use YouTube channel ID from metadata for accurate filtering
          const { data: existingVideos, error: fetchError } = await supabase
            .from('videos')
            .select('id, published_at, channel_id, metadata')
            .or(`channel_id.eq.${channelId},metadata->>youtube_channel_id.eq.${channelId}`)
            .order('published_at', { ascending: false });

          if (fetchError) {
            throw new Error(`Failed to fetch existing videos: ${fetchError.message}`);
          }

          // Filter to only new videos
          const newVideos = filterNewVideos(rssResult.videos, existingVideos || []);
          
          if (newVideos.length === 0) {
            return {
              channelId,
              channelTitle: rssResult.channelTitle,
              videosFound: rssResult.videos.length,
              newVideosImported: 0,
              success: true,
              message: 'No new videos found'
            };
          }

          // Get detailed video information from YouTube API for proper integration
          let videosToInsert = [];
          
          if (newVideos.length > 0) {
            const videoIds = newVideos.map(v => v.id).join(',');
            const apiKey = process.env.YOUTUBE_API_KEY;
            
            if (apiKey) {
              try {
                const videoResponse = await fetch(
                  `https://www.googleapis.com/youtube/v3/videos?part=snippet,statistics,contentDetails&id=${videoIds}&key=${apiKey}`
                );
                const videoData = await videoResponse.json();
                
                if (videoData.items) {
                  // Map YouTube API data to our database format
                  videosToInsert = videoData.items.map((video: any) => {
                    const viewCount = parseInt(video.statistics.viewCount) || 0;
                    
                    return {
                      id: video.id,
                      title: video.snippet.title,
                      description: video.snippet.description || '',
                      channel_id: video.snippet.channelId, // Use YouTube channel ID for consistency
                      published_at: video.snippet.publishedAt,
                      duration: video.contentDetails.duration,
                      view_count: viewCount,
                      like_count: parseInt(video.statistics.likeCount) || 0,
                      comment_count: parseInt(video.statistics.commentCount) || 0,
                      thumbnail_url: video.snippet.thumbnails.maxres?.url || 
                                    video.snippet.thumbnails.high?.url || 
                                    video.snippet.thumbnails.medium?.url,
                      performance_ratio: 1.0, // Will be calculated by packaging function
                      channel_avg_views: 0, // Will be calculated by packaging function
                      data_source: 'competitor',
                      is_competitor: true,
                      imported_by: userId,
                      import_date: new Date().toISOString(),
                      user_id: userId,
                      pinecone_embedded: false,
                      metadata: {
                        rss_import: true,
                        original_feed_url: rssResult.feedUrl,
                        channel_title: rssResult.channelTitle,
                        video_url: `https://www.youtube.com/watch?v=${video.id}`,
                        updated_at: new Date().toISOString(),
                        youtube_channel_id: video.snippet.channelId,
                        tags: video.snippet.tags || [],
                        categoryId: video.snippet.categoryId || ''
                      }
                    };
                  });
                }
              } catch (apiError) {
                console.warn('YouTube API failed for RSS videos, using RSS data only:', apiError);
                // Fallback to RSS-only data
                videosToInsert = newVideos.map(rssVideo => ({
                  id: rssVideo.id,
                  title: rssVideo.title,
                  description: rssVideo.description,
                  channel_id: rssVideo.channelId,
                  published_at: rssVideo.publishedAt,
                  duration: 'PT5M', // Default to 5 minutes for RSS-only imports
                  view_count: 1000, // Default placeholder view count
                  like_count: 0,
                  comment_count: 0,
                  thumbnail_url: rssVideo.thumbnailUrl,
                  performance_ratio: 1.0,
                  channel_avg_views: 0,
                  data_source: 'competitor',
                  is_competitor: true,
                  imported_by: userId,
                  import_date: new Date().toISOString(),
                  user_id: userId,
                  pinecone_embedded: false,
                  metadata: {
                    rss_import: true,
                    rss_only_fallback: true,
                    original_feed_url: rssResult.feedUrl,
                    channel_title: rssResult.channelTitle,
                    video_url: rssVideo.videoUrl,
                    updated_at: rssVideo.updatedAt
                  }
                }));
              }
            } else {
              // No API key available, use RSS data with defaults
              videosToInsert = newVideos.map(rssVideo => ({
                id: rssVideo.id,
                title: rssVideo.title,
                description: rssVideo.description,
                channel_id: rssVideo.channelId,
                published_at: rssVideo.publishedAt,
                duration: 'PT5M', // Default to 5 minutes
                view_count: 1000, // Default placeholder view count
                like_count: 0,
                comment_count: 0,
                thumbnail_url: rssVideo.thumbnailUrl,
                performance_ratio: 1.0,
                channel_avg_views: 0,
                data_source: 'competitor',
                is_competitor: true,
                imported_by: userId,
                import_date: new Date().toISOString(),
                user_id: userId,
                pinecone_embedded: false,
                metadata: {
                  rss_import: true,
                  no_api_key: true,
                  original_feed_url: rssResult.feedUrl,
                  channel_title: rssResult.channelTitle,
                  video_url: rssVideo.videoUrl,
                  updated_at: rssVideo.updatedAt
                }
              }));
            }
          }

          // Insert new videos
          const { data: insertedVideos, error: insertError } = await supabase
            .from('videos')
            .upsert(videosToInsert, { 
              onConflict: 'id',
              ignoreDuplicates: true 
            })
            .select('id, title');

          if (insertError) {
            throw new Error(`Failed to insert videos: ${insertError.message}`);
          }

          // Note: Vectorization will be handled in bulk by daily monitor API
          // to avoid timeouts and improve performance

          return {
            channelId,
            channelTitle: rssResult.channelTitle,
            videosFound: rssResult.videos.length,
            newVideosImported: insertedVideos?.length || 0,
            success: true,
            message: `Imported ${insertedVideos?.length || 0} new videos`
          };

        } catch (error) {
          console.error(`Error processing channel ${channelId}:`, error);
          return {
            channelId,
            channelTitle: 'Unknown',
            videosFound: 0,
            newVideosImported: 0,
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error'
          };
        }
      });

      const batchResults = await Promise.all(batchPromises);
      
      batchResults.forEach(result => {
        results.channelsProcessed++;
        results.totalVideosFound += result.videosFound;
        results.newVideosImported += result.newVideosImported;
        
        if (result.success) {
          results.channels.push(result);
        } else {
          results.errors.push(`${result.channelId}: ${result.error}`);
          results.channels.push(result);
        }
      });
    }

    return NextResponse.json(results);

  } catch (error) {
    console.error('Error in RSS import:', error);
    return NextResponse.json(
      { error: 'Failed to import RSS videos' },
      { status: 500 }
    );
  }
}