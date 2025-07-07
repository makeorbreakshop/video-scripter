import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

export async function GET(
  request: NextRequest,
  { params }: { params: { channelId: string } }
) {
  try {
    const { channelId } = params;
    
    if (!channelId) {
      return NextResponse.json(
        { error: 'Channel ID is required' },
        { status: 400 }
      );
    }

    const decodedChannelId = decodeURIComponent(channelId);

    // Get all videos for this channel with rolling baseline data
    const { data: allVideos, error: videosError } = await supabase
      .from('videos')
      .select(`
        id,
        title,
        view_count,
        published_at,
        thumbnail_url,
        duration,
        channel_id,
        channel_name,
        rolling_baseline_views,
        is_competitor,
        created_at,
        description
      `)
      .eq('channel_id', decodedChannelId)
      .order('published_at', { ascending: false });

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

    // Helper function to check if video is a YouTube Short
    const isYouTubeShort = (video: any): boolean => {
      // Duration check: <= 2 minutes 1 second (121 seconds)
      const durationMatch = video.duration?.match(/^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/);
      if (durationMatch) {
        const hours = parseInt(durationMatch[1] || '0');
        const minutes = parseInt(durationMatch[2] || '0');
        const seconds = parseInt(durationMatch[3] || '0');
        const totalSeconds = hours * 3600 + minutes * 60 + seconds;
        if (totalSeconds > 0 && totalSeconds <= 121) {
          return true;
        }
      }
      
      // Hashtag check: Look for #shorts, #short, #youtubeshorts (case insensitive)
      const combinedText = `${video.title || ''} ${video.description || ''}`.toLowerCase();
      if (combinedText.includes('#shorts') || combinedText.includes('#short') || combinedText.includes('#youtubeshorts')) {
        return true;
      }
      
      return false;
    };

    // Filter out YouTube Shorts
    const videos = allVideos.filter(video => !isYouTubeShort(video));

    if (videos.length === 0) {
      return NextResponse.json(
        { error: 'No long-form videos found for this channel' },
        { status: 404 }
      );
    }

    // Calculate performance ratios and channel stats
    const videosWithPerformance = videos.map(video => {
      const performanceRatio = video.rolling_baseline_views > 0 
        ? video.view_count / video.rolling_baseline_views 
        : null;
      
      return {
        ...video,
        performance_ratio: performanceRatio,
        channel_avg_views: video.rolling_baseline_views
      };
    });

    // Calculate channel overview stats
    const totalVideos = videos.length;
    const totalViews = videos.reduce((sum, v) => sum + (v.view_count || 0), 0);
    const avgViews = totalViews / totalVideos;
    
    const validPerformanceRatios = videosWithPerformance
      .map(v => v.performance_ratio)
      .filter(ratio => ratio !== null && ratio > 0) as number[];
    
    const avgPerformanceRatio = validPerformanceRatios.length > 0
      ? validPerformanceRatios.reduce((sum, ratio) => sum + ratio, 0) / validPerformanceRatios.length
      : null;

    // Performance distribution
    const performanceDistribution = {
      under_half: validPerformanceRatios.filter(r => r < 0.5).length,
      half_to_one: validPerformanceRatios.filter(r => r >= 0.5 && r < 1.0).length,
      one_to_two: validPerformanceRatios.filter(r => r >= 1.0 && r < 2.0).length,
      over_two: validPerformanceRatios.filter(r => r >= 2.0).length
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

    // Top and bottom performers
    const sortedByPerformance = videosWithPerformance
      .filter(v => v.performance_ratio !== null)
      .sort((a, b) => (b.performance_ratio || 0) - (a.performance_ratio || 0));
    
    const topPerformers = sortedByPerformance.slice(0, 6);
    const bottomPerformers = sortedByPerformance.slice(-6).reverse();

    const channelOverview = {
      channel_name: videos[0].channel_name || decodedChannelId,
      channel_id: decodedChannelId,
      total_videos: totalVideos,
      total_views: totalViews,
      avg_views: Math.round(avgViews),
      avg_performance_ratio: avgPerformanceRatio ? Math.round(avgPerformanceRatio * 100) / 100 : null,
      uploads_per_month: Math.round(uploadsPerMonth * 10) / 10,
      date_range: {
        oldest: oldestDate?.toISOString(),
        newest: newestDate?.toISOString()
      },
      performance_distribution: performanceDistribution,
      top_performers: topPerformers,
      bottom_performers: bottomPerformers
    };

    return NextResponse.json({
      channel_overview: channelOverview,
      videos: videosWithPerformance
    });

  } catch (error) {
    console.error('Error in channel analysis API:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}