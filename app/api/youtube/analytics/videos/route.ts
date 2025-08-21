/**
 * YouTube Analytics Videos API Route
 * Returns video performance data for the analytics table
 */

import { NextRequest, NextResponse } from 'next/server';
import { getSupabase } from '@/lib/supabase-lazy';

// Helper function to check if a video is a YouTube Short based on duration
function isYouTubeShort(duration: string | null): boolean {
  if (!duration) return false;
  
  // Parse ISO 8601 duration format (PT1M30S = 1 minute 30 seconds)
  const match = duration.match(/PT(?:(\d+)M)?(?:(\d+)S)?/);
  if (!match) return false;
  
  const minutes = parseInt(match[1] || '0');
  const seconds = parseInt(match[2] || '0');
  const totalSeconds = minutes * 60 + seconds;
  
  // YouTube Shorts are 60 seconds or less
  return totalSeconds <= 60;
}

export async function GET(request: NextRequest) {
  const supabase = getSupabase();
  try {
    const { searchParams } = new URL(request.url);
    const limit = parseInt(searchParams.get('limit') || '100');
    const offset = parseInt(searchParams.get('offset') || '0');

    // Get videos with their latest analytics data
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

    // Get videos with baseline analytics (only Make or Break Shop channel, exclude Shorts)
    const { data: videos, error: videosError } = await supabase
      .from('videos')
      .select(`
        id,
        title,
        published_at,
        view_count,
        like_count,
        comment_count,
        duration,
        baseline_analytics!inner (
          views,
          likes,
          comments,
          average_view_percentage
        )
      `)
      .eq('channel_name', 'Make or Break Shop')
      .order('published_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (videosError) {
      console.error('Error fetching videos:', videosError);
      throw videosError;
    }

    if (!videos || videos.length === 0) {
      return NextResponse.json([]);
    }

    // Get analytics data for these videos
    const videoIds = videos.map(v => v.id);
    
    // Get recent analytics (last 30 days)
    const { data: recentAnalytics, error: recentError } = await supabase
      .from('daily_analytics')
      .select('video_id, date, views, average_view_percentage, likes, comments')
      .in('video_id', videoIds)
      .gte('date', thirtyDaysAgo)
      .order('date', { ascending: false });

    if (recentError) {
      console.error('Error fetching recent analytics:', recentError);
    }

    // Get older analytics for trend comparison (30-37 days ago)
    const { data: olderAnalytics, error: olderError } = await supabase
      .from('daily_analytics')
      .select('video_id, date, views, average_view_percentage, likes, comments')
      .in('video_id', videoIds)
      .gte('date', new Date(Date.now() - 37 * 24 * 60 * 60 * 1000).toISOString().split('T')[0])
      .lt('date', thirtyDaysAgo)
      .order('date', { ascending: false });

    if (olderError) {
      console.error('Error fetching older analytics:', olderError);
    }

    // Filter out YouTube Shorts and process data for each video
    const longFormVideos = videos.filter(video => !isYouTubeShort(video.duration));
    
    const videoAnalytics = longFormVideos.map(video => {
      // Get recent analytics for this video
      const videoRecentAnalytics = recentAnalytics?.filter(a => a.video_id === video.id) || [];
      const videoOlderAnalytics = olderAnalytics?.filter(a => a.video_id === video.id) || [];

      // Calculate averages for recent period
      const recentTotals = videoRecentAnalytics.reduce(
        (acc, record) => ({
          views: acc.views + (record.views || 0),
          likes: acc.likes + (record.likes || 0),
          comments: acc.comments + (record.comments || 0),
          ctr: record.ctr ? acc.ctr + record.ctr : acc.ctr,
          retention: record.retention_avg ? acc.retention + record.retention_avg : acc.retention,
          ctrCount: record.ctr ? acc.ctrCount + 1 : acc.ctrCount,
          retentionCount: record.retention_avg ? acc.retentionCount + 1 : acc.retentionCount,
          count: acc.count + 1,
        }),
        { views: 0, likes: 0, comments: 0, ctr: 0, retention: 0, ctrCount: 0, retentionCount: 0, count: 0 }
      );

      // Calculate averages for older period
      const olderTotals = videoOlderAnalytics.reduce(
        (acc, record) => ({
          views: acc.views + (record.views || 0),
          count: acc.count + 1,
        }),
        { views: 0, count: 0 }
      );

      // Calculate trend
      const calculateTrend = (recent: number, older: number) => {
        if (older === 0) return { direction: 'stable' as const, percentage: 0 };
        const change = ((recent - older) / older) * 100;
        
        if (Math.abs(change) < 5) return { direction: 'stable' as const, percentage: change };
        return { 
          direction: change > 0 ? 'up' as const : 'down' as const, 
          percentage: Math.abs(change) 
        };
      };

      const recentAvgViews = recentTotals.count > 0 ? recentTotals.views / recentTotals.count : 0;
      const olderAvgViews = olderTotals.count > 0 ? olderTotals.views / olderTotals.count : 0;
      const trend = calculateTrend(recentAvgViews, olderAvgViews);

      // Use baseline analytics for comprehensive data
      const baseline = video.baseline_analytics?.[0];
      
      return {
        video_id: video.id,
        title: video.title,
        published_at: video.published_at,
        views: baseline?.views || video.view_count || 0,
        ctr: undefined, // Not available in our data yet
        retention_avg: baseline?.average_view_percentage ? baseline.average_view_percentage / 100 : undefined,
        likes: baseline?.likes || video.like_count || 0,
        comments: baseline?.comments || video.comment_count || 0,
        trend_direction: trend.direction,
        trend_percentage: trend.percentage,
      };
    });

    return NextResponse.json(videoAnalytics);

  } catch (error) {
    console.error('Error fetching video analytics:', error);
    return NextResponse.json(
      { error: 'Failed to fetch video analytics' },
      { status: 500 }
    );
  }
}