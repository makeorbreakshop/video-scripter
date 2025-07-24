import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { Database } from '@/types/database';

const supabase = createClient<Database>(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const channelName = searchParams.get('channel') || 'Make or Break Shop';

  try {
    // Get monthly aggregated performance over time
    const { data: monthlyData, error } = await supabase
      .from('videos')
      .select('published_at, view_count')
      .eq('channel_name', channelName)
      .order('published_at', { ascending: true });

    if (error) throw error;

    // Aggregate by month
    const monthlyStats = new Map<string, { views: number; videos: number; totalViews: number }>();
    
    monthlyData?.forEach(video => {
      const date = new Date(video.published_at);
      const monthKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
      
      const existing = monthlyStats.get(monthKey) || { views: 0, videos: 0, totalViews: 0 };
      existing.views += video.view_count;
      existing.videos += 1;
      existing.totalViews += video.view_count;
      monthlyStats.set(monthKey, existing);
    });

    // Calculate cumulative views and growth
    let cumulativeViews = 0;
    const timeline = Array.from(monthlyStats.entries())
      .map(([month, stats]) => {
        cumulativeViews += stats.views;
        const avgViews = stats.videos > 0 ? Math.round(stats.views / stats.videos) : 0;
        
        return {
          month,
          videos: stats.videos,
          avgViews,
          totalViews: stats.totalViews,
          cumulativeViews,
        };
      });

    // Calculate growth rate
    const recentMonths = timeline.slice(-6);
    const olderMonths = timeline.slice(-12, -6);
    
    const recentAvg = recentMonths.reduce((sum, m) => sum + m.avgViews, 0) / recentMonths.length;
    const olderAvg = olderMonths.reduce((sum, m) => sum + m.avgViews, 0) / olderMonths.length;
    const growthRate = olderAvg > 0 ? ((recentAvg - olderAvg) / olderAvg) * 100 : 0;

    return NextResponse.json({
      timeline,
      summary: {
        totalMonths: timeline.length,
        totalVideos: monthlyData?.length || 0,
        growthRate: Math.round(growthRate),
        recentAvgViews: Math.round(recentAvg),
        totalChannelViews: cumulativeViews,
      }
    });
  } catch (error) {
    console.error('Error fetching growth timeline:', error);
    return NextResponse.json(
      { error: 'Failed to fetch growth timeline' },
      { status: 500 }
    );
  }
}