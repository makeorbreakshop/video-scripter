// Featured Channels Discovery Service
// Discovers channels through brandingSettings.featuredChannelsUrls

import { supabase } from './supabase-client';
import { youtubeDiscoveryAPI, ChannelValidationResult } from './youtube-discovery-api';

export interface FeaturedChannelsResult {
  sourceChannelId: string;
  discoveredChannels: ChannelValidationResult[];
  quotaUsed: number;
  errors: string[];
}

export class FeaturedChannelsDiscovery {
  
  /**
   * Discovers featured channels for given source channels
   */
  async discoverFeaturedChannels(
    sourceChannelIds: string[],
    excludeExisting: boolean = true
  ): Promise<{
    results: FeaturedChannelsResult[];
    totalDiscovered: number;
    totalQuotaUsed: number;
  }> {
    console.log(`🌟 Starting featured channels discovery for ${sourceChannelIds.length} channels`);
    
    const results: FeaturedChannelsResult[] = [];
    let totalDiscovered = 0;
    let totalQuotaUsed = 0;

    try {
      // Get featured channels for all source channels
      const featuredChannelsResponse = await youtubeDiscoveryAPI.getFeaturedChannels(sourceChannelIds);
      totalQuotaUsed += featuredChannelsResponse.quotaUsed;

      console.log(`📋 Found featured channels for ${featuredChannelsResponse.featuredChannels.length} channels`);

      // Process each source channel
      for (const featuredData of featuredChannelsResponse.featuredChannels) {
        const result: FeaturedChannelsResult = {
          sourceChannelId: featuredData.sourceChannelId,
          discoveredChannels: [],
          quotaUsed: 0,
          errors: []
        };

        try {
          console.log(`🔍 Processing ${featuredData.featuredChannelIds.length} featured channels from ${featuredData.sourceChannelId}`);

          // Filter out existing channels if requested
          let channelsToValidate = featuredData.featuredChannelIds;
          if (excludeExisting) {
            channelsToValidate = await this.filterExistingChannels(
              featuredData.featuredChannelIds, 
              featuredData.sourceChannelId
            );
          }

          if (channelsToValidate.length === 0) {
            console.log(`📭 No new featured channels to validate for ${featuredData.sourceChannelId}`);
            results.push(result);
            continue;
          }

          // Validate the featured channels
          const validationResult = await youtubeDiscoveryAPI.validateChannels(channelsToValidate);
          result.quotaUsed += validationResult.quotaUsed;
          totalQuotaUsed += validationResult.quotaUsed;

          // Store valid channels
          if (validationResult.channels.length > 0) {
            result.discoveredChannels = validationResult.channels;
            
            // Store discoveries in database
            await this.storeDiscoveries(featuredData.sourceChannelId, validationResult.channels);
            
            totalDiscovered += validationResult.channels.length;
            console.log(`✅ Discovered ${validationResult.channels.length} featured channels from ${featuredData.sourceChannelId}`);
          }

        } catch (error) {
          const errorMsg = `Error processing featured channels for ${featuredData.sourceChannelId}: ${(error as Error).message}`;
          result.errors.push(errorMsg);
          console.error(errorMsg);
        }

        results.push(result);
      }

    } catch (error) {
      console.error('Featured channels discovery error:', error);
      throw error;
    }

    console.log(`🎯 Featured channels discovery completed: ${totalDiscovered} channels discovered, ${totalQuotaUsed} quota used`);

    return {
      results,
      totalDiscovered,
      totalQuotaUsed
    };
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
        id !== sourceChannelId // Don't discover the source channel itself
      );

      console.log(`🔍 Filtered featured channels: ${channelIds.length} → ${newChannelIds.length} (removed ${channelIds.length - newChannelIds.length} existing)`);

      return newChannelIds;
    } catch (error) {
      console.error('Error filtering existing featured channels:', error);
      // If filtering fails, return all channels to be safe
      return channelIds;
    }
  }

  /**
   * Stores discovered featured channels in the database
   */
  private async storeDiscoveries(
    sourceChannelId: string,
    channels: ChannelValidationResult[]
  ): Promise<void> {
    try {
      const discoveries = channels.map(channel => ({
        source_channel_id: sourceChannelId,
        discovered_channel_id: channel.channelId,
        discovery_method: 'featured',
        subscriber_count: channel.subscriberCount,
        video_count: channel.videoCount,
        validation_status: 'pending',
        import_status: 'pending',
        discovery_context: {
          discoveryMethod: 'featured_channels',
          extractedFromBrandingSettings: true
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

      console.log(`💾 Stored ${discoveries.length} featured channel discoveries from ${sourceChannelId}`);
    } catch (error) {
      console.error('Error storing featured channel discoveries:', error);
      throw error;
    }
  }
}

// Singleton instance
export const featuredChannelsDiscovery = new FeaturedChannelsDiscovery();