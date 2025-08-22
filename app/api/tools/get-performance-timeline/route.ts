/**
 * API endpoint for get_performance_timeline tool
 * Queries view_snapshots table to show TPS evolution over time
 */

import { NextRequest, NextResponse } from 'next/server';
import { getSupabase } from '@/lib/supabase-lazy';
import { ToolResponse } from '@/types/tools';
import { wrapTool, createToolContext } from '@/lib/tools/base-wrapper';

// Initialize Supabase client

interface PerformanceTimelineParams {
  video_id: string;
  include_milestones?: boolean;
}

interface TimelinePoint {
  day: number;
  views: number;
  tps: number;
  date: string;
}

interface PerformanceTimelineResponse {
  video_id: string;
  channel_baseline: number | null;
  current_tps: number | null;
  timeline: TimelinePoint[];
  milestones?: {
    day_1?: TimelinePoint;
    day_7?: TimelinePoint;
    day_30?: TimelinePoint;
    day_90?: TimelinePoint;
  };
  has_data: boolean;
}

/**
 * Get performance timeline for a video
 */
async function getPerformanceTimelineHandler(
  params: PerformanceTimelineParams,
  context?: any
): Promise<ToolResponse<PerformanceTimelineResponse>> {
  const { video_id, include_milestones = true } = params;
  
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
    // Get video info and baseline
    const { data: video, error: videoError } = await supabase
      .from('videos')
      .select('channel_baseline_at_publish, temporal_performance_score')
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
    
    // Get view snapshots
    const { data: snapshots, error: snapshotError } = await supabase
      .from('view_snapshots')
      .select('days_since_published, view_count, snapshot_date')
      .eq('video_id', video_id)
      .order('days_since_published', { ascending: true });
    
    if (snapshotError) {
      throw new Error(`Failed to fetch snapshots: ${snapshotError.message}`);
    }
    
    // Process timeline
    const baseline = video.channel_baseline_at_publish || 1;
    const timeline: TimelinePoint[] = (snapshots || []).map(s => ({
      day: s.days_since_published,
      views: s.view_count,
      tps: s.view_count / baseline,
      date: s.snapshot_date
    }));
    
    // Extract milestones if requested
    let milestones = undefined;
    if (include_milestones && timeline.length > 0) {
      milestones = {
        day_1: timeline.find(t => t.day === 1),
        day_7: timeline.find(t => t.day >= 6 && t.day <= 8),
        day_30: timeline.find(t => t.day >= 28 && t.day <= 32),
        day_90: timeline.find(t => t.day >= 85 && t.day <= 95)
      };
    }
    
    const response: PerformanceTimelineResponse = {
      video_id,
      channel_baseline: video.channel_baseline_at_publish,
      current_tps: video.temporal_performance_score,
      timeline,
      milestones,
      has_data: timeline.length > 0
    };
    
    return {
      success: true,
      data: response
    };
    
  } catch (error: any) {
    console.error('Error fetching performance timeline:', error);
    return {
      success: false,
      error: {
        code: 'DATABASE_ERROR',
        message: 'Failed to fetch performance timeline',
        details: error.message,
        retryable: true
      }
    };
  }
}

// Wrap handler with caching and retry logic
const wrappedHandler = wrapTool({
  name: 'get_performance_timeline',
  description: 'Fetch performance timeline showing TPS evolution over time',
  parameters: {
    type: 'object',
    properties: {
      video_id: {
        type: 'string',
        description: 'Video ID to fetch timeline for'
      },
      include_milestones: {
        type: 'boolean',
        description: 'Include key milestone data points',
        default: true
      }
    },
    required: ['video_id']
  },
  handler: getPerformanceTimelineHandler,
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
export { getPerformanceTimelineHandler };