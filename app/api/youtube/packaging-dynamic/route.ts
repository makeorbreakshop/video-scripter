import { NextRequest, NextResponse } from 'next/server';
import { getSupabase } from '@/lib/supabase-lazy';
import { calculateDynamicPerformanceRatios, getPerformanceFilter } from '@/lib/performance-calculator';


export async function GET(request: NextRequest) {
  const supabase = getSupabase();
  try {
    const { searchParams } = new URL(request.url);
    const search = searchParams.get('search') || '';
    const sortBy = searchParams.get('sortBy') || 'performance_percent';
    const sortOrder = searchParams.get('sortOrder') || 'desc';
    const performanceFilter = searchParams.get('performanceFilter');
    const dateFilter = searchParams.get('dateFilter');
    const competitorFilter = searchParams.get('competitorFilter') || 'mine';

    console.log('🔍 Dynamic packaging API called with filters:', {
      search, sortBy, sortOrder, performanceFilter, dateFilter, competitorFilter
    });

    // Query videos table with basic filtering (no performance filter yet - that's calculated dynamically)
    let query = supabase
      .from('videos')
      .select('id, title, view_count, published_at, thumbnail_url, is_competitor, channel_id')
      .not('view_count', 'is', null); // Ensure we have view counts

    // Apply competitor filter
    if (competitorFilter === 'mine') {
      query = query.eq('is_competitor', false).eq('channel_id', 'Make or Break Shop');
    } else if (competitorFilter === 'competitors') {
      query = query.eq('is_competitor', true);
    }
    // 'all' doesn't need additional filtering

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

    // Execute query to get raw videos
    const { data: rawVideos, error } = await query;

    if (error) {
      console.error('Database error:', error);
      return NextResponse.json({ error: 'Failed to fetch packaging data' }, { status: 500 });
    }

    if (!rawVideos || rawVideos.length === 0) {
      return NextResponse.json({ 
        videos: [], 
        total: 0,
        message: 'No videos found matching your criteria'
      });
    }

    console.log(`📊 Found ${rawVideos.length} raw videos, calculating dynamic performance ratios...`);

    // Calculate dynamic performance ratios using rolling 12-month baseline
    const videosWithPerformance = await calculateDynamicPerformanceRatios(rawVideos);

    console.log(`✅ Calculated performance ratios for ${videosWithPerformance.length} videos`);

    // Apply performance filter after calculation
    let filteredVideos = videosWithPerformance;
    if (performanceFilter) {
      const { min, max } = getPerformanceFilter(performanceFilter);
      filteredVideos = videosWithPerformance.filter(video => {
        const ratio = video.performance_ratio || 0;
        return ratio >= min && (max === undefined || ratio < max);
      });
      
      console.log(`🔍 Performance filter '${performanceFilter}' applied: ${filteredVideos.length}/${videosWithPerformance.length} videos match`);
    }

    // Apply sorting after performance calculation
    filteredVideos.sort((a, b) => {
      let aValue: any, bValue: any;
      
      switch (sortBy) {
        case 'performance_percent':
          aValue = a.performance_ratio || 0;
          bValue = b.performance_ratio || 0;
          break;
        case 'view_count':
          aValue = a.view_count || 0;
          bValue = b.view_count || 0;
          break;
        case 'published_at':
          aValue = new Date(a.published_at).getTime();
          bValue = new Date(b.published_at).getTime();
          break;
        case 'title':
          aValue = a.title.toLowerCase();
          bValue = b.title.toLowerCase();
          break;
        default:
          aValue = a.view_count || 0;
          bValue = b.view_count || 0;
      }
      
      if (sortOrder === 'asc') {
        return aValue > bValue ? 1 : -1;
      } else {
        return aValue < bValue ? 1 : -1;
      }
    });

    // Format the response data
    const formattedVideos = filteredVideos.map(video => ({
      id: video.id,
      title: video.title,
      view_count: video.view_count,
      performance_percent: Number((video.performance_ratio || 0).toFixed(2)),
      channel_avg_views: video.channel_avg_views || 0,
      published_at: video.published_at,
      thumbnail_url: video.thumbnail_url || `https://img.youtube.com/vi/${video.id}/maxresdefault.jpg`,
      is_competitor: video.is_competitor,
      channel_id: video.channel_id,
      baseline_type: '12-month rolling average' // Indicate this is dynamic
    }));

    console.log(`📈 Returning ${formattedVideos.length} videos with dynamic performance ratios`);

    return NextResponse.json({ 
      videos: formattedVideos,
      total: formattedVideos.length,
      calculation_method: 'dynamic_12_month_baseline',
      message: `Found ${formattedVideos.length} videos with dynamic performance ratios`
    });

  } catch (error) {
    console.error('Packaging API error:', error);
    return NextResponse.json({ 
      error: 'Failed to fetch packaging data',
      details: error.message 
    }, { status: 500 });
  }
}