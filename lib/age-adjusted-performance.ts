import { supabase } from './supabase-client';

export interface AgeAdjustedPerformance {
  videoId: string;
  title: string;
  viewCount: number;
  publishedAt: string;
  thumbnailUrl: string;
  ageDays: number;
  viewsPerDay: number;
  oldScore: number;
  ageAdjustedScore: number;
  performanceTier: string;
  channelMedianVpd: number;
}

/**
 * Calculate age-adjusted performance scores for a specific channel
 * This uses only recent videos (last 12 months) as the benchmark
 */
export async function calculateAgeAdjustedPerformance(
  channelName: string,
  limit: number = 50,
  timeframe: string = '30d'
): Promise<AgeAdjustedPerformance[]> {
  // First, get recent channel benchmarks
  const { data: benchmarkData, error: benchmarkError } = await supabase
    .from('videos')
    .select('view_count, published_at')
    .eq('channel_name', channelName)
    .gte('published_at', new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toISOString())
    .gt('view_count', 0);

  if (benchmarkError) {
    console.error('Error fetching benchmark data:', benchmarkError);
    return [];
  }

  // Calculate VPD for each recent video
  const recentVpds = benchmarkData?.map(v => {
    const ageDays = Math.max(1, (Date.now() - new Date(v.published_at).getTime()) / (1000 * 60 * 60 * 24));
    return v.view_count / ageDays;
  }) || [];

  // Get median VPD
  let medianVpd = 1; // Default fallback
  if (recentVpds.length > 0) {
    recentVpds.sort((a, b) => a - b);
    medianVpd = recentVpds[Math.floor(recentVpds.length / 2)] || 1;
  }

  // Calculate date filter
  let dateFilter = new Date();
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


  // Now get the channel's videos
  let query = supabase
    .from('videos')
    .select('id, title, view_count, published_at, performance_ratio, thumbnail_url')
    .eq('channel_name', channelName)
    .gt('view_count', 0)
    .order('published_at', { ascending: false })
    .limit(limit);
  
  // Apply date filter if not "all"
  if (timeframe !== 'all') {
    query = query.gte('published_at', dateFilter.toISOString());
  }

  const { data: videos, error: videosError } = await query;

  if (videosError) {
    console.error('Error fetching videos:', videosError);
    return [];
  }


  // Calculate age-adjusted scores
  if (!videos || videos.length === 0) {
    console.warn('No videos found for channel:', channelName);
    return [];
  }

  return videos.map(video => {
    const ageDays = Math.max(1, (Date.now() - new Date(video.published_at).getTime()) / (1000 * 60 * 60 * 24));
    const vpd = video.view_count / ageDays;
    const ageAdjustedScore = vpd / medianVpd;

    let performanceTier = 'Needs Attention';
    if (ageAdjustedScore >= 2.0) performanceTier = '🚀 Exceptional';
    else if (ageAdjustedScore >= 1.5) performanceTier = '✨ Strong';
    else if (ageAdjustedScore >= 1.0) performanceTier = '✅ Above Average';
    else if (ageAdjustedScore >= 0.5) performanceTier = '📊 Below Average';

    return {
      videoId: video.id,
      title: video.title,
      viewCount: video.view_count,
      publishedAt: video.published_at,
      thumbnailUrl: video.thumbnail_url,
      ageDays: Math.round(ageDays),
      viewsPerDay: Math.round(vpd),
      oldScore: video.performance_ratio,
      ageAdjustedScore: Number(ageAdjustedScore.toFixed(2)),
      performanceTier,
      channelMedianVpd: Math.round(medianVpd)
    };
  });
}

/**
 * Get performance comparison for a specific video
 */
export async function getVideoPerformanceComparison(videoId: string): Promise<AgeAdjustedPerformance | null> {
  // Get the video details
  const { data: video, error } = await supabase
    .from('videos')
    .select('channel_name')
    .eq('id', videoId)
    .single();

  if (error || !video) {
    console.error('Error fetching video:', error);
    return null;
  }

  // Calculate performance for the channel
  const performances = await calculateAgeAdjustedPerformance(video.channel_name, 100);
  
  // Find this specific video
  return performances.find(p => p.videoId === videoId) || null;
}