/**
 * API endpoint for list_channel_history tool
 * Returns recent videos from a channel with specified fields
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { ToolResponse } from '@/types/tools';
import { wrapTool, createToolContext } from '@/lib/tools/base-wrapper';

// Initialize Supabase client
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

interface ChannelHistoryParams {
  channel_id: string;
  fields?: string[];  // Which fields to include
  limit?: number;     // Max videos to return (default 20, max 50)
  offset?: number;    // Pagination offset
  include_shorts?: boolean;  // Include YouTube Shorts
  min_date?: string;  // Only videos after this date
  max_date?: string;  // Only videos before this date
}

interface ChannelHistoryResponse {
  channel_id: string;
  videos: any[];
  total_count: number;
  has_more: boolean;
}

/**
 * List recent videos from a channel
 */
async function listChannelHistoryHandler(
  params: ChannelHistoryParams,
  context?: any
): Promise<ToolResponse<ChannelHistoryResponse>> {
  const { 
    channel_id,
    fields = [
      'id', 'title', 'view_count', 'published_at',
      'temporal_performance_score', 'format_type', 'topic_niche'
    ],
    limit = 20,
    offset = 0,
    include_shorts = false,
    min_date,
    max_date
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

  // Enforce limit constraints
  const safeLimit = Math.min(Math.max(1, limit), 50);

  try {
    // Build the select query with requested fields
    const validFields = [
      'id', 'title', 'channel_id', 'channel_name', 'view_count',
      'published_at', 'temporal_performance_score', 'channel_baseline_at_publish',
      'is_short', 'format_type', 'topic_niche', 'topic_cluster_id',
      'thumbnail_url', 'description', 'tags', 'duration', 'like_count',
      'comment_count', 'import_date'
    ];

    // Filter to only valid fields
    const selectedFields = fields.filter(f => validFields.includes(f));
    
    // Always include id and published_at for proper ordering
    if (!selectedFields.includes('id')) selectedFields.push('id');
    if (!selectedFields.includes('published_at')) selectedFields.push('published_at');

    // Build query
    let query = supabase
      .from('videos')
      .select(selectedFields.join(','))
      .eq('channel_id', channel_id)
      .order('published_at', { ascending: false });

    // Apply filters
    if (!include_shorts) {
      query = query.eq('is_short', false);
    }

    if (min_date) {
      query = query.gte('published_at', min_date);
    }

    if (max_date) {
      query = query.lte('published_at', max_date);
    }

    // Get total count for pagination
    const countQuery = supabase
      .from('videos')
      .select('id', { count: 'exact', head: true })
      .eq('channel_id', channel_id);

    if (!include_shorts) {
      countQuery.eq('is_short', false);
    }
    if (min_date) {
      countQuery.gte('published_at', min_date);
    }
    if (max_date) {
      countQuery.lte('published_at', max_date);
    }

    const { count, error: countError } = await countQuery;

    if (countError) {
      throw new Error(`Failed to get count: ${countError.message}`);
    }

    // Apply pagination
    query = query.range(offset, offset + safeLimit - 1);

    const { data: videos, error } = await query;

    if (error) {
      throw new Error(`Failed to fetch videos: ${error.message}`);
    }

    // Process videos to ensure consistent format
    const processedVideos = (videos || []).map(video => {
      // Calculate TPS if missing but baseline exists
      if (
        selectedFields.includes('temporal_performance_score') &&
        video.temporal_performance_score === null &&
        video.channel_baseline_at_publish &&
        video.view_count
      ) {
        video.temporal_performance_score = video.view_count / video.channel_baseline_at_publish;
      }
      return video;
    });

    const response: ChannelHistoryResponse = {
      channel_id,
      videos: processedVideos,
      total_count: count || 0,
      has_more: (offset + safeLimit) < (count || 0)
    };

    return {
      success: true,
      data: response
    };

  } catch (error: any) {
    console.error('Error fetching channel history:', error);
    return {
      success: false,
      error: {
        code: 'DATABASE_ERROR',
        message: 'Failed to fetch channel history',
        details: error.message,
        retryable: true
      }
    };
  }
}

// Wrap handler with caching and retry logic
const wrappedHandler = wrapTool({
  name: 'list_channel_history',
  description: 'List recent videos from a channel with flexible field selection',
  parameters: {
    type: 'object',
    properties: {
      channel_id: {
        type: 'string',
        description: 'The ID of the channel'
      },
      fields: {
        type: 'array',
        items: { type: 'string' },
        description: 'Fields to include in response',
        default: ['id', 'title', 'view_count', 'published_at', 'temporal_performance_score']
      },
      limit: {
        type: 'number',
        description: 'Maximum videos to return (1-50)',
        default: 20,
        minimum: 1,
        maximum: 50
      },
      offset: {
        type: 'number',
        description: 'Pagination offset',
        default: 0
      },
      include_shorts: {
        type: 'boolean',
        description: 'Include YouTube Shorts',
        default: false
      },
      min_date: {
        type: 'string',
        format: 'date-time',
        description: 'Only videos after this date'
      },
      max_date: {
        type: 'string',
        format: 'date-time',
        description: 'Only videos before this date'
      }
    },
    required: ['channel_id']
  },
  handler: listChannelHistoryHandler,
  parallelSafe: true,
  cacheTTL: 300, // Cache for 5 minutes
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
export { listChannelHistoryHandler };