import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

// Use service role for better performance with database functions
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  {
    auth: {
      autoRefreshToken: false,
      persistSession: false
    }
  }
);

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const search = searchParams.get('search') || '';
    const sortBy = searchParams.get('sortBy') || 'performance_ratio';
    const sortOrder = searchParams.get('sortOrder') || 'desc';
    const performanceFilter = searchParams.get('performanceFilter') || '';
    const dateFilter = searchParams.get('dateFilter') || 'all';
    const competitorFilter = searchParams.get('competitorFilter') || 'mine';
    const page = parseInt(searchParams.get('page') || '1');
    const limit = parseInt(searchParams.get('limit') || '24');
    const offset = (page - 1) * limit;

    console.log('🚀 Database function packaging API called with filters:', {
      search, sortBy, sortOrder, performanceFilter, dateFilter, competitorFilter, page, limit
    });

    const startTime = Date.now();

    // Single database function call - calculates everything server-side
    const { data: results, error } = await supabase.rpc('get_packaging_performance', {
      search_term: search,
      competitor_filter: competitorFilter,
      date_filter: dateFilter,
      performance_filter: performanceFilter,
      sort_by: sortBy,
      sort_order: sortOrder,
      page_limit: limit,
      page_offset: offset
    });

    const queryTime = Date.now() - startTime;

    if (error) {
      console.error('Database function error:', error);
      return NextResponse.json({ 
        error: 'Failed to fetch packaging data',
        details: error.message 
      }, { status: 500 });
    }

    if (!results || results.length === 0) {
      return NextResponse.json({ 
        data: [],
        total: 0,
        page,
        limit,
        message: 'No videos found matching your criteria'
      });
    }

    // Get total count from first result
    const totalCount = results[0]?.total_count || 0;

    // Transform results to match existing API interface
    const processedData = results.map((video: any) => ({
      id: video.id,
      title: video.title,
      view_count: video.view_count,
      published_at: video.published_at,
      baseline_views: video.channel_avg_views || 0,
      performance_percent: Number((video.performance_ratio || 0).toFixed(2)),
      thumbnail_url: video.thumbnail_url || `https://i.ytimg.com/vi/${video.id}/hqdefault.jpg`,
      is_competitor: video.is_competitor,
      channel_id: video.channel_id
    }));

    console.log(`⚡ Database function completed in ${queryTime}ms, returning ${processedData.length}/${totalCount} videos`);

    const totalPages = Math.ceil(totalCount / limit);
    const hasMore = page < totalPages;
    const hasPrevious = page > 1;

    return NextResponse.json({ 
      data: processedData,
      pagination: {
        page,
        limit,
        totalCount,
        totalPages,
        hasMore,
        hasPrevious
      },
      query_time_ms: queryTime,
      calculation_method: 'database_function',
      message: `Found ${totalCount} videos, showing page ${page}`
    });

  } catch (error) {
    console.error('API error:', error);
    return NextResponse.json({ 
      error: 'Internal server error',
      details: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 });
  }
}