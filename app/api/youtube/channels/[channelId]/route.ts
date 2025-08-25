import { NextRequest, NextResponse } from 'next/server';
import { getSupabase } from '@/lib/supabase-lazy';


export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ channelId: string }> }
) {
  try {
    const { channelId } = await params;
    const { searchParams } = new URL(request.url);
    const dateFilter = searchParams.get('dateFilter') || '90d'; // Default to 90 days
    
    if (!channelId) {
      return NextResponse.json(
        { error: 'Channel ID is required' },
        { status: 400 }
      );
    }

    const decodedChannelId = decodeURIComponent(channelId);

    // Calculate date filter
    let dateFilterClause = null;
    if (dateFilter !== 'all') {
      const now = new Date();
      const daysMatch = dateFilter.match(/^(\d+)d$/);
      if (daysMatch) {
        const days = parseInt(daysMatch[1]);
        const filterDate = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
        dateFilterClause = filterDate.toISOString();
      }
    }

    // Build query - optimize by only selecting needed fields
    const supabase = await getSupabase();
    let query = supabase
      .from('videos')
      .select(`
        id,
        title,
        view_count,
        published_at,
        thumbnail_url,
        channel_id,
        channel_name,
        temporal_performance_score,
        envelope_performance_category,
        channel_baseline_at_publish,
        rolling_baseline_views
      `)
      .eq('channel_id', decodedChannelId)
      .eq('is_short', false)  // Use is_short column instead of checking duration
      .order('published_at', { ascending: false });
    
    // Apply date filter for top performers calculation
    if (dateFilterClause) {
      // We'll handle this differently for top performers
    }

    const { data: allVideos, error: videosError } = await query;

    if (videosError) {
      console.error('Error fetching channel videos:', videosError);
      return NextResponse.json(
        { error: 'Failed to fetch channel videos' },
        { status: 500 }
      );
    }

    if (!allVideos || allVideos.length === 0) {
      return NextResponse.json(
        { error: 'Channel not found or no videos available' },
        { status: 404 }
      );
    }

    const videos = allVideos;

    // Calculate channel overview stats
    const totalVideos = videos.length;
    const totalViews = videos.reduce((sum, v) => sum + (v.view_count || 0), 0);
    const avgViews = totalViews / totalVideos;
    
    const validTemporalScores = videos
      .map(v => v.temporal_performance_score)
      .filter(score => score !== null && score > 0) as number[];
    
    const avgTemporalPerformanceScore = validTemporalScores.length > 0
      ? validTemporalScores.reduce((sum, score) => sum + score, 0) / validTemporalScores.length
      : null;

    // Performance distribution using temporal scores
    const performanceDistribution = {
      under_half: validTemporalScores.filter(s => s < 0.5).length,
      half_to_one: validTemporalScores.filter(s => s >= 0.5 && s < 1.0).length,
      one_to_two: validTemporalScores.filter(s => s >= 1.0 && s < 2.0).length,
      over_two: validTemporalScores.filter(s => s >= 2.0).length
    };

    // Date range
    const publishDates = videos
      .map(v => new Date(v.published_at))
      .filter(date => !isNaN(date.getTime()));
    
    const oldestDate = publishDates.length > 0 ? new Date(Math.min(...publishDates.map(d => d.getTime()))) : null;
    const newestDate = publishDates.length > 0 ? new Date(Math.max(...publishDates.map(d => d.getTime()))) : null;

    // Upload frequency (videos per month)
    const monthsSpanned = oldestDate && newestDate 
      ? Math.max(1, (newestDate.getTime() - oldestDate.getTime()) / (1000 * 60 * 60 * 24 * 30))
      : 1;
    const uploadsPerMonth = totalVideos / monthsSpanned;

    // Filter videos for top performers based on date filter
    let videosForTopPerformers = videos;
    if (dateFilterClause) {
      videosForTopPerformers = videos.filter(v => 
        new Date(v.published_at) >= new Date(dateFilterClause)
      );
    }

    // Top performers using temporal scores with date filter
    const sortedByPerformance = videosForTopPerformers
      .filter(v => v.temporal_performance_score !== null)
      .sort((a, b) => (b.temporal_performance_score || 0) - (a.temporal_performance_score || 0));
    
    const topPerformers = sortedByPerformance.slice(0, 6);

    const channelOverview = {
      channel_name: videos[0].channel_name || decodedChannelId,
      channel_id: decodedChannelId,
      total_videos: totalVideos,
      total_views: totalViews,
      avg_views: Math.round(avgViews),
      avg_temporal_performance_score: avgTemporalPerformanceScore ? Math.round(avgTemporalPerformanceScore * 100) / 100 : null,
      uploads_per_month: Math.round(uploadsPerMonth * 10) / 10,
      date_range: {
        oldest: oldestDate?.toISOString(),
        newest: newestDate?.toISOString()
      },
      performance_distribution: performanceDistribution,
      top_performers: topPerformers,
      date_filter: dateFilter
    };

    return NextResponse.json({
      channel_overview: channelOverview,
      videos: videos // Only return necessary video data
    });

  } catch (error) {
    console.error('Error in channel analysis API:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}