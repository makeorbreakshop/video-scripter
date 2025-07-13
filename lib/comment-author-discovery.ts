// Comment Author Discovery Service (Method 5)
// Discovers channels through comment author mining on video content

import { supabase } from './supabase-client.ts';
import type { ChannelValidationResult } from './youtube-discovery-api.ts';
import { youtubeDiscoveryAPI } from './youtube-discovery-api.ts';

export interface CommentAuthorResult {
  sourceChannelId: string;
  sourceVideoId: string;
  discoveredChannels: ChannelValidationResult[];
  quotaUsed: number;
  errors: string[];
  commentsProcessed: number;
}

export class CommentAuthorDiscovery {
  
  /**
   * Discovers channels through comment authors on recent videos
   */
  async discoverCommentAuthors(
    sourceChannelIds: string[],
    maxVideosPerChannel: number = 5,
    maxCommentsPerVideo: number = 20,
    excludeExisting: boolean = true
  ): Promise<{
    results: CommentAuthorResult[];
    totalDiscovered: number;
    totalQuotaUsed: number;
  }> {
    console.log(`💬 Starting comment author discovery for ${sourceChannelIds.length} channels`);
    
    const results: CommentAuthorResult[] = [];
    let totalDiscovered = 0;
    let totalQuotaUsed = 0;

    try {
      // Get recent videos for each source channel
      for (const sourceChannelId of sourceChannelIds) {
        const result: CommentAuthorResult = {
          sourceChannelId,
          sourceVideoId: '',
          discoveredChannels: [],
          quotaUsed: 0,
          errors: [],
          commentsProcessed: 0
        };

        try {
          // Get recent videos from our database for this channel
          const { data: recentVideos, error } = await supabase
            .from('videos')
            .select('id, title, published_at')
            .eq('channel_id', sourceChannelId)
            .order('published_at', { ascending: false })
            .limit(maxVideosPerChannel);

          if (error) {
            result.errors.push(`Failed to fetch videos: ${error.message}`);
            results.push(result);
            continue;
          }

          if (!recentVideos || recentVideos.length === 0) {
            result.errors.push('No videos found for channel');
            results.push(result);
            continue;
          }

          console.log(`📺 Found ${recentVideos.length} recent videos for ${sourceChannelId}`);

          // Process comments for each video
          const allCommentAuthors: string[] = [];
          
          for (const video of recentVideos) {
            try {
              const commentAuthors = await this.getCommentAuthors(
                video.id, 
                maxCommentsPerVideo
              );
              
              result.quotaUsed += 1; // commentThreads.list costs 1 unit
              totalQuotaUsed += 1;
              result.commentsProcessed += commentAuthors.length;
              allCommentAuthors.push(...commentAuthors);
              
              console.log(`💭 Found ${commentAuthors.length} comment authors on video ${video.id}`);
              
              // Rate limiting between API calls
              await this.delay(100);
              
            } catch (error) {
              const errorMsg = `Error getting comments for video ${video.id}: ${(error as Error).message}`;
              result.errors.push(errorMsg);
              console.warn(errorMsg);
            }
          }

          // Remove duplicates and filter
          const uniqueAuthorIds = [...new Set(allCommentAuthors)];
          
          // Filter out existing channels if requested
          let channelsToValidate = uniqueAuthorIds;
          if (excludeExisting) {
            channelsToValidate = await this.filterExistingChannels(
              uniqueAuthorIds, 
              sourceChannelId
            );
          }

          if (channelsToValidate.length === 0) {
            console.log(`📭 No new comment authors to validate for ${sourceChannelId}`);
            results.push(result);
            continue;
          }

          console.log(`🔍 Validating ${channelsToValidate.length} comment authors from ${sourceChannelId}`);

          // Validate the comment author channels
          const validationResult = await youtubeDiscoveryAPI.validateChannels(channelsToValidate);
          result.quotaUsed += validationResult.quotaUsed;
          totalQuotaUsed += validationResult.quotaUsed;

          // Store valid channels
          if (validationResult.channels.length > 0) {
            result.discoveredChannels = validationResult.channels;
            
            // Store discoveries in database
            await this.storeDiscoveries(sourceChannelId, validationResult.channels);
            
            totalDiscovered += validationResult.channels.length;
            console.log(`✅ Discovered ${validationResult.channels.length} comment author channels from ${sourceChannelId}`);
          }

        } catch (error) {
          const errorMsg = `Error processing comments for ${sourceChannelId}: ${(error as Error).message}`;
          result.errors.push(errorMsg);
          console.error(errorMsg);
        }

        results.push(result);
      }

    } catch (error) {
      console.error('Comment author discovery error:', error);
      throw error;
    }

    console.log(`🎯 Comment author discovery completed: ${totalDiscovered} channels discovered, ${totalQuotaUsed} quota used`);

    return {
      results,
      totalDiscovered,
      totalQuotaUsed
    };
  }

  /**
   * Gets comment authors from a video
   */
  private async getCommentAuthors(
    videoId: string, 
    maxResults: number = 20
  ): Promise<string[]> {
    const apiKey = process.env.YOUTUBE_API_KEY;
    if (!apiKey) {
      throw new Error('YouTube API key not configured');
    }

    const url = new URL('https://www.googleapis.com/youtube/v3/commentThreads');
    url.searchParams.append('part', 'snippet');
    url.searchParams.append('videoId', videoId);
    url.searchParams.append('maxResults', Math.min(maxResults, 100).toString());
    url.searchParams.append('order', 'relevance'); // Get most relevant comments first
    url.searchParams.append('key', apiKey);

    const response = await fetch(url.toString(), {
      headers: {
        'Accept': 'application/json',
      },
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(`Comments API error: ${error.error?.message || response.statusText}`);
    }

    const data = await response.json();
    
    const authorChannelIds: string[] = data.items
      ?.map((item: any) => item.snippet.topLevelComment.snippet.authorChannelId?.value)
      .filter(Boolean) || [];

    return authorChannelIds;
  }

  /**
   * Filters out channels that already exist in our system
   */
  private async filterExistingChannels(
    channelIds: string[], 
    sourceChannelId: string
  ): Promise<string[]> {
    try {
      // Check against existing imported channels
      const { data: existingVideos } = await supabase
        .from('videos')
        .select('channel_id')
        .in('channel_id', channelIds);

      const existingChannelIds = new Set(existingVideos?.map(v => v.channel_id) || []);

      // Check against previously discovered channels
      const { data: existingDiscoveries } = await supabase
        .from('channel_discovery')
        .select('discovered_channel_id')
        .in('discovered_channel_id', channelIds);

      const discoveredChannelIds = new Set(existingDiscoveries?.map(d => d.discovered_channel_id) || []);

      // Filter out existing channels and apply quality filters
      const newChannelIds = channelIds.filter(id => 
        !existingChannelIds.has(id) && 
        !discoveredChannelIds.has(id) &&
        id !== sourceChannelId && // Don't discover the source channel itself
        id.length > 10 // Basic channel ID validation
      );

      console.log(`🔍 Filtered comment authors: ${channelIds.length} → ${newChannelIds.length} (removed ${channelIds.length - newChannelIds.length} existing)`);

      return newChannelIds;
    } catch (error) {
      console.error('Error filtering existing comment authors:', error);
      // If filtering fails, return all channels to be safe
      return channelIds;
    }
  }

  /**
   * Stores discovered comment author channels in the database
   */
  private async storeDiscoveries(
    sourceChannelId: string,
    channels: ChannelValidationResult[]
  ): Promise<void> {
    try {
      const discoveries = channels.map(channel => ({
        source_channel_id: sourceChannelId,
        discovered_channel_id: channel.channelId,
        discovery_method: 'comment',
        subscriber_count: channel.subscriberCount,
        video_count: channel.videoCount,
        validation_status: 'pending',
        import_status: 'pending',
        discovery_context: {
          discoveryMethod: 'comment_author_mining',
          extractedFromComments: true,
          sourceChannelId: sourceChannelId
        },
        channel_metadata: {
          title: channel.title,
          description: channel.description,
          thumbnailUrl: channel.thumbnailUrl,
          customUrl: channel.customUrl,
          publishedAt: channel.publishedAt,
          viewCount: channel.viewCount
        }
      }));

      const { error } = await supabase
        .from('channel_discovery')
        .upsert(discoveries, { 
          onConflict: 'source_channel_id,discovered_channel_id,discovery_method',
          ignoreDuplicates: false 
        });

      if (error) {
        throw new Error(`Database storage error: ${error.message}`);
      }

      console.log(`💾 Stored ${discoveries.length} comment author discoveries from ${sourceChannelId}`);
    } catch (error) {
      console.error('Error storing comment author discoveries:', error);
      throw error;
    }
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// Singleton instance
export const commentAuthorDiscovery = new CommentAuthorDiscovery();