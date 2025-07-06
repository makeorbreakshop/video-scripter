// API Route: Comment Author Discovery
// Discovers channels through comment author mining (Method 5)

import { NextRequest, NextResponse } from 'next/server';
import { commentAuthorDiscovery } from '@/lib/comment-author-discovery';
import { youtubeDiscoveryAPI } from '@/lib/youtube-discovery-api';
import { supabase } from '@/lib/supabase-client';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { 
      sourceChannelIds, 
      maxVideosPerChannel = 5,
      maxCommentsPerVideo = 20,
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

    // If "all" specified, get all imported channels
    let channelsToProcess = sourceChannelIds;
    
    if (sourceChannelIds.includes('all')) {
      console.log('🔍 Getting all imported channels for comment author discovery');
      
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
    // Estimate: 1 unit per video for comments + validation quota
    const estimatedQuotaNeeded = channelsToProcess.length * (maxVideosPerChannel + 2);

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
        message: 'Comment author discovery dry run completed',
        channelsToProcess: channelsToProcess.length,
        maxVideosPerChannel,
        maxCommentsPerVideo,
        estimatedQuotaUsage: estimatedQuotaNeeded,
        currentQuotaUsage: quotaUsage.total,
        method: 'comment_authors'
      });
    }

    // Start the comment author discovery
    console.log(`💬 Starting comment author discovery for ${channelsToProcess.length} channels`);
    
    const startTime = new Date();
    const discoveryResult = await commentAuthorDiscovery.discoverCommentAuthors(
      channelsToProcess,
      maxVideosPerChannel,
      maxCommentsPerVideo,
      excludeExisting
    );

    return NextResponse.json({
      message: 'Comment author discovery completed successfully',
      method: 'comment_authors',
      channelsProcessed: channelsToProcess.length,
      channelsDiscovered: discoveryResult.totalDiscovered,
      quotaUsed: discoveryResult.totalQuotaUsed,
      processingTime: new Date().getTime() - startTime.getTime(),
      parameters: {
        maxVideosPerChannel,
        maxCommentsPerVideo,
        excludeExisting
      },
      results: discoveryResult.results.map(r => ({
        sourceChannelId: r.sourceChannelId,
        discoveredCount: r.discoveredChannels.length,
        commentsProcessed: r.commentsProcessed,
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
    console.error('Comment author discovery error:', error);
    return NextResponse.json(
      { 
        error: 'Failed to run comment author discovery',
        message: (error as Error).message 
      },
      { status: 500 }
    );
  }
}

export async function GET(request: NextRequest) {
  try {
    // Get statistics for comment author discoveries
    const { data: commentDiscoveries, error } = await supabase
      .from('channel_discovery')
      .select('*')
      .eq('discovery_method', 'comment')
      .order('discovery_date', { ascending: false });

    if (error) {
      throw new Error(`Failed to fetch comment discoveries: ${error.message}`);
    }

    const stats = {
      totalDiscovered: commentDiscoveries?.length || 0,
      pending: commentDiscoveries?.filter(d => d.validation_status === 'pending').length || 0,
      approved: commentDiscoveries?.filter(d => d.validation_status === 'approved').length || 0,
      rejected: commentDiscoveries?.filter(d => d.validation_status === 'rejected').length || 0,
    };

    return NextResponse.json({
      message: 'Comment author discovery statistics',
      method: 'comment_authors',
      statistics: stats,
      recentDiscoveries: commentDiscoveries?.slice(0, 10).map(d => ({
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
    console.error('Error getting comment author stats:', error);
    return NextResponse.json(
      { 
        error: 'Failed to get comment author statistics',
        message: (error as Error).message 
      },
      { status: 500 }
    );
  }
}