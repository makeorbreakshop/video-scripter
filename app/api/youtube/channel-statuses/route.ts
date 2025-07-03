/**
 * Channel Status API Route
 * Returns status of research channels (imported video counts, expansion needs)
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

console.log('🔧 Supabase config check:', {
  url: process.env.NEXT_PUBLIC_SUPABASE_URL?.slice(0, 30) + '...',
  serviceKeyLength: process.env.SUPABASE_SERVICE_ROLE_KEY?.length
});

const manualChannelIds: Record<string, string> = {
  'I Like To Make Stuff': 'UC6x7GwJxuoABSosgVXDYtTw',
  'Make Something': 'UCtaykeSsGhtn2o2BsPm-rsw',
  'Fix This Build That': 'UCHYSw4XKO_q1GaChw5pxa-w',
  'wittworks': 'UCGhyz7J9HmS0GT8Y_BR_crA'
};

export async function POST(request: NextRequest) {
  try {
    const { channels } = await request.json();

    if (!channels || !Array.isArray(channels)) {
      return NextResponse.json(
        { error: 'Channels array is required' },
        { status: 400 }
      );
    }

    // Get actual current video counts from the videos table
    const { data: videoCounts, error: videoError } = await supabase
      .from('videos')
      .select('channel_id')
      .eq('is_competitor', true)
      .in('channel_id', channels);

    if (videoError) {
      console.error('Error fetching video counts:', videoError);
      return NextResponse.json(
        { error: 'Failed to fetch video counts' },
        { status: 500 }
      );
    }

    // Count videos by channel
    const channelVideosCounts: Record<string, number> = {};
    videoCounts?.forEach(video => {
      channelVideosCounts[video.channel_id] = (channelVideosCounts[video.channel_id] || 0) + 1;
    });

    // Get channel IDs from tracking table
    const { data: statuses, error } = await supabase
      .from('channel_import_status')
      .select('channel_name, channel_id, is_fully_imported')
      .in('channel_name', channels);

    if (error) {
      console.error('Error fetching channel statuses:', error);
      return NextResponse.json(
        { error: 'Failed to fetch channel statuses' },
        { status: 500 }
      );
    }

    // Format the response - only show channels that haven't been fully imported via research expansion
    const formattedStatuses = statuses
      ?.filter(status => {
        // Only show channels that haven't been fully imported yet
        return !status.is_fully_imported;
      })
      .map(status => ({
        name: status.channel_name,
        currentVideos: channelVideosCounts[status.channel_name] || 0,
        hasManualId: !!status.channel_id,
        channelId: status.channel_id,
        needsExpansion: true
      })) || [];

    console.log('📊 Channel statuses for expansion:', formattedStatuses);

    return NextResponse.json(formattedStatuses);

  } catch (error) {
    console.error('Error getting channel statuses:', error);
    return NextResponse.json(
      { error: 'Failed to get channel statuses' },
      { status: 500 }
    );
  }
}