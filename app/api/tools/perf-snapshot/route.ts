/**
 * API endpoint for perf_snapshot tool
 * Batch fetch temporal performance scores and curve shapes for multiple videos
 */

import { NextRequest, NextResponse } from 'next/server';
import { getSupabase } from '@/lib/supabase-lazy';
import { ToolResponse } from '@/types/tools';
import { wrapTool, createToolContext } from '@/lib/tools/base-wrapper';

// Initialize Supabase client

interface PerfSnapshotParams {
  video_ids: string[];
}

interface VideoPerformance {
  video_id: string;
  temporal_performance_score: number | null;
  channel_baseline_at_publish: number | null;
  view_count: number;
  published_at: string;
  age_days: number;
  performance_category: string;
}

interface PerfSnapshotResponse {
  video_count: number;
  performances: VideoPerformance[];
  missing_videos: string[];
  avg_tps: number | null;
  median_tps: number | null;
  distribution: {
    viral: number;      // >= 3.0
    outperforming: number;  // 2.0-3.0
    standard: number;   // 1.0-2.0
    underperforming: number; // < 1.0
  };
}

/**
 * Get performance category based on TPS
 */
function getPerformanceCategory(tps: number | null): string {
  if (tps === null) return 'unknown';
  if (tps >= 3.0) return 'viral';
  if (tps >= 2.0) return 'outperforming';
  if (tps >= 1.0) return 'standard';
  return 'underperforming';
}

/**
 * Batch fetch performance data for multiple videos
 */
async function perfSnapshotHandler(
  params: PerfSnapshotParams,
  context?: any
): Promise<ToolResponse<PerfSnapshotResponse>> {
  const { video_ids } = params;
  
  // Validate inputs
  if (!video_ids || !Array.isArray(video_ids) || video_ids.length === 0) {
    return {
      success: false,
      error: {
        code: 'INVALID_PARAMS',
        message: 'video_ids array is required and must not be empty'
      }
    };
  }
  
  // Limit to 200 videos per call
  const safeVideoIds = video_ids.slice(0, 200);
  
  try {
    // Batch fetch video performance data
    const { data: videos, error } = await supabase
      .from('videos')
      .select(`
        id,
        temporal_performance_score,
        channel_baseline_at_publish,
        view_count,
        published_at
      `)
      .in('id', safeVideoIds);
    
    if (error) {
      throw new Error(`Failed to fetch videos: ${error.message}`);
    }
    
    const foundVideos = videos || [];
    const foundIds = new Set(foundVideos.map(v => v.id));
    const missingVideos = safeVideoIds.filter(id => !foundIds.has(id));
    
    // Process each video and calculate statistics
    const performances: VideoPerformance[] = [];
    const tpsValues: number[] = [];
    const distribution = {
      viral: 0,
      outperforming: 0,
      standard: 0,
      underperforming: 0
    };
    
    for (const video of foundVideos) {
      // Calculate age in days
      const publishedDate = new Date(video.published_at);
      const now = new Date();
      const ageDays = Math.floor((now.getTime() - publishedDate.getTime()) / (1000 * 60 * 60 * 24));
      
      // Calculate TPS if missing but baseline exists
      let tps = video.temporal_performance_score;
      if (tps === null && video.channel_baseline_at_publish && video.view_count) {
        tps = video.view_count / video.channel_baseline_at_publish;
      }
      
      // Track TPS for statistics
      if (tps !== null) {
        tpsValues.push(tps);
        
        // Update distribution
        if (tps >= 3.0) distribution.viral++;
        else if (tps >= 2.0) distribution.outperforming++;
        else if (tps >= 1.0) distribution.standard++;
        else distribution.underperforming++;
      }
      
      const perf: VideoPerformance = {
        video_id: video.id,
        temporal_performance_score: tps,
        channel_baseline_at_publish: video.channel_baseline_at_publish,
        view_count: video.view_count,
        published_at: video.published_at,
        age_days: ageDays,
        performance_category: getPerformanceCategory(tps)
      };
      
      performances.push(perf);
    }
    
    // Sort by TPS descending
    performances.sort((a, b) => 
      (b.temporal_performance_score || 0) - (a.temporal_performance_score || 0)
    );
    
    // Calculate statistics
    const avgTps = tpsValues.length > 0 
      ? tpsValues.reduce((sum, val) => sum + val, 0) / tpsValues.length 
      : null;
    
    const medianTps = tpsValues.length > 0
      ? tpsValues.sort((a, b) => a - b)[Math.floor(tpsValues.length / 2)]
      : null;
    
    const response: PerfSnapshotResponse = {
      video_count: performances.length,
      performances,
      missing_videos: missingVideos,
      avg_tps: avgTps,
      median_tps: medianTps,
      distribution
    };
    
    return {
      success: true,
      data: response
    };
    
  } catch (error: any) {
    console.error('Error fetching performance snapshot:', error);
    return {
      success: false,
      error: {
        code: 'DATABASE_ERROR',
        message: 'Failed to fetch performance snapshot',
        details: error.message,
        retryable: true
      }
    };
  }
}

// Wrap handler with caching and retry logic
const wrappedHandler = wrapTool({
  name: 'perf_snapshot',
  description: 'Batch fetch temporal performance scores and curve shapes',
  parameters: {
    type: 'object',
    properties: {
      video_ids: {
        type: 'array',
        items: { type: 'string' },
        description: 'List of video IDs to fetch performance for (max 200)',
        maxItems: 200
      }
    },
    required: ['video_ids']
  },
  handler: perfSnapshotHandler,
  parallelSafe: true,
  cacheTTL: 300, // Cache for 5 minutes
  timeout: 10000, // 10 seconds for batch operation
  retryConfig: {
    maxRetries: 3,
    backoffMs: 1000
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
export { perfSnapshotHandler, getPerformanceCategory };