// API Route: Multi-Channel Shelves Discovery
// Discovers channels through channel sections (Method 3)

import { NextRequest, NextResponse } from 'next/server';
import { multiChannelShelvesDiscovery } from '@/lib/multi-channel-shelves-discovery';
import { youtubeDiscoveryAPI } from '@/lib/youtube-discovery-api';
import { getSupabaseClient } from '@/lib/supabase-client';

export async function POST(request: NextRequest) {
  const supabase = getSupabaseClient();
  try {
    const body = await request.json();
    const { 
      sourceChannelIds, 
      excludeExisting = true,
      dryRun = false,
      searchUntilResults = false,
      maxChannelsToSearch = 100
    } = body;

    // Validate input
    if (!sourceChannelIds || !Array.isArray(sourceChannelIds) || sourceChannelIds.length === 0) {
      return NextResponse.json(
        { error: 'sourceChannelIds array is required' },
        { status: 400 }
      );
    }

    // If "all" specified, get all imported channels
    let channelsToProcess = sourceChannelIds;
    
    if (sourceChannelIds.includes('all')) {
      console.log('🔍 Getting all imported channels for multi-channel shelves discovery');
      
      const { data: allChannels, error } = await supabase
        .from('videos')
        .select('channel_id')
        .eq('is_competitor', true)
        .not('channel_id', 'is', null);

      if (error) {
        throw new Error(`Failed to fetch channels: ${error.message}`);
      }

      const uniqueChannelIds = [...new Set(allChannels?.map(v => v.channel_id) || [])];
      channelsToProcess = uniqueChannelIds;
      
      console.log(`📊 Found ${uniqueChannelIds.length} unique competitor channels`);
    }

    if (channelsToProcess.length === 0) {
      return NextResponse.json(
        { error: 'No channels found to process' },
        { status: 400 }
      );
    }

    // Check current quota usage
    const quotaUsage = youtubeDiscoveryAPI.getQuotaUsage();
    // Estimate: 1 unit per channel for channel sections + validation quota
    const estimatedQuotaNeeded = channelsToProcess.length * 2;

    console.log(`📊 Current quota usage: ${quotaUsage.total} units`);
    console.log(`📊 Estimated quota needed: ${estimatedQuotaNeeded} units`);

    if (quotaUsage.total + estimatedQuotaNeeded > 9000) { // Leave 1000 units buffer
      return NextResponse.json(
        { 
          error: 'Insufficient quota remaining',
          currentUsage: quotaUsage.total,
          estimatedNeeded: estimatedQuotaNeeded,
          recommended: 'Wait for quota reset or reduce channel count'
        },
        { status: 429 }
      );
    }

    if (dryRun) {
      return NextResponse.json({
        message: 'Multi-channel shelves discovery dry run completed',
        channelsToProcess: channelsToProcess.length,
        estimatedQuotaUsage: estimatedQuotaNeeded,
        currentQuotaUsage: quotaUsage.total,
        searchUntilResults,
        maxChannelsToSearch,
        method: 'multi_channel_shelves'
      });
    }

    // Start the multi-channel shelves discovery
    console.log(`📚 Starting multi-channel shelves discovery for ${channelsToProcess.length} channels`);
    
    const startTime = new Date();
    const discoveryResult = await multiChannelShelvesDiscovery.discoverMultiChannelShelves(
      channelsToProcess,
      excludeExisting,
      searchUntilResults,
      maxChannelsToSearch
    );

    return NextResponse.json({
      message: 'Multi-channel shelves discovery completed successfully',
      method: 'multi_channel_shelves',
      channelsProcessed: channelsToProcess.length,
      channelsDiscovered: discoveryResult.totalDiscovered,
      quotaUsed: discoveryResult.totalQuotaUsed,
      processingTime: new Date().getTime() - startTime.getTime(),
      searchStats: {
        channelsSearched: discoveryResult.channelsSearched,
        channelsWithShelves: discoveryResult.channelsWithShelves,
        searchUntilResults,
        maxChannelsToSearch
      },
      results: discoveryResult.results.map(r => ({
        sourceChannelId: r.sourceChannelId,
        discoveredCount: r.discoveredChannels.length,
        shelvesProcessed: r.shelvesProcessed,
        quotaUsed: r.quotaUsed,
        errors: r.errors,
        discoveredChannels: r.discoveredChannels.map(c => ({
          channelId: c.channelId,
          title: c.title,
          subscriberCount: c.subscriberCount,
          videoCount: c.videoCount
        }))
      }))
    });

  } catch (error) {
    console.error('Multi-channel shelves discovery error:', error);
    return NextResponse.json(
      { 
        error: 'Failed to run multi-channel shelves discovery',
        message: (error as Error).message 
      },
      { status: 500 }
    );
  }
}

export async function GET(request: NextRequest) {
  const supabase = getSupabaseClient();
  try {
    // Get statistics for multi-channel shelves discoveries
    const { data: shelfDiscoveries, error } = await supabase
      .from('channel_discovery')
      .select('*')
      .eq('discovery_method', 'shelf')
      .order('discovery_date', { ascending: false });

    if (error) {
      throw new Error(`Failed to fetch shelf discoveries: ${error.message}`);
    }

    const stats = {
      totalDiscovered: shelfDiscoveries?.length || 0,
      pending: shelfDiscoveries?.filter(d => d.validation_status === 'pending').length || 0,
      approved: shelfDiscoveries?.filter(d => d.validation_status === 'approved').length || 0,
      rejected: shelfDiscoveries?.filter(d => d.validation_status === 'rejected').length || 0,
    };

    return NextResponse.json({
      message: 'Multi-channel shelves discovery statistics',
      method: 'multi_channel_shelves',
      statistics: stats,
      recentDiscoveries: shelfDiscoveries?.slice(0, 10).map(d => ({
        sourceChannelId: d.source_channel_id,
        discoveredChannelId: d.discovered_channel_id,
        channelTitle: d.channel_metadata?.title || 'Unknown',
        subscriberCount: d.subscriber_count,
        videoCount: d.video_count,
        validationStatus: d.validation_status,
        discoveryDate: d.discovery_date
      })) || []
    });

  } catch (error) {
    console.error('Error getting multi-channel shelves stats:', error);
    return NextResponse.json(
      { 
        error: 'Failed to get multi-channel shelves statistics',
        message: (error as Error).message 
      },
      { status: 500 }
    );
  }
}