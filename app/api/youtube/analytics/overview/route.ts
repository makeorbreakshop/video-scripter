/**
 * YouTube Analytics Overview API Route
 * Returns channel performance summary using daily analytics and baseline data
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

export async function GET(request: NextRequest) {
  try {
    // Calculate date ranges
    const now = new Date();
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

    // Get recent 7-day performance
    const { data: recent7Days, error: recent7Error } = await supabase
      .from('daily_analytics')
      .select('views, estimated_minutes_watched, likes, comments, average_view_percentage')
      .gte('date', sevenDaysAgo);

    if (recent7Error) {
      console.error('Error fetching 7-day data:', recent7Error);
    }

    // Get 30-day performance for trends
    const { data: recent30Days, error: recent30Error } = await supabase
      .from('daily_analytics')
      .select('views, estimated_minutes_watched, likes, comments, average_view_percentage')
      .gte('date', thirtyDaysAgo);

    if (recent30Error) {
      console.error('Error fetching 30-day data:', recent30Error);
    }

    // Get baseline totals for lifetime context
    const { data: baselineData, error: baselineError } = await supabase
      .from('baseline_analytics')
      .select(`
        views, 
        estimated_minutes_watched, 
        likes, 
        comments, 
        average_view_percentage,
        videos!inner(duration, channel_id)
      `)
      .eq('videos.channel_id', 'Make or Break Shop');

    if (baselineError) {
      console.error('Error fetching baseline data:', baselineError);
    }

    // Calculate 7-day totals
    const last7Days = recent7Days || [];
    const totalViews7d = last7Days.reduce((sum, day) => sum + (day.views || 0), 0);
    const totalWatchMinutes7d = last7Days.reduce((sum, day) => sum + (day.estimated_minutes_watched || 0), 0);
    const totalLikes7d = last7Days.reduce((sum, day) => sum + (day.likes || 0), 0);
    const totalComments7d = last7Days.reduce((sum, day) => sum + (day.comments || 0), 0);
    const avgRetention7d = last7Days.length > 0 
      ? last7Days.reduce((sum, day) => sum + (day.average_view_percentage || 0), 0) / last7Days.length
      : 0;

    // Calculate 30-day averages for trends
    const last30Days = recent30Days || [];
    const totalViews30d = last30Days.reduce((sum, day) => sum + (day.views || 0), 0);
    const avgViewsPerDay30d = totalViews30d / 30;
    const avgViewsPerDay7d = totalViews7d / 7;

    // Calculate trends (7-day average vs 30-day average)
    const viewsTrend = avgViewsPerDay30d > 0 ? ((avgViewsPerDay7d - avgViewsPerDay30d) / avgViewsPerDay30d) * 100 : 0;

    // Helper function to check if a video is a YouTube Short
    function isYouTubeShort(duration: string | null): boolean {
      if (!duration) return false;
      const match = duration.match(/PT(?:(\d+)M)?(?:(\d+)S)?/);
      if (!match) return false;
      const minutes = parseInt(match[1] || '0');
      const seconds = parseInt(match[2] || '0');
      const totalSeconds = minutes * 60 + seconds;
      return totalSeconds <= 60;
    }

    // Get baseline totals for context (exclude Shorts)
    const baseline = baselineData || [];
    const longFormBaseline = baseline.filter(video => !isYouTubeShort(video.videos?.duration));
    const lifetimeViews = longFormBaseline.reduce((sum, video) => sum + (video.views || 0), 0);
    const lifetimeLikes = longFormBaseline.reduce((sum, video) => sum + (video.likes || 0), 0);

    // Calculate channel averages from baseline (long-form videos only)
    const channelAvgViews = longFormBaseline.length > 0 ? lifetimeViews / longFormBaseline.length : 0;
    const channelAvgRetention = longFormBaseline.length > 0 
      ? longFormBaseline.reduce((sum, video) => sum + (video.average_view_percentage || 0), 0) / longFormBaseline.length
      : 0;

    const response = {
      // Recent performance (7 days)
      totalViews: totalViews7d,
      totalLikes: lifetimeLikes, // Use baseline data since daily likes are null
      totalComments: totalComments7d,
      averageRetention: avgRetention7d, // Keep as percentage
      
      // Trends (7-day vs 30-day average)
      trendViews: viewsTrend,
      trendCTR: 0, // We don't have CTR in daily_analytics yet
      trendRetention: 0, // Would need more historical comparison
      
      // Additional context
      watchHours: Math.round(totalWatchMinutes7d / 60),
      dailyAverage: Math.round(avgViewsPerDay7d),
      
      // Lifetime context
      lifetimeViews,
      lifetimeLikes,
      channelAverage: Math.round(channelAvgViews),
      
      // Data info
      daysOfData: last7Days.length,
      lastUpdated: new Date().toISOString(),
    };

    return NextResponse.json(response);

  } catch (error) {
    console.error('Error fetching channel overview:', error);
    return NextResponse.json(
      { error: 'Failed to fetch channel overview' },
      { status: 500 }
    );
  }
}