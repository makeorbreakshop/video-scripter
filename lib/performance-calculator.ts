/**
 * Dynamic Performance Ratio Calculator
 * Calculates performance ratios using rolling 12-month baseline instead of static values
 */

import { createClient } from '@supabase/supabase-js';

// Use service role for database access
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

export interface VideoWithPerformance {
  id: string;
  title: string;
  view_count: number;
  published_at: string;
  thumbnail_url: string;
  is_competitor: boolean;
  channel_id: string;
  performance_ratio?: number;
  channel_avg_views?: number;
}

/**
 * Calculate dynamic performance ratios for a set of videos
 * Uses rolling 12-month baseline for each channel
 */
export async function calculateDynamicPerformanceRatios(
  videos: VideoWithPerformance[],
  baselineMonths: number = 12
): Promise<VideoWithPerformance[]> {
  // Group videos by channel
  const channelGroups = new Map<string, VideoWithPerformance[]>();
  videos.forEach(video => {
    if (!channelGroups.has(video.channel_id)) {
      channelGroups.set(video.channel_id, []);
    }
    channelGroups.get(video.channel_id)!.push(video);
  });

  const enhancedVideos: VideoWithPerformance[] = [];

  // Calculate performance ratios for each channel
  for (const [channelId, channelVideos] of channelGroups) {
    const channelBaseline = await calculateChannelBaseline(channelId, baselineMonths);
    
    channelVideos.forEach(video => {
      const performanceRatio = channelBaseline > 0 ? video.view_count / channelBaseline : 1;
      
      enhancedVideos.push({
        ...video,
        performance_ratio: performanceRatio,
        channel_avg_views: Math.round(channelBaseline)
      });
    });
  }

  return enhancedVideos;
}

/**
 * Calculate rolling baseline for a specific channel
 * Uses last N months of videos from that channel
 */
async function calculateChannelBaseline(
  channelId: string, 
  baselineMonths: number = 12
): Promise<number> {
  try {
    // Calculate date N months ago
    const cutoffDate = new Date();
    cutoffDate.setMonth(cutoffDate.getMonth() - baselineMonths);
    
    // Get all videos from this channel in the baseline period
    const { data: baselineVideos, error } = await supabase
      .from('videos')
      .select('view_count')
      .eq('channel_id', channelId)
      .gte('published_at', cutoffDate.toISOString())
      .not('view_count', 'is', null);

    if (error) {
      console.error(`Error fetching baseline for ${channelId}:`, error);
      return 0;
    }

    if (!baselineVideos || baselineVideos.length === 0) {
      console.warn(`No baseline videos found for ${channelId} in last ${baselineMonths} months`);
      return 0;
    }

    // Calculate average views
    const totalViews = baselineVideos.reduce((sum, video) => sum + (video.view_count || 0), 0);
    const averageViews = totalViews / baselineVideos.length;

    console.log(`📊 ${channelId}: ${baselineVideos.length} videos, ${Math.round(averageViews).toLocaleString()} avg views (${baselineMonths}mo baseline)`);
    
    return averageViews;
  } catch (error) {
    console.error(`Error calculating baseline for ${channelId}:`, error);
    return 0;
  }
}

/**
 * Calculate performance ratio for a single video
 * Useful for real-time calculations
 */
export async function calculateVideoPerformanceRatio(
  videoId: string,
  baselineMonths: number = 12
): Promise<{ performance_ratio: number; channel_avg_views: number } | null> {
  try {
    // Get video data
    const { data: video, error: videoError } = await supabase
      .from('videos')
      .select('view_count, channel_id')
      .eq('id', videoId)
      .single();

    if (videoError || !video) {
      console.error(`Error fetching video ${videoId}:`, videoError);
      return null;
    }

    // Calculate channel baseline
    const channelBaseline = await calculateChannelBaseline(video.channel_id, baselineMonths);
    const performanceRatio = channelBaseline > 0 ? video.view_count / channelBaseline : 1;

    return {
      performance_ratio: performanceRatio,
      channel_avg_views: Math.round(channelBaseline)
    };
  } catch (error) {
    console.error(`Error calculating performance ratio for ${videoId}:`, error);
    return null;
  }
}

/**
 * Performance categories based on dynamic ratios
 */
export function getPerformanceCategory(performanceRatio: number): 'exceptional' | 'above_average' | 'below_average' | 'poor' {
  if (performanceRatio >= 2.0) return 'exceptional';
  if (performanceRatio >= 1.0) return 'above_average';
  if (performanceRatio >= 0.5) return 'below_average';
  return 'poor';
}

/**
 * Get performance filter query for dynamic calculations
 */
export function getPerformanceFilter(category: string): { min: number; max?: number } {
  switch (category) {
    case 'exceptional':
      return { min: 2.0 };
    case 'above_average':
      return { min: 1.0, max: 2.0 };
    case 'below_average':
      return { min: 0.5, max: 1.0 };
    case 'poor':
      return { min: 0, max: 0.5 };
    default:
      return { min: 0 };
  }
}