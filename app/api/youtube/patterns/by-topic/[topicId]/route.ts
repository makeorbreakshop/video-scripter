import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

interface FormatPerformance {
  format: string;
  avgPerformance: number;
  videoCount: number;
  topVideo: any;
}

interface FormatTrend {
  format: string;
  trend: number; // percentage change
  direction: 'up' | 'down' | 'stable';
}

interface CrossNicheOpportunity {
  format: string;
  fromTopic: string;
  performance: number;
  adoptionRate: number;
  exampleVideo: any;
}

export async function GET(
  request: NextRequest,
  { params }: { params: { topicId: string } }
) {
  try {
    const topicId = params.topicId;
    
    // Get all videos for this topic
    const { data: topicVideos, error: topicError } = await supabase
      .from('videos')
      .select(`
        *,
        baseline_analytics(
          views,
          likes,
          comments
        )
      `)
      .eq('topic_level_3', topicId)
      .not('format_type', 'is', null);

    if (topicError) {
      console.error('Topic videos error:', topicError);
      return NextResponse.json({ error: 'Failed to fetch topic videos' }, { status: 500 });
    }

    // Calculate format performance for this topic
    const formatStats = (topicVideos || []).reduce((acc, video) => {
      const format = video.format_type;
      const baselineViews = video.baseline_analytics?.views || video.channel_avg_views || video.view_count || 1;
      const performanceRatio = baselineViews > 0
        ? (video.view_count || 0) / baselineViews
        : 0;

      if (!acc[format]) {
        acc[format] = {
          totalPerformance: 0,
          count: 0,
          videos: []
        };
      }
      
      acc[format].totalPerformance += performanceRatio;
      acc[format].count++;
      acc[format].videos.push({ ...video, performanceRatio });
      
      return acc;
    }, {} as Record<string, any>);

    // Create format performance array
    const topFormats: FormatPerformance[] = Object.entries(formatStats)
      .map(([format, stats]: [string, any]) => ({
        format,
        avgPerformance: stats.totalPerformance / stats.count,
        videoCount: stats.count,
        topVideo: stats.videos.sort((a: any, b: any) => b.performanceRatio - a.performanceRatio)[0]
      }))
      .sort((a, b) => b.avgPerformance - a.avgPerformance);

    // Get recent videos for trend analysis (last 30 days vs previous 30 days)
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    const sixtyDaysAgo = new Date();
    sixtyDaysAgo.setDate(sixtyDaysAgo.getDate() - 60);

    const { data: recentVideos } = await supabase
      .from('videos')
      .select('format_type, published_at, view_count')
      .eq('topic_level_3', topicId)
      .gte('published_at', sixtyDaysAgo.toISOString())
      .not('format_type', 'is', null);

    // Calculate trends
    const emergingFormats: FormatTrend[] = [];
    if (recentVideos) {
      const formatsByPeriod = recentVideos.reduce((acc, video) => {
        const format = video.format_type;
        const isRecent = new Date(video.published_at) >= thirtyDaysAgo;
        const period = isRecent ? 'recent' : 'previous';
        
        if (!acc[format]) {
          acc[format] = { recent: 0, previous: 0 };
        }
        acc[format][period]++;
        
        return acc;
      }, {} as Record<string, any>);

      Object.entries(formatsByPeriod).forEach(([format, counts]: [string, any]) => {
        const trend = counts.previous > 0 
          ? ((counts.recent - counts.previous) / counts.previous) * 100
          : counts.recent > 0 ? 100 : 0;
        
        emergingFormats.push({
          format,
          trend,
          direction: trend > 10 ? 'up' : trend < -10 ? 'down' : 'stable'
        });
      });
    }

    // Find cross-niche opportunities
    // Get the parent topic (level 2) to find adjacent topics
    const { data: currentTopicData } = await supabase
      .from('videos')
      .select('topic_level_2')
      .eq('topic_level_3', topicId)
      .limit(1)
      .single();

    const crossNicheOpportunities: CrossNicheOpportunity[] = [];
    
    if (currentTopicData?.topic_level_2) {
      // Get high-performing formats from adjacent topics
      const { data: adjacentVideos } = await supabase
        .from('videos')
        .select(`
          *,
          baseline_analytics(views)
        `)
        .eq('topic_level_2', currentTopicData.topic_level_2)
        .neq('topic_level_3', topicId)
        .not('format_type', 'is', null)
        .limit(1000);

      if (adjacentVideos) {
        // Find formats that work well in adjacent topics but are underused in current topic
        const adjacentFormatStats = adjacentVideos.reduce((acc, video) => {
          const format = video.format_type;
          const baselineViews = video.baseline_analytics?.views || video.channel_avg_views || video.view_count || 1;
          const performanceRatio = baselineViews > 0
            ? (video.view_count || 0) / baselineViews
            : 0;

          if (!acc[format]) {
            acc[format] = {
              totalPerformance: 0,
              count: 0,
              topVideo: null,
              topics: new Set()
            };
          }
          
          acc[format].totalPerformance += performanceRatio;
          acc[format].count++;
          acc[format].topics.add(video.topic_level_3);
          
          if (!acc[format].topVideo || performanceRatio > acc[format].topVideo.performanceRatio) {
            acc[format].topVideo = { ...video, performanceRatio };
          }
          
          return acc;
        }, {} as Record<string, any>);

        // Compare with current topic usage
        Object.entries(adjacentFormatStats).forEach(([format, stats]: [string, any]) => {
          const avgAdjacentPerformance = stats.totalPerformance / stats.count;
          const currentTopicUsage = formatStats[format]?.count || 0;
          const totalVideosInTopic = topicVideos?.length || 1;
          const adoptionRate = currentTopicUsage / totalVideosInTopic;
          
          // Opportunity: High performance in adjacent topics, low adoption in current topic
          if (avgAdjacentPerformance > 1.5 && adoptionRate < 0.1) {
            crossNicheOpportunities.push({
              format,
              fromTopic: stats.topVideo.topic_level_3,
              performance: avgAdjacentPerformance,
              adoptionRate,
              exampleVideo: stats.topVideo
            });
          }
        });
      }
    }

    // Saturation warnings
    const saturationWarnings: string[] = [];
    topFormats.forEach(({ format, videoCount, avgPerformance }) => {
      const totalVideos = topicVideos?.length || 1;
      const saturationRate = videoCount / totalVideos;
      
      if (saturationRate > 0.3 && avgPerformance < 1) {
        saturationWarnings.push(
          `${format} format is oversaturated (${Math.round(saturationRate * 100)}% of videos) with declining performance`
        );
      }
    });

    return NextResponse.json({
      topFormats: topFormats.slice(0, 5),
      emergingFormats: emergingFormats.filter(f => f.direction === 'up').slice(0, 5),
      crossNicheOpportunities: crossNicheOpportunities.slice(0, 5),
      saturationWarnings,
      summary: {
        totalVideos: topicVideos?.length || 0,
        avgTopicPerformance: topFormats.reduce((sum, f) => sum + f.avgPerformance, 0) / topFormats.length || 0,
        formatDiversity: topFormats.length
      }
    });

  } catch (error) {
    console.error('Pattern analysis error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}