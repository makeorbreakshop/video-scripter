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

    // Search for channels matching the query
    const { data: channels, error } = await supabase
      .from('videos')
      .select('channel_id, channel_name, thumbnail_url, temporal_performance_score, published_at')
      .ilike('channel_name', `%${query}%`)
      .order('published_at', { ascending: false });

    if (error) {
      console.error('❌ Channel search failed:', error);
      throw error;
    }

    // Group by channel and calculate stats
    const channelMap = new Map<string, {
      channel_id: string;
      channel_name: string;
      channel_icon?: string;
      video_count: number;
      total_score: number;
      latest_date?: string;
    }>();

    channels?.forEach(video => {
      const existing = channelMap.get(video.channel_id);
      if (existing) {
        existing.video_count++;
        existing.total_score += video.temporal_performance_score || 0;
        if (!existing.latest_date || video.published_at > existing.latest_date) {
          existing.latest_date = video.published_at;
        }
      } else {
        channelMap.set(video.channel_id, {
          channel_id: video.channel_id,
          channel_name: video.channel_name,
          channel_icon: video.thumbnail_url, // Use latest thumbnail as icon
          video_count: 1,
          total_score: video.temporal_performance_score || 0,
          latest_date: video.published_at
        });
      }
    });

    // Convert to array and calculate averages
    const results: ChannelSearchResult[] = Array.from(channelMap.values())
      .map(ch => ({
        channel_id: ch.channel_id,
        channel_name: ch.channel_name,
        channel_icon: ch.channel_icon,
        video_count: ch.video_count,
        avg_performance: ch.video_count > 0 ? ch.total_score / ch.video_count : 0,
        latest_video_date: ch.latest_date
      }))
      .sort((a, b) => b.video_count - a.video_count) // Sort by video count
      .slice(0, limit);

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