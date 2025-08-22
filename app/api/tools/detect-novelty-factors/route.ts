/**
 * API endpoint for detect_novelty_factors tool
 * Identifies what makes a video unique compared to channel history
 */

import { NextRequest, NextResponse } from 'next/server';
import { getSupabase } from '@/lib/supabase-lazy';
import { ToolResponse } from '@/types/tools';
import { wrapTool, createToolContext } from '@/lib/tools/base-wrapper';

// Initialize Supabase client

interface NoveltyFactorsParams {
  video_id: string;
  compare_last_n?: number;
  include_format_analysis?: boolean;
  include_topic_analysis?: boolean;
}

interface NoveltyFactorsResponse {
  video_id: string;
  video_details: {
    title: string;
    tps: number | null;
    format_type: string | null;
    topic_niche: string | null;
    topic_cluster_id: number | null;
    published_at: string;
  };
  novelty_factors: {
    is_first_in_format: boolean;
    is_first_in_topic: boolean;
    is_first_in_cluster: boolean;
    days_since_last_similar_format: number | null;
    days_since_last_similar_topic: number | null;
    tps_vs_similar_format: number | null;
    tps_vs_similar_topic: number | null;
  };
  format_history?: {
    total_videos_in_format: number;
    avg_tps_in_format: number | null;
    last_video_date: string | null;
  };
  topic_history?: {
    total_videos_in_topic: number;
    avg_tps_in_topic: number | null;
    last_video_date: string | null;
  };
  differentiation_score: number; // 0-100
  unique_elements: string[];
}

/**
 * Calculate differentiation score
 */
function calculateDifferentiationScore(factors: any): number {
  let score = 0;
  
  // First in format is highly novel
  if (factors.is_first_in_format) score += 30;
  // First in topic is very novel
  if (factors.is_first_in_topic) score += 25;
  // First in cluster is novel
  if (factors.is_first_in_cluster) score += 20;
  
  // Long gaps indicate novelty
  if (factors.days_since_last_similar_format && factors.days_since_last_similar_format > 90) {
    score += 15;
  } else if (factors.days_since_last_similar_format && factors.days_since_last_similar_format > 30) {
    score += 10;
  }
  
  if (factors.days_since_last_similar_topic && factors.days_since_last_similar_topic > 90) {
    score += 10;
  } else if (factors.days_since_last_similar_topic && factors.days_since_last_similar_topic > 30) {
    score += 5;
  }
  
  return Math.min(100, score);
}

/**
 * Detect novelty factors for a video
 */
async function detectNoveltyFactorsHandler(
  params: NoveltyFactorsParams,
  context?: any
): Promise<ToolResponse<NoveltyFactorsResponse>> {
  const {
    video_id,
    compare_last_n = 100,
    include_format_analysis = true,
    include_topic_analysis = true
  } = params;
  
  // Validate inputs
  if (!video_id) {
    return {
      success: false,
      error: {
        code: 'INVALID_PARAMS',
        message: 'video_id is required'
      }
    };
  }
  
  try {
    // Get target video details
    const { data: video, error: videoError } = await supabase
      .from('videos')
      .select('*')
      .eq('id', video_id)
      .single();
    
    if (videoError || !video) {
      return {
        success: false,
        error: {
          code: 'VIDEO_NOT_FOUND',
          message: `Video ${video_id} not found`
        }
      };
    }
    
    // Get channel history before this video
    const { data: channelHistory, error: historyError } = await supabase
      .from('videos')
      .select('*')
      .eq('channel_id', video.channel_id)
      .lt('published_at', video.published_at)
      .eq('is_short', false)
      .order('published_at', { ascending: false })
      .limit(compare_last_n);
    
    if (historyError) {
      throw new Error(`Failed to fetch channel history: ${historyError.message}`);
    }
    
    const history = channelHistory || [];
    
    // Analyze novelty factors
    const noveltyFactors = {
      is_first_in_format: false,
      is_first_in_topic: false,
      is_first_in_cluster: false,
      days_since_last_similar_format: null as number | null,
      days_since_last_similar_topic: null as number | null,
      tps_vs_similar_format: null as number | null,
      tps_vs_similar_topic: null as number | null
    };
    
    const uniqueElements: string[] = [];
    
    // Check format novelty
    if (video.format_type) {
      const formatVideos = history.filter(h => h.format_type === video.format_type);
      noveltyFactors.is_first_in_format = formatVideos.length === 0;
      
      if (noveltyFactors.is_first_in_format) {
        uniqueElements.push(`First "${video.format_type}" format video`);
      } else if (formatVideos.length > 0) {
        // Calculate days since last similar format
        const lastFormatVideo = formatVideos[0];
        const daysDiff = Math.floor(
          (new Date(video.published_at).getTime() - new Date(lastFormatVideo.published_at).getTime()) 
          / (1000 * 60 * 60 * 24)
        );
        noveltyFactors.days_since_last_similar_format = daysDiff;
        
        // Compare TPS
        if (video.temporal_performance_score && formatVideos.length > 0) {
          const avgFormatTps = formatVideos
            .filter(v => v.temporal_performance_score !== null)
            .reduce((sum, v) => sum + v.temporal_performance_score!, 0) / formatVideos.length;
          noveltyFactors.tps_vs_similar_format = video.temporal_performance_score / avgFormatTps;
        }
      }
    }
    
    // Check topic novelty
    if (video.topic_niche) {
      const topicVideos = history.filter(h => h.topic_niche === video.topic_niche);
      noveltyFactors.is_first_in_topic = topicVideos.length === 0;
      
      if (noveltyFactors.is_first_in_topic) {
        uniqueElements.push(`First "${video.topic_niche}" topic video`);
      } else if (topicVideos.length > 0) {
        // Calculate days since last similar topic
        const lastTopicVideo = topicVideos[0];
        const daysDiff = Math.floor(
          (new Date(video.published_at).getTime() - new Date(lastTopicVideo.published_at).getTime()) 
          / (1000 * 60 * 60 * 24)
        );
        noveltyFactors.days_since_last_similar_topic = daysDiff;
        
        // Compare TPS
        if (video.temporal_performance_score && topicVideos.length > 0) {
          const avgTopicTps = topicVideos
            .filter(v => v.temporal_performance_score !== null)
            .reduce((sum, v) => sum + v.temporal_performance_score!, 0) / topicVideos.length;
          noveltyFactors.tps_vs_similar_topic = video.temporal_performance_score / avgTopicTps;
        }
      }
    }
    
    // Check cluster novelty
    if (video.topic_cluster_id !== null) {
      const clusterVideos = history.filter(h => h.topic_cluster_id === video.topic_cluster_id);
      noveltyFactors.is_first_in_cluster = clusterVideos.length === 0;
      
      if (noveltyFactors.is_first_in_cluster) {
        uniqueElements.push(`First in cluster ${video.topic_cluster_id}`);
      }
    }
    
    // Add timing-based unique elements
    if (noveltyFactors.days_since_last_similar_format && noveltyFactors.days_since_last_similar_format > 90) {
      uniqueElements.push(`${noveltyFactors.days_since_last_similar_format} days since last ${video.format_type}`);
    }
    if (noveltyFactors.days_since_last_similar_topic && noveltyFactors.days_since_last_similar_topic > 90) {
      uniqueElements.push(`${noveltyFactors.days_since_last_similar_topic} days since last ${video.topic_niche}`);
    }
    
    // Build optional analyses
    let formatHistory = undefined;
    if (include_format_analysis && video.format_type) {
      const formatVideos = history.filter(h => h.format_type === video.format_type);
      const tpsValues = formatVideos
        .map(v => v.temporal_performance_score)
        .filter((tps): tps is number => tps !== null);
      
      formatHistory = {
        total_videos_in_format: formatVideos.length,
        avg_tps_in_format: tpsValues.length > 0 
          ? tpsValues.reduce((sum, v) => sum + v, 0) / tpsValues.length 
          : null,
        last_video_date: formatVideos.length > 0 ? formatVideos[0].published_at : null
      };
    }
    
    let topicHistory = undefined;
    if (include_topic_analysis && video.topic_niche) {
      const topicVideos = history.filter(h => h.topic_niche === video.topic_niche);
      const tpsValues = topicVideos
        .map(v => v.temporal_performance_score)
        .filter((tps): tps is number => tps !== null);
      
      topicHistory = {
        total_videos_in_topic: topicVideos.length,
        avg_tps_in_topic: tpsValues.length > 0 
          ? tpsValues.reduce((sum, v) => sum + v, 0) / tpsValues.length 
          : null,
        last_video_date: topicVideos.length > 0 ? topicVideos[0].published_at : null
      };
    }
    
    const response: NoveltyFactorsResponse = {
      video_id,
      video_details: {
        title: video.title,
        tps: video.temporal_performance_score,
        format_type: video.format_type,
        topic_niche: video.topic_niche,
        topic_cluster_id: video.topic_cluster_id,
        published_at: video.published_at
      },
      novelty_factors: noveltyFactors,
      format_history: formatHistory,
      topic_history: topicHistory,
      differentiation_score: calculateDifferentiationScore(noveltyFactors),
      unique_elements: uniqueElements
    };
    
    return {
      success: true,
      data: response
    };
    
  } catch (error: any) {
    console.error('Error detecting novelty factors:', error);
    return {
      success: false,
      error: {
        code: 'DATABASE_ERROR',
        message: 'Failed to detect novelty factors',
        details: error.message,
        retryable: true
      }
    };
  }
}

// Wrap handler with caching and retry logic
const wrappedHandler = wrapTool({
  name: 'detect_novelty_factors',
  description: 'Identify what makes a video unique compared to channel history',
  parameters: {
    type: 'object',
    properties: {
      video_id: {
        type: 'string',
        description: 'Video ID to analyze'
      },
      compare_last_n: {
        type: 'number',
        description: 'Number of previous videos to compare against',
        default: 100
      },
      include_format_analysis: {
        type: 'boolean',
        description: 'Include format-specific analysis',
        default: true
      },
      include_topic_analysis: {
        type: 'boolean',
        description: 'Include topic-specific analysis',
        default: true
      }
    },
    required: ['video_id']
  },
  handler: detectNoveltyFactorsHandler,
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
export { detectNoveltyFactorsHandler, calculateDifferentiationScore };