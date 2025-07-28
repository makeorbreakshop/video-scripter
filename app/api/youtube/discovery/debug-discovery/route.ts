/**
 * Debug Discovery - Check why channels aren't being saved
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { googlePSE } from '@/lib/google-pse-service';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function GET(request: NextRequest) {
  try {
    // Test with a simple query
    const query = 'cooking tutorial for beginners';
    
    // Search
    const result = await googlePSE.searchYouTube(query, {
      num: 5,
      type: 'video'
    });
    
    console.log(`Found ${result.results.length} channels from PSE`);
    
    // Get first channel
    if (result.results.length === 0) {
      return NextResponse.json({ error: 'No channels found' });
    }
    
    const firstChannel = result.results[0];
    
    // Check if it exists in various tables
    const checks = await Promise.all([
      supabase
        .from('channel_discovery')
        .select('*')
        .eq('discovered_channel_id', firstChannel.channelId || 'dummy')
        .single(),
      
      supabase
        .from('videos')
        .select('channel_id, channel_title')
        .eq('channel_id', firstChannel.channelId || 'dummy')
        .limit(1),
        
      supabase
        .from('discovered_channels')
        .select('*')
        .eq('channel_id', firstChannel.channelId || 'dummy')
        .single()
    ]);
    
    return NextResponse.json({
      channel: {
        name: firstChannel.channelName,
        id: firstChannel.channelId,
        url: firstChannel.channelUrl
      },
      existsIn: {
        channel_discovery: !!checks[0].data,
        videos: checks[1].data && checks[1].data.length > 0,
        discovered_channels: !!checks[2].data
      },
      details: {
        channel_discovery: checks[0].data || checks[0].error,
        videos: checks[1].data?.[0] || checks[1].error,
        discovered_channels: checks[2].data || checks[2].error
      }
    });
    
  } catch (error) {
    console.error('Debug discovery error:', error);
    return NextResponse.json({
      error: 'Debug failed',
      details: error.message
    }, { status: 500 });
  }
}