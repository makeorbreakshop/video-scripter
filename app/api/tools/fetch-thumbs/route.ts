/**
 * API endpoint for fetch_thumbs tool
 * Batch fetch thumbnail URLs for multiple videos
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

interface FetchThumbsParams {
  video_ids: string[];
  validate_urls?: boolean;
  include_metadata?: boolean;
}

interface ThumbnailData {
  video_id: string;
  thumbnail_url: string | null;
  is_valid?: boolean;
  title?: string;
  channel_name?: string;
}

interface FetchThumbsResponse {
  video_count: number;
  thumbnails: ThumbnailData[];
  missing_videos: string[];
}

/**
 * Validate thumbnail URL is accessible
 */
async function validateUrl(url: string): Promise<boolean> {
  try {
    const response = await fetch(url, { method: 'HEAD' });
    return response.ok;
  } catch {
    return false;
  }
}

/**
 * Batch fetch thumbnail URLs
 */
async function fetchThumbsHandler(
  params: FetchThumbsParams,
  context?: any
): Promise<ToolResponse<FetchThumbsResponse>> {
  const {
    video_ids,
    validate_urls = false,
    include_metadata = false
  } = params;
  
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
    // Build select query
    let selectFields = 'id, thumbnail_url';
    if (include_metadata) {
      selectFields += ', title, channel_name';
    }
    
    // Batch fetch thumbnail data
    const { data: videos, error } = await supabase
      .from('videos')
      .select(selectFields)
      .in('id', safeVideoIds);
    
    if (error) {
      throw new Error(`Failed to fetch videos: ${error.message}`);
    }
    
    const foundVideos = videos || [];
    const foundIds = new Set(foundVideos.map(v => v.id));
    const missingVideos = safeVideoIds.filter(id => !foundIds.has(id));
    
    // Process thumbnails
    const thumbnails: ThumbnailData[] = [];
    
    for (const video of foundVideos) {
      const thumb: ThumbnailData = {
        video_id: video.id,
        thumbnail_url: video.thumbnail_url
      };
      
      if (include_metadata) {
        thumb.title = video.title;
        thumb.channel_name = video.channel_name;
      }
      
      // Validate URL if requested
      if (validate_urls && video.thumbnail_url) {
        thumb.is_valid = await validateUrl(video.thumbnail_url);
      }
      
      thumbnails.push(thumb);
    }
    
    const response: FetchThumbsResponse = {
      video_count: thumbnails.length,
      thumbnails,
      missing_videos: missingVideos
    };
    
    return {
      success: true,
      data: response
    };
    
  } catch (error: any) {
    console.error('Error fetching thumbnails:', error);
    return {
      success: false,
      error: {
        code: 'DATABASE_ERROR',
        message: 'Failed to fetch thumbnails',
        details: error.message,
        retryable: true
      }
    };
  }
}

// Wrap handler with caching and retry logic
const wrappedHandler = wrapTool({
  name: 'fetch_thumbs',
  description: 'Batch fetch thumbnail URLs for multiple videos',
  parameters: {
    type: 'object',
    properties: {
      video_ids: {
        type: 'array',
        items: { type: 'string' },
        description: 'List of video IDs to fetch thumbnails for (max 200)',
        maxItems: 200
      },
      validate_urls: {
        type: 'boolean',
        description: 'Check if thumbnail URLs are accessible',
        default: false
      },
      include_metadata: {
        type: 'boolean',
        description: 'Include video title and channel name',
        default: false
      }
    },
    required: ['video_ids']
  },
  handler: fetchThumbsHandler,
  parallelSafe: true,
  cacheTTL: 600, // Cache for 10 minutes (URLs are stable)
  timeout: 15000, // 15 seconds if validating URLs
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
export { fetchThumbsHandler, validateUrl };