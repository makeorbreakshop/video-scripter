// API Route: Playlist Creator Discovery
// Discovers channels through playlist creator analysis (Method 4)

import { NextRequest, NextResponse } from 'next/server';
import { playlistCreatorDiscovery } from '@/lib/playlist-creator-discovery';
import { youtubeDiscoveryAPI } from '@/lib/youtube-discovery-api';
import { supabase } from '@/lib/supabase-client';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { 
      sourceChannelIds, 
      maxPlaylistsPerChannel = 5,
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
      console.log('🔍 Getting all imported channels for playlist creator discovery');
      
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
    // Estimate: (1 + maxPlaylistsPerChannel) units per channel for playlists + playlistItems + validation
    const estimatedQuotaNeeded = channelsToProcess.length * (1 + maxPlaylistsPerChannel + 1);

    console.log(`📊 Current quota usage: ${quotaUsage.total} units`);
    console.log(`📊 Estimated quota needed: ${estimatedQuotaNeeded} units`);

    if (quotaUsage.total + estimatedQuotaNeeded > 9000) { // Leave 1000 units buffer
      return NextResponse.json(
        { 
          error: 'Insufficient quota remaining',
          currentUsage: quotaUsage.total,
          estimatedNeeded: estimatedQuotaNeeded,
          recommended: 'Wait for quota reset or reduce parameters'
        },
        { status: 429 }
      );
    }

    if (dryRun) {
      return NextResponse.json({
        message: 'Playlist creator discovery dry run completed',
        channelsToProcess: channelsToProcess.length,
        maxPlaylistsPerChannel,
        estimatedQuotaUsage: estimatedQuotaNeeded,
        currentQuotaUsage: quotaUsage.total,
        searchUntilResults,
        maxChannelsToSearch,
        method: 'playlist_creators'
      });
    }

    // Start the playlist creator discovery
    console.log(`🎵 Starting playlist creator discovery for ${channelsToProcess.length} channels`);
    
    const startTime = new Date();
    const discoveryResult = await playlistCreatorDiscovery.discoverPlaylistCreators(
      channelsToProcess,
      maxPlaylistsPerChannel,
      excludeExisting,
      searchUntilResults,
      maxChannelsToSearch
    );

    return NextResponse.json({
      message: 'Playlist creator discovery completed successfully',
      method: 'playlist_creators',
      channelsProcessed: channelsToProcess.length,
      channelsDiscovered: discoveryResult.totalDiscovered,
      quotaUsed: discoveryResult.totalQuotaUsed,
      processingTime: new Date().getTime() - startTime.getTime(),
      parameters: {
        maxPlaylistsPerChannel,
        excludeExisting
      },
      searchStats: {
        channelsSearched: discoveryResult.channelsSearched,
        channelsWithPlaylists: discoveryResult.channelsWithPlaylists,
        searchUntilResults,
        maxChannelsToSearch
      },
      results: discoveryResult.results.map(r => ({
        sourceChannelId: r.sourceChannelId,
        discoveredCount: r.discoveredChannels.length,
        playlistsProcessed: r.playlistsProcessed,
        creatorsFound: r.creatorsFound,
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
    console.error('Playlist creator discovery error:', error);
    return NextResponse.json(
      { 
        error: 'Failed to run playlist creator discovery',
        message: (error as Error).message 
      },
      { status: 500 }
    );
  }
}

export async function GET(request: NextRequest) {
  try {
    // Get statistics for playlist creator discoveries
    const { data: playlistDiscoveries, error } = await supabase
      .from('channel_discovery')
      .select('*')
      .eq('discovery_method', 'playlist')
      .order('discovery_date', { ascending: false });

    if (error) {
      throw new Error(`Failed to fetch playlist discoveries: ${error.message}`);
    }

    const stats = {
      totalDiscovered: playlistDiscoveries?.length || 0,
      pending: playlistDiscoveries?.filter(d => d.validation_status === 'pending').length || 0,
      approved: playlistDiscoveries?.filter(d => d.validation_status === 'approved').length || 0,
      rejected: playlistDiscoveries?.filter(d => d.validation_status === 'rejected').length || 0,
    };

    return NextResponse.json({
      message: 'Playlist creator discovery statistics',
      method: 'playlist_creators',
      statistics: stats,
      recentDiscoveries: playlistDiscoveries?.slice(0, 10).map(d => ({
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
    console.error('Error getting playlist creator stats:', error);
    return NextResponse.json(
      { 
        error: 'Failed to get playlist creator statistics',
        message: (error as Error).message 
      },
      { status: 500 }
    );
  }
}