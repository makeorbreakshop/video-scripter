import { NextRequest, NextResponse } from 'next/server';
import { getSupabase } from '@/lib/supabase-lazy';


interface SearchRequest {
  query?: string;
  topics?: string[];
  formats?: string[];
  performanceMin?: number;
  performanceMax?: number;
  timeRange?: {
    start: string;
    end: string;
  };
  includeAdjacentTopics?: boolean;
  limit?: number;
  offset?: number;
}

export async function POST(request: NextRequest) {
  const supabase = getSupabase();
  try {
    const body: SearchRequest = await request.json();
    const {
      query,
      topics = [],
      formats = [],
      performanceMin,
      performanceMax,
      timeRange,
      includeAdjacentTopics = false,
      limit = 50,
      offset = 0
    } = body;

    // Build the base query
    let queryBuilder = supabase
      .from('videos')
      .select(`
        *,
        baseline_analytics!inner(
          baseline_views,
          baseline_likes,
          baseline_comments
        )
      `)
      .order('published_at', { ascending: false })
      .range(offset, offset + limit - 1);

    // Apply text search if provided
    if (query) {
      queryBuilder = queryBuilder.or(`title.ilike.%${query}%,description.ilike.%${query}%`);
    }

    // Apply topic filters
    if (topics.length > 0) {
      if (includeAdjacentTopics) {
        // Get related topics from the same parent categories
        const { data: relatedTopics } = await supabase
          .from('videos')
          .select('topic_level_2')
          .in('topic_level_3', topics)
          .limit(1000);
        
        const adjacentTopics = [...new Set(relatedTopics?.map(v => v.topic_level_2) || [])];
        queryBuilder = queryBuilder.in('topic_level_2', adjacentTopics);
      } else {
        queryBuilder = queryBuilder.in('topic_level_3', topics);
      }
    }

    // Apply format filters
    if (formats.length > 0) {
      queryBuilder = queryBuilder.in('format_type', formats);
    }

    // Apply time range filter
    if (timeRange) {
      queryBuilder = queryBuilder
        .gte('published_at', timeRange.start)
        .lte('published_at', timeRange.end);
    }

    // Execute the query
    const { data: videos, error, count } = await queryBuilder;

    if (error) {
      console.error('Search error:', error);
      return NextResponse.json({ error: 'Search failed' }, { status: 500 });
    }

    // Calculate performance metrics
    const videosWithPerformance = videos?.map(video => {
      const baselineViews = video.baseline_analytics?.baseline_views || 0;
      const actualViews = video.view_count || 0;
      const performanceRatio = baselineViews > 0 ? actualViews / baselineViews : 0;

      return {
        ...video,
        performance_ratio: performanceRatio,
        performance_category: 
          performanceRatio >= 2 ? 'high' :
          performanceRatio >= 0.5 ? 'medium' : 'low'
      };
    }) || [];

    // Apply performance filters after calculation
    let filteredVideos = videosWithPerformance;
    if (performanceMin !== undefined) {
      filteredVideos = filteredVideos.filter(v => v.performance_ratio >= performanceMin);
    }
    if (performanceMax !== undefined) {
      filteredVideos = filteredVideos.filter(v => v.performance_ratio <= performanceMax);
    }

    // Group by format for insights
    const formatInsights = formats.length === 0 ? 
      Object.entries(
        filteredVideos.reduce((acc, video) => {
          const format = video.format_type || 'unknown';
          if (!acc[format]) {
            acc[format] = { count: 0, avgPerformance: 0, totalViews: 0 };
          }
          acc[format].count++;
          acc[format].totalViews += video.view_count || 0;
          acc[format].avgPerformance += video.performance_ratio;
          return acc;
        }, {} as Record<string, any>)
      ).map(([format, stats]) => ({
        format,
        count: stats.count,
        avgPerformance: stats.avgPerformance / stats.count,
        avgViews: stats.totalViews / stats.count
      })).sort((a, b) => b.avgPerformance - a.avgPerformance)
      : [];

    return NextResponse.json({
      videos: filteredVideos,
      total: count || filteredVideos.length,
      insights: {
        formatPerformance: formatInsights,
        topPerformer: filteredVideos[0],
        avgPerformance: filteredVideos.reduce((sum, v) => sum + v.performance_ratio, 0) / filteredVideos.length
      }
    });

  } catch (error) {
    console.error('Advanced search error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}