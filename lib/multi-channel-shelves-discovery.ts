// Multi-Channel Shelves Discovery Service (Method 3)
// Discovers channels through channelSections with type="multipleChannels"

import { supabase } from './supabase-client';
import { youtubeDiscoveryAPI, ChannelValidationResult } from './youtube-discovery-api';

export interface MultiChannelShelvesResult {
  sourceChannelId: string;
  discoveredChannels: ChannelValidationResult[];
  quotaUsed: number;
  errors: string[];
  shelvesProcessed: number;
}

export class MultiChannelShelvesDiscovery {
  
  /**
   * Discovers channels through multi-channel shelves on source channels
   */
  async discoverMultiChannelShelves(
    sourceChannelIds: string[],
    excludeExisting: boolean = true,
    searchUntilResults: boolean = false,
    maxChannelsToSearch: number = 100
  ): Promise<{
    results: MultiChannelShelvesResult[];
    totalDiscovered: number;
    totalQuotaUsed: number;
    channelsSearched: number;
    channelsWithShelves: number;
  }> {
    console.log(`📚 Starting multi-channel shelves discovery for ${sourceChannelIds.length} channels`);
    if (searchUntilResults) {
      console.log(`🔍 Search mode: Will continue searching until results found (max ${maxChannelsToSearch} channels)`);
    }
    
    const results: MultiChannelShelvesResult[] = [];
    let totalDiscovered = 0;
    let totalQuotaUsed = 0;
    let channelsSearched = 0;
    let channelsWithShelves = 0;

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
      const batchSize = searchUntilResults ? 20 : channelsToProcess.length;
      
      for (let batchStart = 0; batchStart < channelsToProcess.length; batchStart += batchSize) {
        const batch = channelsToProcess.slice(batchStart, batchStart + batchSize);
        channelsSearched += batch.length;
        
        // Stop if we've hit the maximum search limit
        if (searchUntilResults && channelsSearched > maxChannelsToSearch) {
          console.log(`🛑 Reached maximum search limit of ${maxChannelsToSearch} channels`);
          break;
        }
        
        console.log(`🔍 Processing batch ${Math.floor(batchStart / batchSize) + 1}: ${batch.length} channels (searched ${channelsSearched} total)`);

        // Get multi-channel shelves for this batch
        const shelvesResponse = await youtubeDiscoveryAPI.getMultiChannelShelves(batch);
        totalQuotaUsed += shelvesResponse.quotaUsed;

        console.log(`📋 Found ${shelvesResponse.shelves.length} multi-channel shelves in this batch`);

        // Group shelves by source channel
        const shelvesBySource = new Map<string, string[]>();
        for (const shelf of shelvesResponse.shelves) {
          const existing = shelvesBySource.get(shelf.sourceChannelId) || [];
          existing.push(...shelf.shelfChannelIds);
          shelvesBySource.set(shelf.sourceChannelId, existing);
        }

        // Track channels that actually have shelves
        channelsWithShelves += shelvesBySource.size;

        // Process each source channel in this batch
        for (const sourceChannelId of batch) {
          const result: MultiChannelShelvesResult = {
            sourceChannelId,
            discoveredChannels: [],
            quotaUsed: 0,
            errors: [],
            shelvesProcessed: 0
          };

          try {
            const shelfChannelIds = shelvesBySource.get(sourceChannelId) || [];
            
            if (shelfChannelIds.length === 0) {
              console.log(`📭 No multi-channel shelves found for ${sourceChannelId}`);
              results.push(result);
              continue;
            }

            // Remove duplicates from shelves
            const uniqueShelfChannelIds = [...new Set(shelfChannelIds)];
            result.shelvesProcessed = uniqueShelfChannelIds.length;

            console.log(`🔍 Processing ${uniqueShelfChannelIds.length} channels from shelves of ${sourceChannelId}`);

            // Filter out existing channels if requested
            let channelsToValidate = uniqueShelfChannelIds;
            if (excludeExisting) {
              channelsToValidate = await this.filterExistingChannels(
                uniqueShelfChannelIds, 
                sourceChannelId
              );
            }

            if (channelsToValidate.length === 0) {
              console.log(`📭 No new shelf channels to validate for ${sourceChannelId}`);
              results.push(result);
              continue;
            }

            // Validate the shelf channels
            const validationResult = await youtubeDiscoveryAPI.validateChannels(channelsToValidate);
            result.quotaUsed += validationResult.quotaUsed;
            totalQuotaUsed += validationResult.quotaUsed;

            // Store valid channels
            if (validationResult.channels.length > 0) {
              result.discoveredChannels = validationResult.channels;
              
              // Store discoveries in database
              await this.storeDiscoveries(sourceChannelId, validationResult.channels);
              
              totalDiscovered += validationResult.channels.length;
              console.log(`✅ Discovered ${validationResult.channels.length} shelf channels from ${sourceChannelId}`);
            }

          } catch (error) {
            const errorMsg = `Error processing shelves for ${sourceChannelId}: ${(error as Error).message}`;
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
      console.error('Multi-channel shelves discovery error:', error);
      throw error;
    }

    console.log(`🎯 Multi-channel shelves discovery completed: ${totalDiscovered} channels discovered, ${totalQuotaUsed} quota used`);
    console.log(`📊 Search stats: ${channelsSearched} channels searched, ${channelsWithShelves} had multi-channel shelves`);

    return {
      results,
      totalDiscovered,
      totalQuotaUsed,
      channelsSearched,
      channelsWithShelves
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

      console.log(`🔍 Filtered shelf channels: ${channelIds.length} → ${newChannelIds.length} (removed ${channelIds.length - newChannelIds.length} existing)`);

      return newChannelIds;
    } catch (error) {
      console.error('Error filtering existing shelf channels:', error);
      // If filtering fails, return all channels to be safe
      return channelIds;
    }
  }

  /**
   * Stores discovered shelf channels in the database
   */
  private async storeDiscoveries(
    sourceChannelId: string,
    channels: ChannelValidationResult[]
  ): Promise<void> {
    try {
      const discoveries = channels.map(channel => ({
        source_channel_id: sourceChannelId,
        discovered_channel_id: channel.channelId,
        discovery_method: 'shelf',
        subscriber_count: channel.subscriberCount,
        video_count: channel.videoCount,
        validation_status: 'pending',
        import_status: 'pending',
        discovery_context: {
          discoveryMethod: 'multi_channel_shelves',
          extractedFromChannelSections: true,
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

      console.log(`💾 Stored ${discoveries.length} shelf channel discoveries from ${sourceChannelId}`);
    } catch (error) {
      console.error('Error storing shelf channel discoveries:', error);
      throw error;
    }
  }
}

// Singleton instance
export const multiChannelShelvesDiscovery = new MultiChannelShelvesDiscovery();