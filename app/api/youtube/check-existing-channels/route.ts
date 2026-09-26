/**
 * Check Existing Channels API Route
 * Returns channels that are already imported in the system
 * Checks both competitor channels and discovery channels
 */

import { NextRequest, NextResponse } from 'next/server';
import { getSupabase } from '@/lib/supabase-lazy';
import { youtubeChannelIdsPresent } from '@/lib/app/video-text';


export async function POST(request: NextRequest) {
  const supabase = getSupabase();
  try {
    const { channelIds } = await request.json();

    if (!channelIds || !Array.isArray(channelIds)) {
      return NextResponse.json(
        { error: 'Channel IDs array is required' },
        { status: 400 }
      );
    }

    // Check competitor channels (from videos table)
    // metadata->>youtube_channel_id is read through the side table (lib/app/video-text.ts).
    let competitorChannelIds: string[] | null = null;
    try {
      competitorChannelIds = await youtubeChannelIdsPresent(channelIds, { competitorOnly: true });
    } catch (competitorError) {
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
    if (competitorChannelIds) {
      competitorChannelIds.forEach(youtubeChannelId => existingChannelIds.add(youtubeChannelId));
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
      source: competitorChannelIds?.includes(channelId) 
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