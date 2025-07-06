// Video Collaboration Mining Discovery Service (Method 6)
// Discovers channels through collaboration mentions in video titles and descriptions

import { supabase } from './supabase-client';
import { youtubeDiscoveryAPI, ChannelValidationResult } from './youtube-discovery-api';

export interface CollaborationMiningResult {
  sourceChannelId: string;
  discoveredChannels: ChannelValidationResult[];
  quotaUsed: number;
  errors: string[];
  videosProcessed: number;
  collaborationsFound: number;
  mentionsExtracted: number;
}

export class CollaborationMiningDiscovery {
  
  private collaborationKeywords = [
    'ft.', 'feat.', 'featuring', 'with', 'vs', 'versus', 
    'collaboration', 'collab', 'guest', 'interview with',
    'reaction with', 'challenge with', 'responds to',
    'talks to', 'meets', 'visits', 'hosted by'
  ];

  /**
   * Discovers channels through collaboration mining in video metadata
   */
  async discoverCollaborations(
    sourceChannelIds: string[],
    maxVideosPerChannel: number = 50,
    excludeExisting: boolean = true,
    searchUntilResults: boolean = false,
    maxChannelsToSearch: number = 100
  ): Promise<{
    results: CollaborationMiningResult[];
    totalDiscovered: number;
    totalQuotaUsed: number;
    channelsSearched: number;
    channelsWithCollaborations: number;
  }> {
    console.log(`🤝 Starting collaboration mining discovery for ${sourceChannelIds.length} channels`);
    if (searchUntilResults) {
      console.log(`🔍 Search mode: Will continue searching until results found (max ${maxChannelsToSearch} channels)`);
    }
    
    const results: CollaborationMiningResult[] = [];
    let totalDiscovered = 0;
    let totalQuotaUsed = 0;
    let channelsSearched = 0;
    let channelsWithCollaborations = 0;

    try {
      // If searchUntilResults is true, get all available channels to search through
      let channelsToProcess = sourceChannelIds;
      
      if (searchUntilResults) {
        // Get all channels from the database if we're searching until results
        const { data: allChannels } = await supabase
          .from('videos')
          .select('metadata')
          .eq('is_competitor', true)
          .not('metadata->youtube_channel_id', 'is', null)
          .limit(maxChannelsToSearch);
        
        const allChannelIds = [...new Set(
          allChannels
            ?.map(v => v.metadata?.youtube_channel_id)
            .filter(Boolean) || []
        )];
        console.log(`📊 Expanded search to ${allChannelIds.length} available YouTube channel IDs for comprehensive search`);
        channelsToProcess = allChannelIds;
      }

      // Process channels in batches when searching until results
      const batchSize = searchUntilResults ? 10 : channelsToProcess.length; // Smaller batches due to video processing complexity
      
      for (let batchStart = 0; batchStart < channelsToProcess.length; batchStart += batchSize) {
        const batch = channelsToProcess.slice(batchStart, batchStart + batchSize);
        channelsSearched += batch.length;
        
        // Stop if we've hit the maximum search limit
        if (searchUntilResults && channelsSearched > maxChannelsToSearch) {
          console.log(`🛑 Reached maximum search limit of ${maxChannelsToSearch} channels`);
          break;
        }
        
        console.log(`🔍 Processing batch ${Math.floor(batchStart / batchSize) + 1}: ${batch.length} channels (searched ${channelsSearched} total)`);

        // Process each source channel in this batch
        for (const sourceChannelId of batch) {
          const result: CollaborationMiningResult = {
            sourceChannelId,
            discoveredChannels: [],
            quotaUsed: 0,
            errors: [],
            videosProcessed: 0,
            collaborationsFound: 0,
            mentionsExtracted: 0
          };

          try {
            // Get recent videos for this channel to analyze for collaborations
            const videosData = await this.getChannelVideosForAnalysis(sourceChannelId, maxVideosPerChannel);
            result.quotaUsed += videosData.quotaUsed;
            totalQuotaUsed += videosData.quotaUsed;
            result.videosProcessed = videosData.videos.length;

            if (videosData.videos.length === 0) {
              console.log(`📭 No videos found for collaboration analysis: ${sourceChannelId}`);
              results.push(result);
              continue;
            }

            console.log(`🔍 Analyzing ${videosData.videos.length} videos for collaborations from ${sourceChannelId}`);

            // Extract channel mentions from video metadata
            const mentions = this.extractCollaborationMentions(videosData.videos);
            result.mentionsExtracted = mentions.length;
            result.collaborationsFound = mentions.filter(m => m.hasCollaborationKeyword).length;

            if (mentions.length === 0) {
              console.log(`📭 No collaboration mentions found in videos from ${sourceChannelId}`);
              results.push(result);
              continue;
            }

            console.log(`🤝 Found ${mentions.length} channel mentions (${result.collaborationsFound} with collaboration keywords) from ${sourceChannelId}`);

            // Resolve channel mentions to actual channel IDs
            const channelIds = await this.resolveChannelMentions(mentions);
            
            if (channelIds.length === 0) {
              console.log(`📭 No valid channel IDs resolved from mentions for ${sourceChannelId}`);
              results.push(result);
              continue;
            }

            // Filter out existing channels if requested
            let channelsToValidate = channelIds;
            if (excludeExisting) {
              channelsToValidate = await this.filterExistingChannels(channelIds, sourceChannelId);
            }

            if (channelsToValidate.length === 0) {
              console.log(`📭 No new collaboration channels to validate for ${sourceChannelId}`);
              results.push(result);
              continue;
            }

            // Validate the collaboration channels
            const validationResult = await youtubeDiscoveryAPI.validateChannels(channelsToValidate);
            result.quotaUsed += validationResult.quotaUsed;
            totalQuotaUsed += validationResult.quotaUsed;

            // Store valid channels
            if (validationResult.channels.length > 0) {
              result.discoveredChannels = validationResult.channels;
              
              // Store discoveries in database
              await this.storeDiscoveries(sourceChannelId, validationResult.channels, mentions);
              
              totalDiscovered += validationResult.channels.length;
              channelsWithCollaborations++;
              console.log(`✅ Discovered ${validationResult.channels.length} collaboration channels from ${sourceChannelId}`);
            }

          } catch (error) {
            const errorMsg = `Error processing collaborations for ${sourceChannelId}: ${(error as Error).message}`;
            result.errors.push(errorMsg);
            console.error(errorMsg);
          }

          results.push(result);
        }

        // If we're searching until results and found some, we can stop
        if (searchUntilResults && totalDiscovered > 0) {
          console.log(`🎯 Found ${totalDiscovered} results, stopping search`);
          break;
        }

        // If we're searching until results but haven't found any, continue with next batch
        if (searchUntilResults && totalDiscovered === 0) {
          console.log(`🔍 No results in this batch, continuing search...`);
        }
      }

    } catch (error) {
      console.error('Collaboration mining discovery error:', error);
      throw error;
    }

    console.log(`🎯 Collaboration mining discovery completed: ${totalDiscovered} channels discovered, ${totalQuotaUsed} quota used`);
    console.log(`📊 Search stats: ${channelsSearched} channels searched, ${channelsWithCollaborations} had collaborations`);

    return {
      results,
      totalDiscovered,
      totalQuotaUsed,
      channelsSearched,
      channelsWithCollaborations
    };
  }

  /**
   * Get recent videos from a channel for collaboration analysis
   */
  private async getChannelVideosForAnalysis(
    channelId: string, 
    maxVideos: number
  ): Promise<{ videos: any[], quotaUsed: number }> {
    try {
      // Get recent videos with detailed metadata including descriptions
      const videosResponse = await youtubeDiscoveryAPI.getChannelVideos(channelId, maxVideos);
      
      return {
        videos: videosResponse.videos || [],
        quotaUsed: videosResponse.quotaUsed || 0
      };
    } catch (error) {
      console.error(`Error getting videos for ${channelId}:`, error);
      return { videos: [], quotaUsed: 0 };
    }
  }

  /**
   * Extract channel mentions from video titles and descriptions
   */
  private extractCollaborationMentions(videos: any[]): Array<{
    channelMention: string;
    videoTitle: string;
    videoId: string;
    hasCollaborationKeyword: boolean;
    context: string;
  }> {
    const mentions: Array<{
      channelMention: string;
      videoTitle: string;
      videoId: string;
      hasCollaborationKeyword: boolean;
      context: string;
    }> = [];

    for (const video of videos) {
      const title = video.snippet?.title || '';
      const description = video.snippet?.description || '';
      const videoId = video.id || '';
      
      // Combine title and description for analysis
      const fullText = `${title} ${description}`.toLowerCase();
      
      // Check if this video has collaboration keywords
      const hasCollaborationKeyword = this.collaborationKeywords.some(keyword => 
        fullText.includes(keyword.toLowerCase())
      );

      // Extract potential channel mentions using various patterns
      const channelPatterns = [
        /@([a-zA-Z0-9_-]+)/g, // @mentions
        /(?:ft\.?|feat\.?|featuring|with|vs\.?|versus)\s+([a-zA-Z0-9\s_-]+?)(?:\s|$|,|\.|!|\?)/gi, // collaboration keywords
        /(?:channel|creator|youtuber):\s*([a-zA-Z0-9\s_-]+?)(?:\s|$|,|\.|!|\?)/gi, // explicit channel mentions
        /(?:check out|visit|subscribe to)\s+([a-zA-Z0-9\s_-]+?)(?:\s|$|,|\.|!|\?)/gi // recommendations
      ];

      for (const pattern of channelPatterns) {
        let match;
        while ((match = pattern.exec(fullText)) !== null) {
          const mention = match[1]?.trim();
          if (mention && mention.length > 2 && mention.length < 50) { // Basic validation
            mentions.push({
              channelMention: mention,
              videoTitle: title,
              videoId,
              hasCollaborationKeyword,
              context: match[0] // The full matched text for context
            });
          }
        }
      }
    }

    // Remove duplicates and prioritize those with collaboration keywords
    const uniqueMentions = Array.from(
      new Map(mentions.map(m => [m.channelMention.toLowerCase(), m])).values()
    ).sort((a, b) => {
      if (a.hasCollaborationKeyword && !b.hasCollaborationKeyword) return -1;
      if (!a.hasCollaborationKeyword && b.hasCollaborationKeyword) return 1;
      return 0;
    });

    return uniqueMentions;
  }

  /**
   * Resolve channel mentions to actual YouTube channel IDs
   */
  private async resolveChannelMentions(mentions: Array<{
    channelMention: string;
    hasCollaborationKeyword: boolean;
  }>): Promise<string[]> {
    const channelIds: string[] = [];
    
    // For now, we'll use a simple approach - try to search for channels by name
    // This could be enhanced with more sophisticated name resolution
    
    for (const mention of mentions.slice(0, 10)) { // Limit to avoid quota abuse
      try {
        // Clean up the mention - remove common words and normalize
        const cleanMention = mention.channelMention
          .replace(/\b(channel|creator|youtuber|official)\b/gi, '')
          .trim();
          
        if (cleanMention.length < 3) continue;
        
        // Try to search for this channel name
        const searchResult = await youtubeDiscoveryAPI.searchChannels(cleanMention, 3);
        
        if (searchResult.channels && searchResult.channels.length > 0) {
          // Take the first result as most likely match
          const firstMatch = searchResult.channels[0];
          if (firstMatch.channelId) {
            channelIds.push(firstMatch.channelId);
          }
        }
        
        // Small delay to avoid rate limiting
        await new Promise(resolve => setTimeout(resolve, 100));
        
      } catch (error) {
        console.error(`Error resolving channel mention "${mention.channelMention}":`, error);
      }
    }
    
    return [...new Set(channelIds)]; // Remove duplicates
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

      // Filter out existing channels
      const newChannelIds = channelIds.filter(id => 
        !existingChannelIds.has(id) && 
        !discoveredChannelIds.has(id) &&
        id !== sourceChannelId && // Don't discover the source channel itself
        id.length > 10 // Basic channel ID validation
      );

      console.log(`🔍 Filtered collaboration channels: ${channelIds.length} → ${newChannelIds.length} (removed ${channelIds.length - newChannelIds.length} existing)`);

      return newChannelIds;
    } catch (error) {
      console.error('Error filtering existing collaboration channels:', error);
      // If filtering fails, return all channels to be safe
      return channelIds;
    }
  }

  /**
   * Stores discovered collaboration channels in the database
   */
  private async storeDiscoveries(
    sourceChannelId: string,
    channels: ChannelValidationResult[],
    mentions: Array<{ channelMention: string; hasCollaborationKeyword: boolean; context: string; }>
  ): Promise<void> {
    try {
      const discoveries = channels.map(channel => {
        // Find the mention that led to this discovery
        const relatedMention = mentions.find(m => 
          m.channelMention.toLowerCase().includes(channel.title.toLowerCase()) ||
          channel.title.toLowerCase().includes(m.channelMention.toLowerCase())
        );

        return {
          source_channel_id: sourceChannelId,
          discovered_channel_id: channel.channelId,
          discovery_method: 'collaboration',
          subscriber_count: channel.subscriberCount,
          video_count: channel.videoCount,
          validation_status: 'pending',
          import_status: 'pending',
          discovery_context: {
            discoveryMethod: 'video_collaboration_mining',
            extractedFromVideoMetadata: true,
            sourceChannelId: sourceChannelId,
            collaborationMention: relatedMention?.channelMention,
            hasCollaborationKeyword: relatedMention?.hasCollaborationKeyword || false,
            mentionContext: relatedMention?.context
          },
          channel_metadata: {
            title: channel.title,
            description: channel.description,
            thumbnailUrl: channel.thumbnailUrl,
            customUrl: channel.customUrl,
            publishedAt: channel.publishedAt,
            viewCount: channel.viewCount
          }
        };
      });

      const { error } = await supabase
        .from('channel_discovery')
        .upsert(discoveries, { 
          onConflict: 'source_channel_id,discovered_channel_id,discovery_method',
          ignoreDuplicates: false 
        });

      if (error) {
        throw new Error(`Database storage error: ${error.message}`);
      }

      console.log(`💾 Stored ${discoveries.length} collaboration discoveries from ${sourceChannelId}`);
    } catch (error) {
      console.error('Error storing collaboration discoveries:', error);
      throw error;
    }
  }
}

// Singleton instance
export const collaborationMiningDiscovery = new CollaborationMiningDiscovery();