import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const search = searchParams.get('search') || '';
    const sortBy = searchParams.get('sortBy') || 'performance_percent';
    const sortOrder = searchParams.get('sortOrder') || 'desc';
    const performanceFilter = searchParams.get('performanceFilter');
    const dateFilter = searchParams.get('dateFilter');

    // Get channel baseline from baseline_analytics table (more current data)
    const { data: baselineData, error: baselineError } = await supabase
      .from('videos')
      .select(`
        baseline_analytics!inner (
          views
        )
      `)
      .eq('channel_id', 'Make or Break Shop');

    if (baselineError) {
      console.error('Baseline calculation error:', baselineError);
      return NextResponse.json({ error: 'Failed to calculate baseline' }, { status: 500 });
    }

    const channelBaseline = baselineData && baselineData.length > 0 
      ? baselineData.reduce((sum, video) => sum + (video.baseline_analytics?.[0]?.views || 0), 0) / baselineData.length
      : 0;

    // Base query for videos with baseline analytics (current view counts)
    let query = supabase
      .from('videos')
      .select(`
        id,
        title,
        published_at,
        baseline_analytics!inner (
          views
        )
      `)
      .eq('channel_id', 'Make or Break Shop');

    // Apply search filter
    if (search) {
      query = query.ilike('title', `%${search}%`);
    }

    // Apply date filter
    if (dateFilter && dateFilter !== 'all') {
      const now = new Date();
      let dateThreshold: Date;
      
      switch (dateFilter) {
        case '30days':
          dateThreshold = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
          break;
        case '3months':
          dateThreshold = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
          break;
        case '6months':
          dateThreshold = new Date(now.getTime() - 180 * 24 * 60 * 60 * 1000);
          break;
        case '1year':
          dateThreshold = new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000);
          break;
        default:
          dateThreshold = new Date(0);
      }
      
      query = query.gte('published_at', dateThreshold.toISOString());
    }

    // Apply sorting (only for columns we can sort at DB level)
    const validSortColumns = ['published_at', 'title'];
    if (validSortColumns.includes(sortBy)) {
      query = query.order(sortBy, { ascending: sortOrder === 'asc' });
    } else {
      // Default to published_at for now, we'll calculate performance_percent after
      query = query.order('published_at', { ascending: false });
    }

    const { data: videos, error } = await query;

    if (error) {
      console.error('Database error:', error);
      return NextResponse.json({ error: 'Failed to fetch packaging data' }, { status: 500 });
    }

    if (!videos || videos.length === 0) {
      return NextResponse.json({ data: [] });
    }

    // Process data to add calculated fields using channel baseline
    const processedData = videos.map(video => {
      const currentViews = video.baseline_analytics?.[0]?.views || 0;
      const performanceMultiplier = channelBaseline > 0 
        ? (currentViews - channelBaseline) / channelBaseline
        : 0;

      return {
        id: video.id,
        title: video.title,
        view_count: currentViews, // Use baseline_analytics views (more current)
        published_at: video.published_at,
        baseline_views: Math.round(channelBaseline), // Same baseline for all videos
        performance_percent: Math.round(performanceMultiplier * 100) / 100, // Round to 2 decimals
        thumbnail_url: `https://img.youtube.com/vi/${video.id}/maxresdefault.jpg`
      };
    });

    // Apply performance filter
    let filteredData = processedData;
    if (performanceFilter) {
      filteredData = processedData.filter(video => {
        switch (performanceFilter) {
          case 'excellent':
            return video.performance_percent > 2.0; // 200% above baseline
          case 'good':
            return video.performance_percent >= 0 && video.performance_percent <= 2.0;
          case 'average':
            return video.performance_percent >= -0.5 && video.performance_percent < 0;
          case 'poor':
            return video.performance_percent < -0.5; // 50% below baseline
          default:
            return true;
        }
      });
    }

    // Sort by calculated fields if requested
    if (sortBy === 'performance_percent') {
      filteredData.sort((a, b) => {
        if (sortOrder === 'asc') {
          return a.performance_percent - b.performance_percent;
        }
        return b.performance_percent - a.performance_percent;
      });
    } else if (sortBy === 'view_count') {
      filteredData.sort((a, b) => {
        if (sortOrder === 'asc') {
          return a.view_count - b.view_count;
        }
        return b.view_count - a.view_count;
      });
    }

    return NextResponse.json({ data: filteredData });
  } catch (error) {
    console.error('API error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}