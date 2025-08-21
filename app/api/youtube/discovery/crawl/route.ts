// API Route: YouTube Channel Discovery Crawler
// Initiates subscription network crawling for channel discovery

import { NextRequest, NextResponse } from 'next/server';
import { subscriptionCrawler } from '@/lib/subscription-crawler';
import { youtubeDiscoveryAPI } from '@/lib/youtube-discovery-api';
import { getSupabaseClient } from '@/lib/supabase-client';

export async function POST(request: NextRequest) {
  const supabase = getSupabaseClient();
  try {
    const body = await request.json();
    const { 
      sourceChannelIds, 
      criteria = {},
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
      console.log('🔍 Getting all imported channels for discovery');
      
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
    const estimatedQuotaNeeded = Math.ceil(channelsToProcess.length * 1.5); // Conservative estimate

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
        message: 'Dry run completed',
        channelsToProcess: channelsToProcess.length,
        estimatedQuotaUsage: estimatedQuotaNeeded,
        currentQuotaUsage: quotaUsage.total
      });
    }

    // Start the crawl session
    console.log(`🚀 Starting discovery crawl for ${channelsToProcess.length} channels`);
    
    const session = await subscriptionCrawler.startCrawlSession(channelsToProcess, criteria);

    return NextResponse.json({
      message: 'Discovery crawl started successfully',
      sessionId: session.id,
      channelsToProcess: session.totalChannels,
      estimatedQuotaUsage: estimatedQuotaNeeded,
      session: {
        id: session.id,
        status: session.status,
        totalChannels: session.totalChannels,
        processedChannels: session.processedChannels,
        channelsDiscovered: session.channelsDiscovered,
        quotaUsed: session.quotaUsed,
        startTime: session.startTime
      }
    });

  } catch (error) {
    console.error('Discovery crawl error:', error);
    return NextResponse.json(
      { 
        error: 'Failed to start discovery crawl',
        message: (error as Error).message 
      },
      { status: 500 }
    );
  }
}

export async function GET(request: NextRequest) {
  const supabase = getSupabaseClient();
  try {
    // Get current session status
    const session = subscriptionCrawler.getSessionStatus();
    const quotaUsage = youtubeDiscoveryAPI.getQuotaUsage();

    if (!session) {
      return NextResponse.json({
        message: 'No active crawl session',
        quotaUsage
      });
    }

    return NextResponse.json({
      session: {
        id: session.id,
        status: session.status,
        totalChannels: session.totalChannels,
        processedChannels: session.processedChannels,
        channelsDiscovered: session.channelsDiscovered,
        quotaUsed: session.quotaUsed,
        startTime: session.startTime,
        endTime: session.endTime,
        errors: session.errors,
        progress: session.totalChannels > 0 ? 
          (session.processedChannels / session.totalChannels * 100) : 0
      },
      quotaUsage
    });

  } catch (error) {
    console.error('Error getting crawl status:', error);
    return NextResponse.json(
      { 
        error: 'Failed to get crawl status',
        message: (error as Error).message 
      },
      { status: 500 }
    );
  }
}