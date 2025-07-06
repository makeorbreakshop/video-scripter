import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

export async function GET(request: NextRequest) {
  try {
    // Get basic counts using exact count queries
    const [
      totalVideosResult,
      competitorVideosResult,
      embeddedVideosResult,
      recentVideosResult
    ] = await Promise.all([
      supabase.from('videos').select('*', { count: 'exact', head: true }),
      supabase.from('videos').select('*', { count: 'exact', head: true }).eq('is_competitor', true),
      supabase.from('videos').select('*', { count: 'exact', head: true }).eq('pinecone_embedded', true),
      supabase.from('videos').select('*', { count: 'exact', head: true })
        .gte('created_at', new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString())
    ]);

    // For channel counts, we need to get all channel_ids and count unique ones
    // Use a chunked approach to handle large datasets
    let allChannels: string[] = [];
    let competitorChannels: string[] = [];
    let rssMonitoredChannels: string[] = [];
    
    let from = 0;
    const chunkSize = 1000;
    let hasMore = true;

    while (hasMore) {
      const { data: channelChunk, error } = await supabase
        .from('videos')
        .select('channel_id, is_competitor, metadata')
        .not('channel_id', 'is', null)
        .range(from, from + chunkSize - 1);

      if (error) {
        throw error;
      }

      if (!channelChunk || channelChunk.length === 0) {
        hasMore = false;
        break;
      }

      // Process this chunk
      for (const video of channelChunk) {
        if (video.channel_id) {
          allChannels.push(video.channel_id);
          
          if (video.is_competitor) {
            competitorChannels.push(video.channel_id);
            
            // Check if RSS monitored
            if (video.metadata?.youtube_channel_id && 
                video.metadata.youtube_channel_id.startsWith('UC')) {
              rssMonitoredChannels.push(video.channel_id);
            }
          }
        }
      }

      // Check if we got a full chunk (if not, we're done)
      if (channelChunk.length < chunkSize) {
        hasMore = false;
      } else {
        from += chunkSize;
      }
    }

    // Count unique channels
    const uniqueAllChannels = new Set(allChannels);
    const uniqueCompetitorChannels = new Set(competitorChannels);
    const uniqueRssChannels = new Set(rssMonitoredChannels);

    const stats = {
      totalVideos: totalVideosResult.count || 0,
      totalChannels: uniqueAllChannels.size,
      competitorVideos: competitorVideosResult.count || 0,
      competitorChannels: uniqueCompetitorChannels.size,
      rssMonitoredChannels: uniqueRssChannels.size,
      embeddedVideos: embeddedVideosResult.count || 0,
      recentVideos: recentVideosResult.count || 0,
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