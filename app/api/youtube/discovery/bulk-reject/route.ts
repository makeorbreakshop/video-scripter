import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { filter, reason } = body;

    // Get existing channel names from videos table for filtering
    const { data: existingChannels } = await supabase
      .from('videos')
      .select('channel_id')
      .neq('channel_id', null);
    
    const existingChannelNames = new Set(
      existingChannels?.map(c => c.channel_id.toLowerCase()) || []
    );

    // First, get the channels to update
    let selectQuery = supabase
      .from('channel_discovery')
      .select('id, discovered_channel_id, channel_metadata')
      .eq('validation_status', 'pending');

    // Apply different filters
    if (filter === 'no_videos') {
      selectQuery = selectQuery.or('video_count.eq.0,video_count.is.null');
    } else if (filter === 'low_videos') {
      selectQuery = selectQuery.lt('video_count', 10);
    } else if (filter === 'low_subscribers') {
      selectQuery = selectQuery.lt('subscriber_count', 1000);
    }

    const { data: channelsToUpdate, error: selectError } = await selectQuery;

    if (selectError) {
      console.error('Select error:', selectError);
      return NextResponse.json({ error: 'Failed to find channels to reject' }, { status: 500 });
    }

    if (!channelsToUpdate || channelsToUpdate.length === 0) {
      return NextResponse.json({
        success: true,
        rejectedCount: 0,
        message: 'No channels found matching the filter criteria'
      });
    }

    // Now update them
    const { data, error } = await supabase
      .from('channel_discovery')
      .update({ 
        validation_status: 'rejected'
      })
      .in('id', channelsToUpdate.map(c => c.id))
      .select('discovered_channel_id');

    if (error) {
      console.error('Bulk rejection error:', error);
      return NextResponse.json(
        { error: 'Failed to bulk reject channels' },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      rejectedCount: data?.length || 0,
      message: `Successfully rejected ${data?.length || 0} channels`
    });

  } catch (error) {
    console.error('Bulk rejection error:', error);
    return NextResponse.json(
      { error: 'Failed to process bulk rejection' },
      { status: 500 }
    );
  }
}

export async function GET() {
  try {
    // Get filtering statistics
    const { data: stats, error } = await supabase
      .from('channel_discovery')
      .select('video_count, subscriber_count, validation_status')
      .eq('validation_status', 'pending');

    if (error) {
      return NextResponse.json({ error: 'Failed to fetch stats' }, { status: 500 });
    }

    const filterStats = {
      total: stats.length,
      noVideos: stats.filter(s => !s.video_count || s.video_count === 0).length,
      lowVideos: stats.filter(s => s.video_count && s.video_count < 10).length,
      lowSubscribers: stats.filter(s => s.subscriber_count && s.subscriber_count < 1000).length,
      quality: stats.filter(s => 
        s.video_count && s.video_count >= 10 && 
        s.subscriber_count && s.subscriber_count >= 1000
      ).length
    };

    return NextResponse.json({ filterStats });

  } catch (error) {
    console.error('Error fetching filter stats:', error);
    return NextResponse.json(
      { error: 'Failed to fetch filter statistics' },
      { status: 500 }
    );
  }
}