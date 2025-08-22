/**
 * API endpoint for get_video_bundle tool
 */

import { NextRequest, NextResponse } from 'next/server';
import { getSupabase } from '@/lib/supabase-lazy';
import { VideoBundle, ToolResponse } from '@/types/tools';
import { wrapTool, createToolContext } from '@/lib/tools/base-wrapper';

// Initialize Supabase client

/**
 * Fetch comprehensive video data including performance metrics
 */
async function getVideoBundleHandler(
  params: { video_id: string },
  context?: any
): Promise<ToolResponse<VideoBundle>> {
  const { video_id } = params;
  
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
    // Fetch video data with all required fields
    const { data: video, error } = await supabase
      .from('videos')
      .select(`
        id,
        title,
        channel_id,
        channel_name,
        view_count,
        published_at,
        temporal_performance_score,
        channel_baseline_at_publish,
        is_short,
        format_type,
        topic_niche,
        topic_cluster_id,
        thumbnail_url,
        description,
        duration
      `)
      .eq('id', video_id)
      .single();

    if (error || !video) {
      return {
        success: false,
        error: {
          code: 'VIDEO_NOT_FOUND',
          message: error?.message || `Video ${video_id} not found`
        }
      };
    }

    // Fetch summary from analyses table if available
    const { data: analysis } = await supabase
      .from('analyses')
      .select('summary')
      .eq('video_id', video_id)
      .single();

    // Calculate temporal_performance_score if missing
    let tps = video.temporal_performance_score;
    if (tps === null && video.channel_baseline_at_publish && video.channel_baseline_at_publish > 0) {
      // Simple calculation: views / baseline
      tps = video.view_count / video.channel_baseline_at_publish;
    }

    // Use default baseline if missing
    const baseline = video.channel_baseline_at_publish || 1.0;

    // Construct video bundle
    const bundle: VideoBundle = {
      id: video.id,
      title: video.title,
      channel_id: video.channel_id,
      channel_name: video.channel_name,
      view_count: video.view_count,
      published_at: video.published_at,
      temporal_performance_score: tps,
      channel_baseline_at_publish: baseline,
      is_short: video.is_short || false,
      format_type: video.format_type,
      topic_niche: video.topic_niche,
      topic_cluster_id: video.topic_cluster_id,
      thumbnail_url: video.thumbnail_url,
      summary: analysis?.summary || video.description?.substring(0, 500) || null,
      tags: [], // Tags not available in current schema
      duration: video.duration
    };

    return {
      success: true,
      data: bundle
    };

  } catch (error: any) {
    console.error('Error fetching video bundle:', error);
    return {
      success: false,
      error: {
        code: 'DATABASE_ERROR',
        message: 'Failed to fetch video data',
        details: error.message,
        retryable: true
      }
    };
  }
}

// Wrap handler with caching and retry logic
const wrappedHandler = wrapTool({
  name: 'get_video_bundle',
  description: 'Fetch comprehensive video data including performance metrics',
  parameters: {
    type: 'object',
    properties: {
      video_id: {
        type: 'string',
        description: 'The ID of the video to fetch'
      }
    },
    required: ['video_id']
  },
  handler: getVideoBundleHandler,
  parallelSafe: true,
  cacheTTL: 300, // Cache for 5 minutes
  timeout: 5000, // 5 second timeout
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
export { getVideoBundleHandler };