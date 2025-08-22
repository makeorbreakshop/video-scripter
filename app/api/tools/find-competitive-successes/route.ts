/**
 * API endpoint for find_competitive_successes tool
 * Finds high-performing videos in the same topic cluster from different channels
 */

import { NextRequest, NextResponse } from 'next/server';
import { getSupabase } from '@/lib/supabase-lazy';
import { ToolResponse } from '@/types/tools';
import { wrapTool, createToolContext } from '@/lib/tools/base-wrapper';

// Initialize Supabase client

interface CompetitiveSuccessesParams {
  topic_cluster_id?: number;
  topic_niche?: string;
  min_tps?: number;
  exclude_channel_id?: string;
  limit?: number;
  days_back?: number;
}

interface CompetitiveVideo {
  video_id: string;
  title: string;
  channel_name: string;
  channel_id: string;
  tps: number;
  view_count: number;
  published_at: string;
  topic_niche: string | null;
  topic_cluster_id: number | null;
  format_type: string | null;
}

interface CompetitiveSuccessesResponse {
  query_params: {
    topic_cluster_id?: number;
    topic_niche?: string;
    min_tps: number;
  };
  total_found: number;
  videos: CompetitiveVideo[];
  unique_channels: string[];
  unique_formats: string[];
  avg_tps: number;
  top_channel: {
    channel_id: string;
    channel_name: string;
    video_count: number;
  } | null;
}

/**
 * Find competitive successes in topic cluster
 */
async function findCompetitiveSuccessesHandler(
  params: CompetitiveSuccessesParams,
  context?: any
): Promise<ToolResponse<CompetitiveSuccessesResponse>> {
  const {
    topic_cluster_id,
    topic_niche,
    min_tps = 2.0,
    exclude_channel_id,
    limit = 50,
    days_back = 90
  } = params;
  
  // Validate inputs - need either cluster or niche
  if (!topic_cluster_id && !topic_niche) {
    return {
      success: false,
      error: {
        code: 'INVALID_PARAMS',
        message: 'Either topic_cluster_id or topic_niche is required'
      }
    };
  }
  
  try {
    // Build query
    let query = supabase
      .from('videos')
      .select('*')
      .gte('temporal_performance_score', min_tps)
      .eq('is_short', false)
      .order('temporal_performance_score', { ascending: false })
      .limit(limit);
    
    // Apply topic filter
    if (topic_cluster_id !== undefined) {
      query = query.eq('topic_cluster_id', topic_cluster_id);
    }
    if (topic_niche) {
      query = query.eq('topic_niche', topic_niche);
    }
    
    // Exclude specific channel if provided
    if (exclude_channel_id) {
      query = query.neq('channel_id', exclude_channel_id);
    }
    
    // Apply time filter
    if (days_back > 0) {
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - days_back);
      query = query.gte('published_at', cutoffDate.toISOString());
    }
    
    const { data: videos, error } = await query;
    
    if (error) {
      throw new Error(`Failed to fetch competitive videos: ${error.message}`);
    }
    
    if (!videos || videos.length === 0) {
      return {
        success: true,
        data: {
          query_params: {
            topic_cluster_id,
            topic_niche,
            min_tps
          },
          total_found: 0,
          videos: [],
          unique_channels: [],
          unique_formats: [],
          avg_tps: 0,
          top_channel: null
        }
      };
    }
    
    // Process videos
    const competitiveVideos: CompetitiveVideo[] = videos.map(v => ({
      video_id: v.id,
      title: v.title,
      channel_name: v.channel_name,
      channel_id: v.channel_id,
      tps: v.temporal_performance_score!,
      view_count: v.view_count,
      published_at: v.published_at,
      topic_niche: v.topic_niche,
      topic_cluster_id: v.topic_cluster_id,
      format_type: v.format_type
    }));
    
    // Calculate unique values
    const uniqueChannels = [...new Set(videos.map(v => v.channel_id))];
    const uniqueFormats = [...new Set(videos
      .map(v => v.format_type)
      .filter((f): f is string => f !== null))];
    
    // Calculate average TPS
    const avgTps = competitiveVideos.reduce((sum, v) => sum + v.tps, 0) / competitiveVideos.length;
    
    // Find top channel by video count
    const channelCounts = new Map<string, { name: string; count: number }>();
    videos.forEach(v => {
      const current = channelCounts.get(v.channel_id) || { name: v.channel_name, count: 0 };
      channelCounts.set(v.channel_id, {
        name: v.channel_name,
        count: current.count + 1
      });
    });
    
    let topChannel = null;
    let maxCount = 0;
    channelCounts.forEach((data, channelId) => {
      if (data.count > maxCount) {
        maxCount = data.count;
        topChannel = {
          channel_id: channelId,
          channel_name: data.name,
          video_count: data.count
        };
      }
    });
    
    const response: CompetitiveSuccessesResponse = {
      query_params: {
        topic_cluster_id,
        topic_niche,
        min_tps
      },
      total_found: competitiveVideos.length,
      videos: competitiveVideos,
      unique_channels: uniqueChannels,
      unique_formats: uniqueFormats,
      avg_tps: avgTps,
      top_channel: topChannel
    };
    
    return {
      success: true,
      data: response
    };
    
  } catch (error: any) {
    console.error('Error finding competitive successes:', error);
    return {
      success: false,
      error: {
        code: 'DATABASE_ERROR',
        message: 'Failed to find competitive successes',
        details: error.message,
        retryable: true
      }
    };
  }
}

// Wrap handler with caching and retry logic
const wrappedHandler = wrapTool({
  name: 'find_competitive_successes',
  description: 'Find high-performing videos in same topic from other channels',
  parameters: {
    type: 'object',
    properties: {
      topic_cluster_id: {
        type: 'number',
        description: 'Topic cluster ID to search within'
      },
      topic_niche: {
        type: 'string',
        description: 'Topic niche to search within'
      },
      min_tps: {
        type: 'number',
        description: 'Minimum TPS threshold (default 2.0)',
        default: 2.0
      },
      exclude_channel_id: {
        type: 'string',
        description: 'Channel ID to exclude from results'
      },
      limit: {
        type: 'number',
        description: 'Maximum number of videos to return',
        default: 50
      },
      days_back: {
        type: 'number',
        description: 'Number of days to look back',
        default: 90
      }
    },
    required: []
  },
  handler: findCompetitiveSuccessesHandler,
  parallelSafe: true,
  cacheTTL: 300, // Cache for 5 minutes
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
export { findCompetitiveSuccessesHandler };