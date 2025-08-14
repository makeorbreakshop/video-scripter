/**
 * Channel Search API - Autocomplete search for channels in database
 * GET /api/search-channels
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

interface ChannelSearchResult {
  channel_id: string;
  channel_name: string;
  channel_icon?: string;
  video_count: number;
  avg_performance?: number;
  latest_video_date?: string;
}

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const query = searchParams.get('q') || '';
    const limit = parseInt(searchParams.get('limit') || '10');

    if (!query || query.length < 2) {
      return NextResponse.json({ channels: [] });
    }

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    console.log(`🔍 Searching channels for: "${query}"`);

    // Super fast approach: Just get distinct channel names, no stats
    const { data: channels, error } = await supabase
      .from('videos')
      .select('channel_id, channel_name, thumbnail_url')
      .ilike('channel_name', `%${query}%`)
      .limit(20) // Small limit for fast response
      .order('published_at', { ascending: false });

    if (error) {
      console.error('❌ Channel search failed:', error);
      throw error;
    }

    if (!channels || channels.length === 0) {
      console.log(`✅ No channels found matching "${query}"`);
      return NextResponse.json({ channels: [] });
    }

    // Simple deduplication by channel_id
    const uniqueChannels = new Map<string, any>();
    channels.forEach(channel => {
      if (!uniqueChannels.has(channel.channel_id)) {
        uniqueChannels.set(channel.channel_id, {
          channel_id: channel.channel_id,
          channel_name: channel.channel_name,
          channel_icon: channel.thumbnail_url,
          video_count: 0, // Not calculated for speed
          avg_performance: 0, // Not calculated for speed
          latest_video_date: new Date().toISOString()
        });
      }
    });

    const results: ChannelSearchResult[] = Array.from(uniqueChannels.values()).slice(0, limit);

    console.log(`✅ Found ${results.length} channels matching "${query}"`);

    return NextResponse.json({ channels: results });

  } catch (error) {
    console.error('❌ Channel search failed:', error);
    return NextResponse.json(
      { 
        error: 'Failed to search channels',
        details: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  }
}