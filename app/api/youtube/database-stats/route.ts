import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

export async function GET(request: NextRequest) {
  try {
    // Use simple count queries instead of fetching all data
    const [
      totalVideosResult,
      competitorVideosResult,
      embeddedVideosResult,
      totalChannelsResult,
      competitorChannelsResult,
      rssChannelsResult,
      recentVideosResult
    ] = await Promise.all([
      // Total videos
      supabase
        .from('videos')
        .select('*', { count: 'exact', head: true })
        .not('channel_id', 'is', null),
      
      // Competitor videos
      supabase
        .from('videos')
        .select('*', { count: 'exact', head: true })
        .eq('is_competitor', true)
        .not('channel_id', 'is', null),
      
      // Embedded videos
      supabase
        .from('videos')
        .select('*', { count: 'exact', head: true })
        .eq('pinecone_embedded', true)
        .not('channel_id', 'is', null),
      
      // Total channels
      supabase
        .from('videos')
        .select('channel_id')
        .not('channel_id', 'is', null),
      
      // Competitor channels
      supabase
        .from('videos')
        .select('channel_id')
        .eq('is_competitor', true)
        .not('channel_id', 'is', null),
      
      // RSS monitored channels
      supabase
        .from('videos')
        .select('channel_id, metadata')
        .eq('is_competitor', true)
        .not('channel_id', 'is', null),
      
      // Recent videos (last 30 days)
      supabase
        .from('videos')
        .select('*', { count: 'exact', head: true })
        .gte('created_at', new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString())
        .not('channel_id', 'is', null)
    ]);

    const totalVideos = totalVideosResult.count || 0;
    const competitorVideos = competitorVideosResult.count || 0;
    const embeddedVideos = embeddedVideosResult.count || 0;
    const recentVideos = recentVideosResult.count || 0;

    // Calculate unique channels
    const uniqueChannels = new Set(totalChannelsResult.data?.map(c => c.channel_id) || []);
    const competitorChannels = new Set(competitorChannelsResult.data?.map(c => c.channel_id) || []);
    const rssMonitoredChannels = new Set(
      rssChannelsResult.data?.filter(c => 
        c.metadata?.youtube_channel_id && 
        c.metadata.youtube_channel_id.startsWith('UC')
      )?.map(c => c.channel_id) || []
    );

    const stats = {
      totalVideos,
      totalChannels: uniqueChannels.size,
      competitorVideos,
      competitorChannels: competitorChannels.size,
      rssMonitoredChannels: rssMonitoredChannels.size,
      embeddedVideos,
      recentVideos,
      averageViews: 0
    };

    return NextResponse.json(stats);

  } catch (error) {
    console.error('Error fetching database stats:', error);
    return NextResponse.json(
      { error: 'Failed to fetch database statistics' },
      { status: 500 }
    );
  }
}