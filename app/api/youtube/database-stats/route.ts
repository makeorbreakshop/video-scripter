import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

export async function GET(request: NextRequest) {
  try {
    // Use the materialized view for fast analytics statistics
    const { data: stats, error } = await supabase
      .from('analytics_stats')
      .select('*')
      .single();

    if (error) {
      console.error('Error fetching analytics stats from materialized view:', error);
      throw error;
    }

    // Transform the data to match the expected format
    const response = {
      totalVideos: stats.total_videos || 0,
      totalChannels: stats.total_channels || 0,
      competitorVideos: stats.competitor_videos || 0,
      competitorChannels: stats.competitor_channels || 0,
      rssMonitoredChannels: stats.rss_monitored_channels || 0,
      embeddedVideos: stats.embedded_videos || 0,
      recentVideos: stats.recent_videos || 0,
      averageViews: stats.average_views || 0
    };

    return NextResponse.json(response);

  } catch (error) {
    console.error('Error fetching database stats:', error);
    return NextResponse.json(
      { error: 'Failed to fetch database statistics' },
      { status: 500 }
    );
  }
}