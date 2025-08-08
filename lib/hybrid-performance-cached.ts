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
 * Get temporal performance scores from the videos table
 * Now using the corrected temporal_performance_score field
 */
export async function getCachedHybridPerformance(
  channelName: string,
  limit: number = 50,
  timeframe: string = 'all'
): Promise<CachedHybridPerformance[]> {
  
  // Build query directly from videos table with temporal scores
  let query = supabase
    .from('videos')
    .select(`
      id,
      title,
      view_count,
      published_at,
      thumbnail_url,
      temporal_performance_score,
      envelope_performance_category,
      channel_baseline_at_publish
    `)
    .eq('channel_name', channelName)
    .eq('is_short', false)
    .not('temporal_performance_score', 'is', null)
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
    
    query = query.gte('published_at', dateFilter.toISOString());
  }

  if (limit > 0) {
    query = query.limit(limit);
  }

  const { data: videos, error } = await query;

  if (error || !videos) {
    console.error('Error fetching temporal performance:', error);
    return [];
  }

  // Transform the data using temporal scores
  return videos.map(video => {
    const ageDays = Math.floor((Date.now() - new Date(video.published_at).getTime()) / (1000 * 60 * 60 * 24));
    const currentVpd = Math.round(video.view_count / Math.max(ageDays, 1));
    const temporalScore = Number(video.temporal_performance_score) || 0;
    
    // Determine performance tier based on temporal score
    let performanceTier = 'Average';
    let trendDirection: '↗️' | '→' | '↘️' = '→';
    
    if (temporalScore >= 3.0) {
      performanceTier = 'Viral Performance (≥3x)';
      trendDirection = '↗️';
    } else if (temporalScore >= 2.0) {
      performanceTier = 'Strong Performance (2-3x)';
      trendDirection = '↗️';
    } else if (temporalScore >= 1.5) {
      performanceTier = 'Above Average (1.5-2x)';
      trendDirection = '↗️';
    } else if (temporalScore >= 0.8) {
      performanceTier = 'Average Performance (0.8-1.5x)';
      trendDirection = '→';
    } else if (temporalScore >= 0.5) {
      performanceTier = 'Below Average (0.5-0.8x)';
      trendDirection = '↘️';
    } else {
      performanceTier = 'Needs Attention (<0.5x)';
      trendDirection = '↘️';
    }
    
    // Create display score using temporal performance
    const displayScore = `${currentVpd.toLocaleString()} vpd • ${temporalScore.toFixed(2)}x temporal • ${video.envelope_performance_category || 'unclassified'}`;
    
    return {
      videoId: video.id,
      title: video.title,
      viewCount: video.view_count,
      publishedAt: video.published_at,
      thumbnailUrl: video.thumbnail_url || '',
      ageDays,
      currentVpd,
      initialVpd: currentVpd, // For compatibility
      channelBaselineVpd: Math.round((video.channel_baseline_at_publish || 1) * 1000), // Convert from multiplier to approximate vpd
      indexedScore: temporalScore, // Use temporal score as the new indexed score
      velocityTrend: 0, // No velocity data available from videos table
      trendDirection,
      performanceTier,
      displayScore
    };
  });
}

/**
 * Trigger a refresh of temporal performance scores for a channel
 * This is now handled automatically by database triggers, so this is a no-op
 */
export async function refreshChannelPerformanceMetrics(channelName: string): Promise<void> {
  // Temporal performance scores are now automatically updated via database triggers
  // when view counts are synced from view_snapshots
  console.log(`Temporal scores for ${channelName} are automatically maintained via triggers`);
}