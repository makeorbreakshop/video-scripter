// Playlist Creator Discovery Service (Method 4)
// Discovers channels through video creators featured in playlists

import { supabase } from './supabase-client.ts';
import type { ChannelValidationResult } from './youtube-discovery-api.ts';
import { youtubeDiscoveryAPI } from './youtube-discovery-api.ts';

export interface PlaylistCreatorResult {
  sourceChannelId: string;
  discoveredChannels: ChannelValidationResult[];
  quotaUsed: number;
  errors: string[];
  playlistsProcessed: number;
  creatorsFound: number;
}

export class PlaylistCreatorDiscovery {
  
  /**
   * Discovers channels through playlist creator analysis
   */
  async discoverPlaylistCreators(
    sourceChannelIds: string[],
    maxPlaylistsPerChannel: number = 5,
    excludeExisting: boolean = true,
    searchUntilResults: boolean = false,
    maxChannelsToSearch: number = 100
  ): Promise<{
    results: PlaylistCreatorResult[];
    totalDiscovered: number;
    totalQuotaUsed: number;
    channelsSearched: number;
    channelsWithPlaylists: number;
  }> {
    console.log(`🎵 Starting playlist creator discovery for ${sourceChannelIds.length} channels`);
    if (searchUntilResults) {
      console.log(`🔍 Search mode: Will continue searching until results found (max ${maxChannelsToSearch} channels)`);
    }
    
    const results: PlaylistCreatorResult[] = [];
    let totalDiscovered = 0;
    let totalQuotaUsed = 0;
    let channelsSearched = 0;
    let channelsWithPlaylists = 0;

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
      const batchSize = searchUntilResults ? 15 : channelsToProcess.length; // Smaller batches for playlists due to higher quota cost
      
      for (let batchStart = 0; batchStart < channelsToProcess.length; batchStart += batchSize) {
        const batch = channelsToProcess.slice(batchStart, batchStart + batchSize);
        channelsSearched += batch.length;
        
        // Stop if we've hit the maximum search limit
        if (searchUntilResults && channelsSearched > maxChannelsToSearch) {
          console.log(`🛑 Reached maximum search limit of ${maxChannelsToSearch} channels`);
          break;
        }
        
        console.log(`🔍 Processing batch ${Math.floor(batchStart / batchSize) + 1}: ${batch.length} channels (searched ${channelsSearched} total)`);

        // Get playlist creators for this batch
        const creatorsResponse = await youtubeDiscoveryAPI.getPlaylistCreators(
          batch, 
          maxPlaylistsPerChannel
        );
        totalQuotaUsed += creatorsResponse.quotaUsed;

        console.log(`📋 Found playlist creators from ${creatorsResponse.creators.length} channels in this batch`);

        // Track channels that actually have playlists with creators
        channelsWithPlaylists += creatorsResponse.creators.filter(c => c.creatorChannelIds.length > 0).length;

        // Process each source channel in this batch
        for (const sourceChannelId of batch) {
          const result: PlaylistCreatorResult = {
            sourceChannelId,
            discoveredChannels: [],
            quotaUsed: 0,
            errors: [],
            playlistsProcessed: 0,
            creatorsFound: 0
          };

          try {
            const creatorData = creatorsResponse.creators.find(c => c.sourceChannelId === sourceChannelId);
            
            if (!creatorData || creatorData.creatorChannelIds.length === 0) {
              console.log(`📭 No playlist creators found for ${sourceChannelId}`);
              results.push(result);
              continue;
            }

            result.creatorsFound = creatorData.creatorChannelIds.length;
            result.playlistsProcessed = maxPlaylistsPerChannel; // Estimate

            console.log(`🔍 Processing ${creatorData.creatorChannelIds.length} playlist creators from ${sourceChannelId}`);

            // Filter out existing channels if requested
            let channelsToValidate = creatorData.creatorChannelIds;
            if (excludeExisting) {
              channelsToValidate = await this.filterExistingChannels(
                creatorData.creatorChannelIds, 
                sourceChannelId
              );
            }

            if (channelsToValidate.length === 0) {
              console.log(`📭 No new playlist creators to validate for ${sourceChannelId}`);
              results.push(result);
              continue;
            }

            // Validate the playlist creator channels
            const validationResult = await youtubeDiscoveryAPI.validateChannels(channelsToValidate);
            result.quotaUsed += validationResult.quotaUsed;
            totalQuotaUsed += validationResult.quotaUsed;

            // Store valid channels
            if (validationResult.channels.length > 0) {
              result.discoveredChannels = validationResult.channels;
              
              // Store discoveries in database
              await this.storeDiscoveries(sourceChannelId, validationResult.channels);
              
              totalDiscovered += validationResult.channels.length;
              console.log(`✅ Discovered ${validationResult.channels.length} playlist creators from ${sourceChannelId}`);
            }

          } catch (error) {
            const errorMsg = `Error processing playlist creators for ${sourceChannelId}: ${(error as Error).message}`;
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
      console.error('Playlist creator discovery error:', error);
      throw error;
    }

    console.log(`🎯 Playlist creator discovery completed: ${totalDiscovered} channels discovered, ${totalQuotaUsed} quota used`);
    console.log(`📊 Search stats: ${channelsSearched} channels searched, ${channelsWithPlaylists} had playlists with creators`);

    return {
      results,
      totalDiscovered,
      totalQuotaUsed,
      channelsSearched,
      channelsWithPlaylists
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
        id !== sourceChannelId && // Don't discover the source channel itself
        id.length > 10 // Basic channel ID validation
      );

      console.log(`🔍 Filtered playlist creators: ${channelIds.length} → ${newChannelIds.length} (removed ${channelIds.length - newChannelIds.length} existing)`);

      return newChannelIds;
    } catch (error) {
      console.error('Error filtering existing playlist creators:', error);
      // If filtering fails, return all channels to be safe
      return channelIds;
    }
  }

  /**
   * Stores discovered playlist creator channels in the database
   */
  private async storeDiscoveries(
    sourceChannelId: string,
    channels: ChannelValidationResult[]
  ): Promise<void> {
    try {
      const discoveries = channels.map(channel => ({
        source_channel_id: sourceChannelId,
        discovered_channel_id: channel.channelId,
        discovery_method: 'playlist',
        subscriber_count: channel.subscriberCount,
        video_count: channel.videoCount,
        validation_status: 'pending',
        import_status: 'pending',
        discovery_context: {
          discoveryMethod: 'playlist_creator_analysis',
          extractedFromPlaylists: true,
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

      console.log(`💾 Stored ${discoveries.length} playlist creator discoveries from ${sourceChannelId}`);
    } catch (error) {
      console.error('Error storing playlist creator discoveries:', error);
      throw error;
    }
  }
}

// Singleton instance
export const playlistCreatorDiscovery = new PlaylistCreatorDiscovery();