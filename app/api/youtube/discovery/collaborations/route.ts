// API Route: Video Collaboration Mining Discovery
// Discovers channels through collaboration mentions in video metadata (Method 6)

import { NextRequest, NextResponse } from 'next/server';
import { collaborationMiningDiscovery } from '@/lib/collaboration-mining-discovery';
import { youtubeDiscoveryAPI } from '@/lib/youtube-discovery-api';
import { getSupabaseClient } from '@/lib/supabase-client';

export async function POST(request: NextRequest) {
  const supabase = getSupabaseClient();
  try {
    const body = await request.json();
    const { 
      sourceChannelIds, 
      maxVideosPerChannel = 50,
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
      console.log('🔍 Getting all imported channels for collaboration mining discovery');
      
      const { data: allChannels, error } = await supabase
        .from('videos')
        .select('metadata')
        .eq('is_competitor', true)
        .not('metadata->youtube_channel_id', 'is', null);

      if (error) {
        throw new Error(`Failed to fetch channels: ${error.message}`);
      }

      const uniqueChannelIds = [...new Set(
        allChannels
          ?.map(v => v.metadata?.youtube_channel_id)
          .filter(Boolean) || []
      )];
      channelsToProcess = uniqueChannelIds;
      
      console.log(`📊 Found ${uniqueChannelIds.length} unique competitor channels with YouTube IDs`);
    }

    if (channelsToProcess.length === 0) {
      return NextResponse.json(
        { error: 'No channels found to process' },
        { status: 400 }
      );
    }

    // Check current quota usage
    const quotaUsage = youtubeDiscoveryAPI.getQuotaUsage();
    // Estimate: (2 + 100*mentions) units per channel for videos + channel lookup + search calls
    // Conservative estimate: assume 2 mentions per channel needing search
    const estimatedQuotaNeeded = channelsToProcess.length * (2 + 200); // 2 for videos + ~200 for searches

    console.log(`📊 Current quota usage: ${quotaUsage.total} units`);
    console.log(`📊 Estimated quota needed: ${estimatedQuotaNeeded} units`);

    if (quotaUsage.total + estimatedQuotaNeeded > 8000) { // Leave 2000 units buffer due to search costs
      return NextResponse.json(
        { 
          error: 'Insufficient quota remaining for collaboration mining',
          currentUsage: quotaUsage.total,
          estimatedNeeded: estimatedQuotaNeeded,
          recommended: 'Wait for quota reset or reduce parameters (collaboration mining uses expensive search API)'
        },
        { status: 429 }
      );
    }

    if (dryRun) {
      return NextResponse.json({
        message: 'Video collaboration mining discovery dry run completed',
        channelsToProcess: channelsToProcess.length,
        maxVideosPerChannel,
        estimatedQuotaUsage: estimatedQuotaNeeded,
        currentQuotaUsage: quotaUsage.total,
        searchUntilResults,
        maxChannelsToSearch,
        method: 'video_collaboration_mining',
        warning: 'Collaboration mining uses expensive search API (100 units per search)'
      });
    }

    // Start the collaboration mining discovery
    console.log(`🤝 Starting collaboration mining discovery for ${channelsToProcess.length} channels`);
    
    const startTime = new Date();
    const discoveryResult = await collaborationMiningDiscovery.discoverCollaborations(
      channelsToProcess,
      maxVideosPerChannel,
      excludeExisting,
      searchUntilResults,
      maxChannelsToSearch
    );

    return NextResponse.json({
      message: 'Video collaboration mining discovery completed successfully',
      method: 'video_collaboration_mining',
      channelsProcessed: channelsToProcess.length,
      channelsDiscovered: discoveryResult.totalDiscovered,
      quotaUsed: discoveryResult.totalQuotaUsed,
      processingTime: new Date().getTime() - startTime.getTime(),
      parameters: {
        maxVideosPerChannel,
        excludeExisting
      },
      searchStats: {
        channelsSearched: discoveryResult.channelsSearched,
        channelsWithCollaborations: discoveryResult.channelsWithCollaborations,
        searchUntilResults,
        maxChannelsToSearch
      },
      results: discoveryResult.results.map(r => ({
        sourceChannelId: r.sourceChannelId,
        discoveredCount: r.discoveredChannels.length,
        videosProcessed: r.videosProcessed,
        collaborationsFound: r.collaborationsFound,
        mentionsExtracted: r.mentionsExtracted,
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
    console.error('Video collaboration mining discovery error:', error);
    return NextResponse.json(
      { 
        error: 'Failed to run video collaboration mining discovery',
        message: (error as Error).message 
      },
      { status: 500 }
    );
  }
}

export async function GET(request: NextRequest) {
  const supabase = getSupabaseClient();
  try {
    // Get statistics for collaboration discoveries
    const { data: collaborationDiscoveries, error } = await supabase
      .from('channel_discovery')
      .select('*')
      .eq('discovery_method', 'collaboration')
      .order('discovery_date', { ascending: false });

    if (error) {
      throw new Error(`Failed to fetch collaboration discoveries: ${error.message}`);
    }

    const stats = {
      totalDiscovered: collaborationDiscoveries?.length || 0,
      pending: collaborationDiscoveries?.filter(d => d.validation_status === 'pending').length || 0,
      approved: collaborationDiscoveries?.filter(d => d.validation_status === 'approved').length || 0,
      rejected: collaborationDiscoveries?.filter(d => d.validation_status === 'rejected').length || 0,
    };

    return NextResponse.json({
      message: 'Video collaboration mining discovery statistics',
      method: 'video_collaboration_mining',
      statistics: stats,
      recentDiscoveries: collaborationDiscoveries?.slice(0, 10).map(d => ({
        sourceChannelId: d.source_channel_id,
        discoveredChannelId: d.discovered_channel_id,
        channelTitle: d.channel_metadata?.title || 'Unknown',
        subscriberCount: d.subscriber_count,
        videoCount: d.video_count,
        validationStatus: d.validation_status,
        discoveryDate: d.discovery_date,
        collaborationMention: d.discovery_context?.collaborationMention,
        hasCollaborationKeyword: d.discovery_context?.hasCollaborationKeyword
      })) || []
    });

  } catch (error) {
    console.error('Error getting collaboration mining stats:', error);
    return NextResponse.json(
      { 
        error: 'Failed to get collaboration mining statistics',
        message: (error as Error).message 
      },
      { status: 500 }
    );
  }
}