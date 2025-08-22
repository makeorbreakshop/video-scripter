import { NextRequest, NextResponse } from 'next/server';
import { getSupabase } from '@/lib/supabase-lazy';


export async function POST(request: NextRequest) {
  const supabase = getSupabase();
  try {
    // Get existing channel names from videos table
    const { data: existingChannels, error: existingError } = await supabase
      .from('videos')
      .select('channel_id')
      .neq('channel_id', null);

    if (existingError) {
      throw existingError;
    }

    const existingChannelNames = new Set(
      existingChannels?.map(c => c.channel_id.toLowerCase()) || []
    );

    // Get all pending discoveries
    const { data: discoveries, error: discoveriesError } = await supabase
      .from('channel_discovery')
      .select('id, discovered_channel_id, channel_metadata')
      .eq('validation_status', 'pending');

    if (discoveriesError) {
      throw discoveriesError;
    }

    // Filter to find channels that already exist
    const existingDiscoveries = discoveries.filter(discovery => {
      const channelTitle = discovery.channel_metadata?.title || '';
      return existingChannelNames.has(channelTitle.toLowerCase());
    });

    if (existingDiscoveries.length === 0) {
      return NextResponse.json({
        success: true,
        rejectedCount: 0,
        message: 'No existing channels found in discovery queue'
      });
    }

    // Bulk update to rejected
    const { data, error: updateError } = await supabase
      .from('channel_discovery')
      .update({
        validation_status: 'rejected'
      })
      .in('id', existingDiscoveries.map(d => d.id))
      .select('discovered_channel_id, channel_metadata');

    if (updateError) {
      throw updateError;
    }

    return NextResponse.json({
      success: true,
      rejectedCount: data?.length || 0,
      message: `Successfully rejected ${data?.length || 0} channels that already exist in the system`,
      rejectedChannels: data?.map(d => d.channel_metadata?.title).filter(Boolean) || []
    });

  } catch (error) {
    console.error('Bulk reject existing channels error:', error);
    return NextResponse.json(
      { error: 'Failed to reject existing channels' },
      { status: 500 }
    );
  }
}

export async function GET() {
  const supabase = getSupabase();
  try {
    // Get existing channel names from videos table
    const { data: existingChannels } = await supabase
      .from('videos')
      .select('channel_id')
      .neq('channel_id', null);

    const existingChannelNames = new Set(
      existingChannels?.map(c => c.channel_id.toLowerCase()) || []
    );

    // Get pending discoveries that match existing channels
    const { data: discoveries } = await supabase
      .from('channel_discovery')
      .select('discovered_channel_id, channel_metadata, subscriber_count')
      .eq('validation_status', 'pending');

    const matchingChannels = discoveries?.filter(discovery => {
      const channelTitle = discovery.channel_metadata?.title || '';
      return existingChannelNames.has(channelTitle.toLowerCase());
    }) || [];

    return NextResponse.json({
      existingChannelsFound: matchingChannels.length,
      channels: matchingChannels.map(c => ({
        title: c.channel_metadata?.title,
        subscribers: c.subscriber_count
      }))
    });

  } catch (error) {
    console.error('Error checking existing channels:', error);
    return NextResponse.json(
      { error: 'Failed to check existing channels' },
      { status: 500 }
    );
  }
}