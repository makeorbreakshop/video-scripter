import { supabase } from './supabase-client';

export interface CachedHybridPerformance {
  videoId: string;
  title: string;
  viewCount: number;
  publishedAt: string;
  thumbnailUrl: string;
  ageDays: number;
  
  // From pre-calculated table
  currentVpd: number;
  initialVpd: number;
  channelBaselineVpd: number;
  indexedScore: number;
  velocityTrend: number;
  trendDirection: '↗️' | '→' | '↘️';
  performanceTier: string;
  
  // Generated display
  displayScore: string;
}

/**
 * Get pre-calculated hybrid performance scores from the cache table
 * This is MUCH faster than calculating on the fly
 */
export async function getCachedHybridPerformance(
  channelName: string,
  limit: number = 50,
  timeframe: string = 'all'
): Promise<CachedHybridPerformance[]> {
  
  // Build query joining videos with performance metrics
  let query = supabase
    .from('video_performance_metrics')
    .select(`
      video_id,
      age_days,
      current_vpd,
      initial_vpd,
      channel_baseline_vpd,
      indexed_score,
      velocity_trend,
      trend_direction,
      performance_tier,
      last_calculated_at,
      videos!inner (
        title,
        view_count,
        published_at,
        thumbnail_url
      )
    `)
    .eq('channel_name', channelName)
    .order('published_at', { ascending: false });

  // Apply date filter
  if (timeframe !== 'all') {
    const dateFilter = new Date();
    const timeValue = parseInt(timeframe);
    const timeUnit = timeframe.slice(-1);
    
    switch (timeUnit) {
      case 'd':
        dateFilter.setDate(dateFilter.getDate() - timeValue);
        break;
      case 'm':
        dateFilter.setMonth(dateFilter.getMonth() - timeValue);
        break;
      case 'y':
        dateFilter.setFullYear(dateFilter.getFullYear() - timeValue);
        break;
    }
    
    query = query.gte('videos.published_at', dateFilter.toISOString());
  }

  if (limit > 0) {
    query = query.limit(limit);
  }

  const { data: videos, error } = await query;

  if (error || !videos) {
    console.error('Error fetching cached performance:', error);
    return [];
  }

  // Transform the data
  return videos.map(record => {
    const video = record.videos;
    
    // Create display score
    const displayScore = `${Math.round(record.current_vpd).toLocaleString()} vpd • ${record.indexed_score.toFixed(1)}x baseline • ${record.trend_direction} ${Math.round(record.velocity_trend)}%`;
    
    return {
      videoId: record.video_id,
      title: video.title,
      viewCount: video.view_count,
      publishedAt: video.published_at,
      thumbnailUrl: video.thumbnail_url,
      ageDays: record.age_days,
      currentVpd: Math.round(record.current_vpd),
      initialVpd: Math.round(record.initial_vpd),
      channelBaselineVpd: Math.round(record.channel_baseline_vpd),
      indexedScore: Number(record.indexed_score),
      velocityTrend: Math.round(record.velocity_trend),
      trendDirection: record.trend_direction,
      performanceTier: record.performance_tier,
      displayScore
    };
  });
}

/**
 * Trigger a refresh of performance metrics for a channel
 */
export async function refreshChannelPerformanceMetrics(channelName: string): Promise<void> {
  // Call the database function to update all videos for this channel
  const { error } = await supabase.rpc('update_channel_performance_metrics', {
    p_channel_name: channelName
  });
  
  if (error) {
    console.error('Error refreshing performance metrics:', error);
    throw error;
  }
}