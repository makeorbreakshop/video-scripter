/**
 * API endpoint for get_channel_performance_distribution tool
 * Analyzes distribution of temporal_performance_scores for a channel
 */

import { NextRequest, NextResponse } from 'next/server';
import { getSupabase } from '@/lib/supabase-lazy';
import { ToolResponse } from '@/types/tools';
import { wrapTool, createToolContext } from '@/lib/tools/base-wrapper';

// Initialize Supabase client

interface ChannelDistributionParams {
  channel_id: string;
  days_back?: number;
  exclude_shorts?: boolean;
}

interface PerformanceDistribution {
  viral: { count: number; percentage: number; videos: string[] };           // >= 3.0
  outperforming: { count: number; percentage: number; videos: string[] };   // 2.0-3.0
  standard: { count: number; percentage: number; videos: string[] };        // 1.0-2.0
  underperforming: { count: number; percentage: number; videos: string[] }; // < 1.0
}

interface ChannelDistributionResponse {
  channel_id: string;
  total_videos: number;
  avg_tps: number;
  median_tps: number;
  std_dev: number;
  distribution: PerformanceDistribution;
  percentiles: {
    p10: number;
    p25: number;
    p50: number;
    p75: number;
    p90: number;
  };
  best_performer: {
    video_id: string;
    title: string;
    tps: number;
  } | null;
  worst_performer: {
    video_id: string;
    title: string;
    tps: number;
  } | null;
}

/**
 * Calculate standard deviation
 */
function calculateStdDev(values: number[], mean: number): number {
  const squaredDiffs = values.map(v => Math.pow(v - mean, 2));
  const avgSquaredDiff = squaredDiffs.reduce((sum, v) => sum + v, 0) / values.length;
  return Math.sqrt(avgSquaredDiff);
}

/**
 * Calculate percentile
 */
function calculatePercentile(values: number[], percentile: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.ceil((percentile / 100) * sorted.length) - 1;
  return sorted[Math.max(0, index)];
}

/**
 * Get channel performance distribution
 */
async function getChannelDistributionHandler(
  params: ChannelDistributionParams,
  context?: any
): Promise<ToolResponse<ChannelDistributionResponse>> {
  const { 
    channel_id, 
    days_back = 365,
    exclude_shorts = true 
  } = params;
  
  // Validate inputs
  if (!channel_id) {
    return {
      success: false,
      error: {
        code: 'INVALID_PARAMS',
        message: 'channel_id is required'
      }
    };
  }
  
  try {
    // Build query
    let query = supabase
      .from('videos')
      .select('id, title, temporal_performance_score')
      .eq('channel_id', channel_id)
      .not('temporal_performance_score', 'is', null);
    
    // Apply filters
    if (exclude_shorts) {
      query = query.eq('is_short', false);
    }
    
    if (days_back > 0) {
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - days_back);
      query = query.gte('published_at', cutoffDate.toISOString());
    }
    
    const { data: videos, error } = await query;
    
    if (error) {
      throw new Error(`Failed to fetch videos: ${error.message}`);
    }
    
    if (!videos || videos.length === 0) {
      return {
        success: false,
        error: {
          code: 'NO_DATA',
          message: 'No videos found with performance scores for this channel'
        }
      };
    }
    
    // Extract TPS values
    const tpsValues = videos
      .map(v => v.temporal_performance_score)
      .filter((tps): tps is number => tps !== null);
    
    // Calculate statistics
    const avgTps = tpsValues.reduce((sum, v) => sum + v, 0) / tpsValues.length;
    const medianTps = calculatePercentile(tpsValues, 50);
    const stdDev = calculateStdDev(tpsValues, avgTps);
    
    // Calculate distribution
    const distribution: PerformanceDistribution = {
      viral: { count: 0, percentage: 0, videos: [] },
      outperforming: { count: 0, percentage: 0, videos: [] },
      standard: { count: 0, percentage: 0, videos: [] },
      underperforming: { count: 0, percentage: 0, videos: [] }
    };
    
    // Categorize videos
    videos.forEach(video => {
      const tps = video.temporal_performance_score!;
      if (tps >= 3.0) {
        distribution.viral.count++;
        distribution.viral.videos.push(video.id);
      } else if (tps >= 2.0) {
        distribution.outperforming.count++;
        distribution.outperforming.videos.push(video.id);
      } else if (tps >= 1.0) {
        distribution.standard.count++;
        distribution.standard.videos.push(video.id);
      } else {
        distribution.underperforming.count++;
        distribution.underperforming.videos.push(video.id);
      }
    });
    
    // Calculate percentages
    const total = videos.length;
    distribution.viral.percentage = (distribution.viral.count / total) * 100;
    distribution.outperforming.percentage = (distribution.outperforming.count / total) * 100;
    distribution.standard.percentage = (distribution.standard.count / total) * 100;
    distribution.underperforming.percentage = (distribution.underperforming.count / total) * 100;
    
    // Limit video arrays to top 5 each
    distribution.viral.videos = distribution.viral.videos.slice(0, 5);
    distribution.outperforming.videos = distribution.outperforming.videos.slice(0, 5);
    distribution.standard.videos = distribution.standard.videos.slice(0, 5);
    distribution.underperforming.videos = distribution.underperforming.videos.slice(0, 5);
    
    // Calculate percentiles
    const percentiles = {
      p10: calculatePercentile(tpsValues, 10),
      p25: calculatePercentile(tpsValues, 25),
      p50: medianTps,
      p75: calculatePercentile(tpsValues, 75),
      p90: calculatePercentile(tpsValues, 90)
    };
    
    // Find best and worst performers
    const sortedVideos = [...videos].sort((a, b) => 
      (b.temporal_performance_score || 0) - (a.temporal_performance_score || 0)
    );
    
    const bestPerformer = sortedVideos[0] ? {
      video_id: sortedVideos[0].id,
      title: sortedVideos[0].title,
      tps: sortedVideos[0].temporal_performance_score!
    } : null;
    
    const worstPerformer = sortedVideos[sortedVideos.length - 1] ? {
      video_id: sortedVideos[sortedVideos.length - 1].id,
      title: sortedVideos[sortedVideos.length - 1].title,
      tps: sortedVideos[sortedVideos.length - 1].temporal_performance_score!
    } : null;
    
    const response: ChannelDistributionResponse = {
      channel_id,
      total_videos: videos.length,
      avg_tps: avgTps,
      median_tps: medianTps,
      std_dev: stdDev,
      distribution,
      percentiles,
      best_performer: bestPerformer,
      worst_performer: worstPerformer
    };
    
    return {
      success: true,
      data: response
    };
    
  } catch (error: any) {
    console.error('Error fetching channel distribution:', error);
    return {
      success: false,
      error: {
        code: 'DATABASE_ERROR',
        message: 'Failed to fetch channel performance distribution',
        details: error.message,
        retryable: true
      }
    };
  }
}

// Wrap handler with caching and retry logic
const wrappedHandler = wrapTool({
  name: 'get_channel_performance_distribution',
  description: 'Analyze TPS distribution across a channel\'s videos',
  parameters: {
    type: 'object',
    properties: {
      channel_id: {
        type: 'string',
        description: 'Channel ID to analyze'
      },
      days_back: {
        type: 'number',
        description: 'Number of days to look back (default 365)',
        default: 365
      },
      exclude_shorts: {
        type: 'boolean',
        description: 'Exclude YouTube Shorts from analysis',
        default: true
      }
    },
    required: ['channel_id']
  },
  handler: getChannelDistributionHandler,
  parallelSafe: true,
  cacheTTL: 600, // Cache for 10 minutes
  timeout: 5000,
  retryConfig: {
    maxRetries: 3,
    backoffMs: 500
  }
});

export async function POST(request: NextRequest) {
  const supabase = getSupabase();
  try {
    const body = await request.json();
    const context = createToolContext({
      requestId: request.headers.get('x-request-id') || undefined,
      mode: request.headers.get('x-analysis-mode') as 'classic' | 'agentic' || 'agentic'
    });

    const result = await wrappedHandler(body, context);
    
    return NextResponse.json(result, {
      status: result.success ? 200 : 400,
      headers: {
        'x-request-id': context.requestId || '',
        'x-cache-status': result.metadata?.cached ? 'hit' : 'miss',
        'x-execution-time': String(result.metadata?.executionTime || 0)
      }
    });
  } catch (error: any) {
    console.error('API error:', error);
    return NextResponse.json(
      {
        success: false,
        error: {
          code: 'API_ERROR',
          message: error.message || 'Internal server error'
        }
      },
      { status: 500 }
    );
  }
}

// Export for testing
export { getChannelDistributionHandler, calculateStdDev, calculatePercentile };