/**
 * YouTube Analytics Top Performers API Route
 * Returns top performing videos for charts
 */

import { NextRequest, NextResponse } from 'next/server';
import { getSupabase } from '@/lib/supabase-lazy';

export async function GET(request: NextRequest) {
  const supabase = getSupabase();
  try {
    const { searchParams } = new URL(request.url);
    const days = parseInt(searchParams.get('days') || '30');
    const limit = parseInt(searchParams.get('limit') || '10');

    const startDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

    // Get top performing videos by total views in the period
    const { data, error } = await supabase
      .from('daily_analytics')
      .select(`
        video_id,
        views,
        average_view_percentage,
        likes,
        comments,
        videos!inner(title, published_at)
      `)
      .gte('date', startDate);

    if (error) {
      console.error('Error fetching top performers data:', error);
      throw error;
    }

    if (!data || data.length === 0) {
      return NextResponse.json([]);
    }

    // Group by video and sum views
    const videoPerformance = data.reduce((acc, record) => {
      const videoId = record.video_id;
      if (!acc[videoId]) {
        acc[videoId] = {
          video_id: videoId,
          title: (record.videos as any)?.title,
          published_at: (record.videos as any)?.published_at,
          views: 0,
          ctr: 0,
          retention: 0,
          likes: 0,
          comments: 0,
          ctrCount: 0,
          retentionCount: 0,
        };
      }

      acc[videoId].views += record.views || 0;
      acc[videoId].likes += record.likes || 0;
      acc[videoId].comments += record.comments || 0;

      if (record.ctr !== null && record.ctr !== undefined) {
        acc[videoId].ctr += record.ctr;
        acc[videoId].ctrCount += 1;
      }

      if (record.retention_avg !== null && record.retention_avg !== undefined) {
        acc[videoId].retention += record.retention_avg;
        acc[videoId].retentionCount += 1;
      }

      return acc;
    }, {} as Record<string, any>);

    // Convert to array, calculate averages, and sort by views
    const topPerformers = Object.values(videoPerformance)
      .map((video: any) => ({
        video_id: video.video_id,
        title: video.title,
        published_at: video.published_at,
        views: video.views,
        ctr: video.ctrCount > 0 ? video.ctr / video.ctrCount : 0,
        retention: video.retentionCount > 0 ? video.retention / video.retentionCount : 0,
        likes: video.likes,
        comments: video.comments,
      }))
      .sort((a, b) => b.views - a.views)
      .slice(0, limit);

    return NextResponse.json(topPerformers);

  } catch (error) {
    console.error('Error fetching top performers data:', error);
    return NextResponse.json(
      { error: 'Failed to fetch top performers data' },
      { status: 500 }
    );
  }
}