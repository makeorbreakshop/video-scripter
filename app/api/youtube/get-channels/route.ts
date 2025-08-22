/**
 * Get all unique channel IDs from the videos table
 */

import { NextRequest, NextResponse } from 'next/server';
import { getSupabase } from '@/lib/supabase-lazy';


export async function GET(request: NextRequest) {
  const supabase = getSupabase();
  try {
    console.log('🔍 Fetching YouTube channels from database...');
    
    // Bypass Supabase client limits by using direct SQL via fetch
    // This ensures we get all 4,448+ channels without client-side row limits
    try {
      const directResponse = await fetch(`${request.nextUrl.origin}/api/execute-sql`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query: `
            SELECT DISTINCT youtube_channel_id FROM (
              SELECT youtube_channel_id FROM competitor_youtube_channels
              UNION
              SELECT channel_id as youtube_channel_id FROM discovered_channels 
              WHERE channel_id IS NOT NULL
            ) combined 
            ORDER BY youtube_channel_id
          `
        })
      });
      
      if (directResponse.ok) {
        const directData = await directResponse.json();
        const channelIds = directData.data?.map((row: any) => row.youtube_channel_id).filter(Boolean) || [];
        console.log(`📺 Direct SQL returned ${channelIds.length} channels (bypassing client limits)`);
        
        return NextResponse.json({
          success: true,
          channels: channelIds,
          count: channelIds.length,
          method: 'direct-sql'
        });
      }
    } catch (directError) {
      console.warn('Direct SQL approach failed, falling back to RPC:', directError);
    }
    
    // Fallback to RPC approach with client limits
    const { data: channelData, error } = await supabase
      .rpc('get_competitor_youtube_channels');

    if (error) {
      console.error('Error fetching channels via RPC:', error);
      return NextResponse.json(
        { error: 'Failed to fetch channels' },
        { status: 500 }
      );
    }

    const channelIds = channelData?.map((row: any) => row.youtube_channel_id).filter(Boolean) || [];
    console.log(`📺 RPC returned ${channelIds.length} channels`);
    
    if (channelIds.length === 1000) {
      console.warn('⚠️  Got exactly 1000 channels - Supabase client limit hit, may be missing channels');
    }

    return NextResponse.json({
      success: true,
      channels: channelIds,
      count: channelIds.length,
      method: 'rpc-fallback'
    });

  } catch (error) {
    console.error('Error in get-channels API:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}