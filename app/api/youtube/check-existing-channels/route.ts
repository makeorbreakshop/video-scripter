/**
 * Check Existing Channels API Route
 * Returns channels that are already imported in the system
 * Checks both competitor channels and discovery channels
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

export async function POST(request: NextRequest) {
  try {
    const { channelIds } = await request.json();

    if (!channelIds || !Array.isArray(channelIds)) {
      return NextResponse.json(
        { error: 'Channel IDs array is required' },
        { status: 400 }
      );
    }

    // Check competitor channels (from videos table)
    const { data: competitorChannels, error: competitorError } = await supabase
      .from('videos')
      .select('metadata')
      .eq('is_competitor', true)
      .in('metadata->>youtube_channel_id', channelIds);

    if (competitorError) {
      console.error('Error checking competitor channels:', competitorError);
    }

    // Check discovery channels
    const { data: discoveryChannels, error: discoveryError } = await supabase
      .from('channel_discovery')
      .select('discovered_channel_id, validation_status')
      .in('discovered_channel_id', channelIds);

    if (discoveryError) {
      console.error('Error checking discovery channels:', discoveryError);
    }

    // Build set of existing channel IDs
    const existingChannelIds = new Set<string>();

    // Add competitor channel IDs
    if (competitorChannels) {
      competitorChannels.forEach(video => {
        const youtubeChannelId = video.metadata?.youtube_channel_id;
        if (youtubeChannelId) {
          existingChannelIds.add(youtubeChannelId);
        }
      });
    }

    // Add discovery channel IDs
    if (discoveryChannels) {
      discoveryChannels.forEach(channel => {
        existingChannelIds.add(channel.discovered_channel_id);
      });
    }

    // Create response with channel status
    const channelStatus = channelIds.map(channelId => ({
      channelId,
      isExisting: existingChannelIds.has(channelId),
      source: competitorChannels?.some(v => v.metadata?.youtube_channel_id === channelId) 
        ? 'competitor' 
        : discoveryChannels?.some(d => d.discovered_channel_id === channelId)
        ? 'discovery'
        : null
    }));

    return NextResponse.json({
      success: true,
      channelStatus,
      totalExisting: Array.from(existingChannelIds).length
    });

  } catch (error) {
    console.error('Error checking existing channels:', error);
    return NextResponse.json(
      { error: 'Failed to check existing channels' },
      { status: 500 }
    );
  }
}