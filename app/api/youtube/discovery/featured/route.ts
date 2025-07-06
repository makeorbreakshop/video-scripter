// API Route: Featured Channels Discovery
// Discovers channels through brandingSettings.featuredChannelsUrls

import { NextRequest, NextResponse } from 'next/server';
import { featuredChannelsDiscovery } from '@/lib/featured-channels-discovery';
import { youtubeDiscoveryAPI } from '@/lib/youtube-discovery-api';
import { supabase } from '@/lib/supabase-client';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { 
      sourceChannelIds, 
      excludeExisting = true,
      dryRun = false 
    } = body;

    // Validate input
    if (!sourceChannelIds || !Array.isArray(sourceChannelIds) || sourceChannelIds.length === 0) {
      return NextResponse.json(
        { error: 'sourceChannelIds array is required' },
        { status: 400 }
      );
    }

    // If no source channels provided, get all imported channels
    let channelsToProcess = sourceChannelIds;
    
    if (sourceChannelIds.includes('all')) {
      console.log('🔍 Getting all imported channels for featured discovery');
      
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
    const estimatedQuotaNeeded = Math.ceil(channelsToProcess.length / 50); // 1 unit per 50 channels

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
        message: 'Featured channels dry run completed',
        channelsToProcess: channelsToProcess.length,
        estimatedQuotaUsage: estimatedQuotaNeeded,
        currentQuotaUsage: quotaUsage.total,
        method: 'featured_channels'
      });
    }

    // Start the featured channels discovery
    console.log(`🌟 Starting featured channels discovery for ${channelsToProcess.length} channels`);
    
    const startTime = new Date();
    const discoveryResult = await featuredChannelsDiscovery.discoverFeaturedChannels(
      channelsToProcess, 
      excludeExisting
    );

    return NextResponse.json({
      message: 'Featured channels discovery completed successfully',
      method: 'featured_channels',
      channelsProcessed: channelsToProcess.length,
      channelsDiscovered: discoveryResult.totalDiscovered,
      quotaUsed: discoveryResult.totalQuotaUsed,
      processingTime: new Date().getTime() - startTime.getTime(),
      results: discoveryResult.results.map(r => ({
        sourceChannelId: r.sourceChannelId,
        discoveredCount: r.discoveredChannels.length,
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
    console.error('Featured channels discovery error:', error);
    return NextResponse.json(
      { 
        error: 'Failed to run featured channels discovery',
        message: (error as Error).message 
      },
      { status: 500 }
    );
  }
}

export async function GET(request: NextRequest) {
  try {
    // Get statistics for featured channels discoveries
    const { data: featuredDiscoveries, error } = await supabase
      .from('channel_discovery')
      .select('*')
      .eq('discovery_method', 'featured')
      .order('discovery_date', { ascending: false });

    if (error) {
      throw new Error(`Failed to fetch featured discoveries: ${error.message}`);
    }

    const stats = {
      totalDiscovered: featuredDiscoveries?.length || 0,
      pending: featuredDiscoveries?.filter(d => d.validation_status === 'pending').length || 0,
      approved: featuredDiscoveries?.filter(d => d.validation_status === 'approved').length || 0,
      rejected: featuredDiscoveries?.filter(d => d.validation_status === 'rejected').length || 0,
    };

    return NextResponse.json({
      message: 'Featured channels discovery statistics',
      method: 'featured_channels',
      statistics: stats,
      recentDiscoveries: featuredDiscoveries?.slice(0, 10).map(d => ({
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
    console.error('Error getting featured channels stats:', error);
    return NextResponse.json(
      { 
        error: 'Failed to get featured channels statistics',
        message: (error as Error).message 
      },
      { status: 500 }
    );
  }
}