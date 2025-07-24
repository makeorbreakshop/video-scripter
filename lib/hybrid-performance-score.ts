import { supabase } from './supabase-client';

export interface HybridPerformance {
  videoId: string;
  title: string;
  viewCount: number;
  publishedAt: string;
  thumbnailUrl: string;
  ageDays: number;
  
  // View Rate Metrics
  currentVpd: number;          // Current views per day (recent velocity)
  initialVpd: number;          // Initial views per day (first 30 days or less)
  
  // Indexed Performance
  channelBaselineVpd: number;  // Channel average VPD when video published
  indexedScore: number;        // Initial VPD / Channel Baseline VPD
  
  // Trend Analysis
  velocityTrend: number;       // Current VPD / Initial VPD (as percentage)
  trendDirection: '↗️' | '→' | '↘️';
  
  // Combined Display
  displayScore: string;        // e.g., "1,251 vpd • 2.3x baseline • ↗️ 142%"
  performanceTier: string;
}

/**
 * Calculate hybrid performance score combining absolute VPD with indexed performance
 */
export async function calculateHybridPerformance(
  channelName: string,
  limit: number = 50,
  timeframe: string = 'all'
): Promise<HybridPerformance[]> {
  
  // Get videos with snapshots for velocity calculation
  let query = supabase
    .from('videos')
    .select(`
      id, 
      title, 
      view_count, 
      published_at, 
      performance_ratio,
      thumbnail_url
    `)
    .eq('channel_name', channelName)
    .gt('view_count', 0)
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
    console.error('Error fetching videos:', error);
    return [];
  }

  // Get channel baseline VPD for different time periods
  const channelBaselines = await calculateChannelBaselines(channelName);

  // Get daily analytics for velocity calculation (has 2+ years of history!)
  const videoIds = videos.map(v => v.id);
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
  
  const { data: recentAnalytics } = await supabase
    .from('daily_analytics')
    .select('video_id, date, views')
    .in('video_id', videoIds)
    .gte('date', thirtyDaysAgo.toISOString().split('T')[0])
    .order('date', { ascending: false });
  
  // Also get first 30 days of data for initial VPD calculation
  const { data: initialAnalytics } = await supabase
    .from('daily_analytics')
    .select('video_id, date, views')
    .in('video_id', videoIds)
    .lte('date', (videos.map(v => {
      const d = new Date(v.published_at);
      d.setDate(d.getDate() + 30);
      return d.toISOString().split('T')[0];
    })).sort().pop() || '') // Get the latest date we need
    .order('date', { ascending: true });

  // Process each video
  return videos.map(video => {
    const ageDays = Math.max(1, (Date.now() - new Date(video.published_at).getTime()) / (1000 * 60 * 60 * 24));
    
    // Calculate current VPD (simple for now, will improve with more snapshots)
    const currentVpd = video.view_count / ageDays;
    
    // Calculate initial VPD (estimate for first 30 days)
    let initialVpd = currentVpd; // Default to current if we can't calculate
    
    // Get video's recent analytics for current VPD
    const videoRecentAnalytics = recentAnalytics?.filter(a => a.video_id === video.id) || [];
    
    if (videoRecentAnalytics.length >= 2) {
      // Calculate recent velocity from last 30 days
      const sortedAnalytics = videoRecentAnalytics.sort((a, b) => 
        new Date(b.date).getTime() - new Date(a.date).getTime()
      );
      
      const latest = sortedAnalytics[0];
      const oldest = sortedAnalytics[sortedAnalytics.length - 1];
      const daysBetween = (new Date(latest.date).getTime() - new Date(oldest.date).getTime()) / (1000 * 60 * 60 * 24);
      
      if (daysBetween > 0 && oldest.views > 0) {
        const viewsGained = latest.views - oldest.views;
        const recentVpd = viewsGained / daysBetween;
        // Use recent VPD as current if we have good data
        if (recentVpd > 0) {
          currentVpd = recentVpd;
        }
      }
    }
    
    // Calculate initial VPD from first 30 days of data
    const videoInitialAnalytics = initialAnalytics?.filter(a => {
      const analyticsDate = new Date(a.date);
      const publishDate = new Date(video.published_at);
      const daysSincePublish = (analyticsDate.getTime() - publishDate.getTime()) / (1000 * 60 * 60 * 24);
      return a.video_id === video.id && daysSincePublish >= 0 && daysSincePublish <= 30;
    }) || [];
    
    if (videoInitialAnalytics.length > 0) {
      // Get the analytics record closest to 30 days after publish
      const thirtyDayRecord = videoInitialAnalytics[videoInitialAnalytics.length - 1];
      if (thirtyDayRecord && thirtyDayRecord.views > 0) {
        const daysSincePublish = (new Date(thirtyDayRecord.date).getTime() - new Date(video.published_at).getTime()) / (1000 * 60 * 60 * 24);
        initialVpd = thirtyDayRecord.views / Math.max(1, daysSincePublish);
      }
    } else if (ageDays <= 30) {
      initialVpd = currentVpd; // For new videos, current = initial
    } else {
      // Fallback: estimate based on typical YouTube decay
      const estimatedInitialViews = video.view_count * 0.7;
      initialVpd = estimatedInitialViews / 30;
    }
    
    // Get channel baseline for when video was published
    const channelBaselineVpd = getBaselineForDate(channelBaselines, video.published_at);
    
    // Calculate indexed score
    const indexedScore = initialVpd / Math.max(1, channelBaselineVpd);
    
    // Calculate velocity trend
    const velocityTrend = (currentVpd / Math.max(1, initialVpd)) * 100;
    
    // Determine trend direction
    let trendDirection: '↗️' | '→' | '↘️' = '→';
    if (velocityTrend > 110) trendDirection = '↗️';
    else if (velocityTrend < 90) trendDirection = '↘️';
    
    // Determine performance tier based on indexed score
    let performanceTier = 'Needs Attention';
    if (indexedScore >= 3.0) performanceTier = '🚀 Viral Hit';
    else if (indexedScore >= 2.0) performanceTier = '✨ Strong Performer';
    else if (indexedScore >= 1.2) performanceTier = '✅ Above Average';
    else if (indexedScore >= 0.8) performanceTier = '📊 Average';
    else if (indexedScore >= 0.5) performanceTier = '⚠️ Below Average';
    
    // Create display score
    const displayScore = `${Math.round(currentVpd).toLocaleString()} vpd • ${indexedScore.toFixed(1)}x baseline • ${trendDirection} ${Math.round(velocityTrend)}%`;
    
    return {
      videoId: video.id,
      title: video.title,
      viewCount: video.view_count,
      publishedAt: video.published_at,
      thumbnailUrl: video.thumbnail_url,
      ageDays: Math.round(ageDays),
      currentVpd: Math.round(currentVpd),
      initialVpd: Math.round(initialVpd),
      channelBaselineVpd: Math.round(channelBaselineVpd),
      indexedScore: Number(indexedScore.toFixed(2)),
      velocityTrend: Math.round(velocityTrend),
      trendDirection,
      displayScore,
      performanceTier
    };
  });
}

/**
 * Calculate channel baseline VPD for different time periods
 */
async function calculateChannelBaselines(channelName: string): Promise<Map<string, number>> {
  const baselines = new Map<string, number>();
  
  // Get all channel videos for baseline calculation
  const { data: allVideos } = await supabase
    .from('videos')
    .select('published_at, view_count')
    .eq('channel_name', channelName)
    .gt('view_count', 0)
    .order('published_at', { ascending: false });
  
  if (!allVideos || allVideos.length === 0) {
    baselines.set('default', 100); // Default baseline
    return baselines;
  }
  
  // Calculate rolling 90-day average for different periods
  const now = Date.now();
  const periods = [
    { name: 'recent', daysAgo: 0 },
    { name: '3months', daysAgo: 90 },
    { name: '6months', daysAgo: 180 },
    { name: '1year', daysAgo: 365 },
    { name: '2years', daysAgo: 730 }
  ];
  
  for (const period of periods) {
    const periodStart = new Date(now - period.daysAgo * 24 * 60 * 60 * 1000);
    const periodEnd = new Date(periodStart.getTime() - 90 * 24 * 60 * 60 * 1000);
    
    const periodVideos = allVideos.filter(v => {
      const pubDate = new Date(v.published_at);
      return pubDate <= periodStart && pubDate >= periodEnd;
    });
    
    if (periodVideos.length > 0) {
      const vpds = periodVideos.map(v => {
        const ageDays = Math.max(1, (now - new Date(v.published_at).getTime()) / (1000 * 60 * 60 * 24));
        return v.view_count / ageDays;
      });
      
      // Calculate median VPD for this period
      vpds.sort((a, b) => a - b);
      const median = vpds[Math.floor(vpds.length / 2)] || 100;
      baselines.set(period.name, median);
    }
  }
  
  // Set default as the most recent baseline we have
  const defaultBaseline = baselines.get('recent') || baselines.get('3months') || baselines.get('6months') || 100;
  baselines.set('default', defaultBaseline);
  
  return baselines;
}

/**
 * Get the appropriate baseline for a given publish date
 */
function getBaselineForDate(baselines: Map<string, number>, publishDate: string): number {
  const daysAgo = (Date.now() - new Date(publishDate).getTime()) / (1000 * 60 * 60 * 24);
  
  if (daysAgo < 90) return baselines.get('recent') || baselines.get('default') || 100;
  if (daysAgo < 180) return baselines.get('3months') || baselines.get('default') || 100;
  if (daysAgo < 365) return baselines.get('6months') || baselines.get('default') || 100;
  if (daysAgo < 730) return baselines.get('1year') || baselines.get('default') || 100;
  
  return baselines.get('2years') || baselines.get('default') || 100;
}