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
    // Get format performance data
    const { data: videos, error } = await supabase
      .from('videos')
      .select('id, title, view_count, published_at, format_type, topic_level_1, topic_level_2, topic_level_3')
      .eq('channel_name', channelName)
      .gte('published_at', new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toISOString())
      .gt('view_count', 0);

    if (error) throw error;

    // Analyze by format
    const formatStats = new Map<string, { count: number; totalViews: number; avgViews: number; topVideo: any }>();
    
    videos?.forEach(video => {
      const format = video.format_type || 'unknown';
      const existing = formatStats.get(format) || { count: 0, totalViews: 0, avgViews: 0, topVideo: null };
      
      existing.count += 1;
      existing.totalViews += video.view_count;
      
      if (!existing.topVideo || video.view_count > existing.topVideo.view_count) {
        existing.topVideo = video;
      }
      
      formatStats.set(format, existing);
    });

    // Calculate averages and sort
    const formats = Array.from(formatStats.entries())
      .map(([format, stats]) => ({
        format,
        count: stats.count,
        avgViews: Math.round(stats.totalViews / stats.count),
        totalViews: stats.totalViews,
        topVideo: stats.topVideo ? {
          title: stats.topVideo.title,
          views: stats.topVideo.view_count,
        } : null,
      }))
      .sort((a, b) => b.avgViews - a.avgViews);

    // Get topic insights
    const topicCounts = new Map<number, number>();
    videos?.forEach(video => {
      if (video.topic_level_3 !== null && video.topic_level_3 !== -1) {
        topicCounts.set(video.topic_level_3, (topicCounts.get(video.topic_level_3) || 0) + 1);
      }
    });

    const topTopics = Array.from(topicCounts.entries())
      .map(([topic, count]) => ({ topic, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);

    return NextResponse.json({
      formats,
      topTopics,
      summary: {
        totalFormats: formats.length,
        bestPerformingFormat: formats[0],
        totalVideosAnalyzed: videos?.length || 0,
      }
    });
  } catch (error) {
    console.error('Error fetching format analysis:', error);
    return NextResponse.json(
      { error: 'Failed to fetch format analysis' },
      { status: 500 }
    );
  }
}