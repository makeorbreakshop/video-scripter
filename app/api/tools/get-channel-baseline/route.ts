/**
 * API endpoint for get_channel_baseline tool
 * Returns the channel's baseline performance and sample videos
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { ChannelBaseline, ToolResponse } from '@/types/tools';
import { wrapTool, createToolContext } from '@/lib/tools/base-wrapper';

// Initialize Supabase client
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

/**
 * Get channel baseline performance metrics
 */
async function getChannelBaselineHandler(
  params: { 
    channel_id?: string;
    video_id?: string;  // Can provide video_id instead to get its channel's baseline
    include_samples?: boolean;
  },
  context?: any
): Promise<ToolResponse<ChannelBaseline>> {
  const { channel_id, video_id, include_samples = true } = params;
  
  // Validate inputs
  if (!channel_id && !video_id) {
    return {
      success: false,
      error: {
        code: 'INVALID_PARAMS',
        message: 'Either channel_id or video_id is required'
      }
    };
  }

  try {
    let targetChannelId = channel_id;
    let targetVideoDate: string | null = null;

    // If video_id provided, get channel_id and published_at from it
    if (video_id && !channel_id) {
      const { data: video, error } = await supabase
        .from('videos')
        .select('channel_id, published_at')
        .eq('id', video_id)
        .single();

      if (error || !video) {
        return {
          success: false,
          error: {
            code: 'VIDEO_NOT_FOUND',
            message: `Video ${video_id} not found`
          }
        };
      }

      targetChannelId = video.channel_id;
      targetVideoDate = video.published_at;
    }

    // Calculate baseline from last 10 videos within 30 days
    // This matches the channel_baseline_at_publish calculation
    const baselineQuery = supabase
      .from('videos')
      .select('id, title, view_count, temporal_performance_score, published_at')
      .eq('channel_id', targetChannelId)
      .eq('is_short', false)
      .gt('view_count', 0)
      .order('published_at', { ascending: false });

    // If we have a target date (from video_id), use it for the 30-day window
    if (targetVideoDate) {
      const thirtyDaysBeforeTarget = new Date(targetVideoDate);
      thirtyDaysBeforeTarget.setDate(thirtyDaysBeforeTarget.getDate() - 30);
      
      baselineQuery
        .lt('published_at', targetVideoDate)
        .gte('published_at', thirtyDaysBeforeTarget.toISOString());
    }

    const { data: videos, error: videosError } = await baselineQuery.limit(10);

    if (videosError) {
      throw new Error(`Failed to fetch videos: ${videosError.message}`);
    }

    if (!videos || videos.length === 0) {
      return {
        success: true,
        data: {
          channel_id: targetChannelId!,
          baseline_value: 1.0, // Default baseline
          sample_videos: [],
          calculated_at: new Date().toISOString()
        }
      };
    }

    // Calculate average view count as baseline
    const totalViews = videos.reduce((sum, v) => sum + (v.view_count || 0), 0);
    const baselineValue = totalViews / videos.length;

    // Get sample videos in the 0.8-1.2 TPS range if requested
    let sampleVideos: any[] = [];
    if (include_samples) {
      // Filter videos with TPS between 0.8 and 1.2 (near baseline performance)
      sampleVideos = videos
        .filter(v => {
          const tps = v.temporal_performance_score;
          return tps !== null && tps >= 0.8 && tps <= 1.2;
        })
        .slice(0, 5) // Take up to 5 samples
        .map(v => ({
          id: v.id,
          title: v.title,
          view_count: v.view_count,
          temporal_performance_score: v.temporal_performance_score
        }));

      // If no videos in that range, take the closest ones
      if (sampleVideos.length === 0) {
        sampleVideos = videos
          .filter(v => v.temporal_performance_score !== null)
          .sort((a, b) => {
            const aDiff = Math.abs((a.temporal_performance_score || 0) - 1.0);
            const bDiff = Math.abs((b.temporal_performance_score || 0) - 1.0);
            return aDiff - bDiff;
          })
          .slice(0, 3)
          .map(v => ({
            id: v.id,
            title: v.title,
            view_count: v.view_count,
            temporal_performance_score: v.temporal_performance_score
          }));
      }
    }

    const baseline: ChannelBaseline = {
      channel_id: targetChannelId!,
      baseline_value: Math.round(baselineValue),
      sample_videos: sampleVideos,
      calculated_at: new Date().toISOString()
    };

    return {
      success: true,
      data: baseline
    };

  } catch (error: any) {
    console.error('Error fetching channel baseline:', error);
    return {
      success: false,
      error: {
        code: 'DATABASE_ERROR',
        message: 'Failed to fetch channel baseline',
        details: error.message,
        retryable: true
      }
    };
  }
}

// Wrap handler with caching and retry logic
const wrappedHandler = wrapTool({
  name: 'get_channel_baseline',
  description: 'Get channel baseline performance metrics and sample videos',
  parameters: {
    type: 'object',
    properties: {
      channel_id: {
        type: 'string',
        description: 'The ID of the channel'
      },
      video_id: {
        type: 'string',
        description: 'Alternative: provide video ID to get its channel baseline'
      },
      include_samples: {
        type: 'boolean',
        description: 'Whether to include sample videos near baseline performance',
        default: true
      }
    },
    oneOf: [
      { required: ['channel_id'] },
      { required: ['video_id'] }
    ]
  },
  handler: getChannelBaselineHandler,
  parallelSafe: true,
  cacheTTL: 600, // Cache for 10 minutes
  timeout: 5000,
  retryConfig: {
    maxRetries: 3,
    backoffMs: 500
  }
});

export async function POST(request: NextRequest) {
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
export { getChannelBaselineHandler };