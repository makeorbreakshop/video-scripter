/**
 * Get all unique channel IDs from the videos table
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

export async function GET(request: NextRequest) {
  try {
    console.log('🔍 Fetching YouTube channels from database...');
    
    // Get all unique YouTube channel IDs from metadata using direct SQL for efficiency
    const { data: channels, error } = await supabase
      .rpc('get_youtube_channel_ids');

    if (error) {
      console.error('Error fetching channels via RPC:', error);
      // Fallback to direct query if RPC doesn't exist
      const { data: fallbackChannels, error: fallbackError } = await supabase
        .from('videos')
        .select('metadata')
        .not('metadata->youtube_channel_id', 'is', null);

      if (fallbackError) {
        console.error('Error fetching channels:', fallbackError);
        return NextResponse.json(
          { error: 'Failed to fetch channels' },
          { status: 500 }
        );
      }

      // Extract unique channel IDs from metadata
      const uniqueChannels = new Set<string>();
      fallbackChannels?.forEach(video => {
        const youtubeChannelId = video.metadata?.youtube_channel_id;
        if (youtubeChannelId && youtubeChannelId.startsWith('UC')) {
          uniqueChannels.add(youtubeChannelId);
        }
      });

      const channelIds = Array.from(uniqueChannels);
      console.log(`📺 Found ${channelIds.length} unique YouTube channels (fallback method)`);

      return NextResponse.json({
        success: true,
        channels: channelIds,
        count: channelIds.length
      });
    }

    // RPC function worked, use its results
    const channelIds = channels?.map((row: any) => row.youtube_channel_id).filter(Boolean) || [];
    console.log(`📺 Found ${channelIds.length} unique YouTube channels (RPC method)`);

    return NextResponse.json({
      success: true,
      channels: channelIds,
      count: channelIds.length
    });

  } catch (error) {
    console.error('Error in get-channels API:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}