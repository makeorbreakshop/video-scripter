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

    // Use the optimized materialized view instead of complex joins
    let query = supabase
      .from('mv_makeorbreak_dashboard')
      .select('*');

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

    // Apply performance filter at database level (much faster)
    if (performanceFilter) {
      query = query.eq('performance_category', performanceFilter);
    }

    // Apply sorting at database level (leveraging indexes)
    const sortMapping = {
      'performance_percent': 'performance_ratio',
      'view_count': 'view_count',
      'published_at': 'published_at',
      'title': 'title'
    };

    const dbSortColumn = sortMapping[sortBy] || 'view_count';
    query = query.order(dbSortColumn, { ascending: sortOrder === 'asc' });

    const { data: videos, error } = await query;

    if (error) {
      console.error('Database error:', error);
      return NextResponse.json({ error: 'Failed to fetch packaging data' }, { status: 500 });
    }

    if (!videos || videos.length === 0) {
      return NextResponse.json({ data: [] });
    }

    // Transform to match existing API interface (minimal processing needed)
    const processedData = videos.map(video => ({
      id: video.video_id,
      title: video.title,
      view_count: video.view_count,
      published_at: video.published_at,
      baseline_views: video.baseline_views,
      performance_percent: Number((video.performance_ratio || 0).toFixed(2)),
      thumbnail_url: video.thumbnail_url,
      // Additional data available from materialized view
      estimated_revenue: video.estimated_revenue,
      likes: video.likes,
      comments: video.comments,
      recent_avg_views: video.recent_avg_views,
      performance_category: video.performance_category
    }));

    return NextResponse.json({ data: processedData });
  } catch (error) {
    console.error('API error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}