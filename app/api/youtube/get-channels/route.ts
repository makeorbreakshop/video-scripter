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
    
    // Get all unique YouTube channel IDs from competitor videos
    // Using raw SQL for better performance and to handle JSON properly
    const { data: channelData, error } = await supabase
      .rpc('get_competitor_youtube_channels');

    if (error) {
      console.error('Error fetching channels via RPC:', error);
      return NextResponse.json(
        { error: 'Failed to fetch channels' },
        { status: 500 }
      );
    }

    // RPC function returns array of objects with youtube_channel_id
    const channelIds = channelData?.map((row: any) => row.youtube_channel_id).filter(Boolean) || [];
    console.log(`📺 Found ${channelIds.length} unique YouTube channels for RSS monitoring`);

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