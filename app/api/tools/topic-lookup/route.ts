/**
 * API endpoint for topic_lookup tool
 * Batch fetch topic classifications and cluster information
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

interface TopicLookupParams {
  video_ids: string[];
  include_cluster_info?: boolean;
  include_related_topics?: boolean;
}

interface TopicData {
  video_id: string;
  topic_niche: string | null;
  topic_cluster_id: number | null;
  format_type: string | null;
  cluster_info?: {
    cluster_name: string;
    cluster_size: number;
    parent_topic: string;
  };
  related_topics?: string[];
}

interface TopicLookupResponse {
  video_count: number;
  topics: TopicData[];
  missing_videos: string[];
  unique_niches: string[];
  unique_clusters: number[];
}

/**
 * Get cluster information
 */
async function getClusterInfo(clusterId: number): Promise<any> {
  // In a real implementation, this would query a topic_clusters table
  // For now, we'll return mock data based on cluster ID patterns
  const clusterGroups: Record<string, any> = {
    '0-99': { parent: 'Technology', size: 'large' },
    '100-199': { parent: 'Gaming', size: 'large' },
    '200-299': { parent: 'Education', size: 'medium' },
    '300-399': { parent: 'Entertainment', size: 'large' },
    '400-499': { parent: 'Lifestyle', size: 'medium' },
    '500-599': { parent: 'Business', size: 'small' },
    '600-699': { parent: 'Science', size: 'small' },
    '700-776': { parent: 'Arts & Crafts', size: 'small' }
  };
  
  let parent = 'Unknown';
  let size = 'unknown';
  
  for (const [range, info] of Object.entries(clusterGroups)) {
    const [min, max] = range.split('-').map(Number);
    if (clusterId >= min && clusterId <= max) {
      parent = info.parent;
      size = info.size;
      break;
    }
  }
  
  return {
    cluster_name: `Cluster ${clusterId}`,
    cluster_size: size === 'large' ? 1000 : size === 'medium' ? 500 : 100,
    parent_topic: parent
  };
}

/**
 * Get related topics for a niche
 */
function getRelatedTopics(niche: string): string[] {
  const relatedMap: Record<string, string[]> = {
    'web-development': ['javascript', 'react', 'frontend', 'backend', 'fullstack'],
    'gaming': ['esports', 'game-reviews', 'lets-play', 'game-development'],
    'tech-reviews': ['gadgets', 'smartphones', 'computers', 'software'],
    'tutorial': ['how-to', 'diy', 'education', 'learning'],
    'entertainment': ['comedy', 'drama', 'music', 'vlogs'],
    'fitness': ['health', 'nutrition', 'workout', 'wellness'],
    'cooking': ['recipes', 'food-review', 'baking', 'cuisine'],
    'business': ['entrepreneurship', 'marketing', 'finance', 'productivity']
  };
  
  return relatedMap[niche] || [];
}

/**
 * Batch fetch topic classifications
 */
async function topicLookupHandler(
  params: TopicLookupParams,
  context?: any
): Promise<ToolResponse<TopicLookupResponse>> {
  const {
    video_ids,
    include_cluster_info = false,
    include_related_topics = false
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
    // Batch fetch topic data
    const { data: videos, error } = await supabase
      .from('videos')
      .select('id, topic_niche, topic_cluster_id, format_type')
      .in('id', safeVideoIds);
    
    if (error) {
      throw new Error(`Failed to fetch videos: ${error.message}`);
    }
    
    const foundVideos = videos || [];
    const foundIds = new Set(foundVideos.map(v => v.id));
    const missingVideos = safeVideoIds.filter(id => !foundIds.has(id));
    
    // Process topics
    const topics: TopicData[] = [];
    const uniqueNiches = new Set<string>();
    const uniqueClusters = new Set<number>();
    
    for (const video of foundVideos) {
      const topic: TopicData = {
        video_id: video.id,
        topic_niche: video.topic_niche,
        topic_cluster_id: video.topic_cluster_id,
        format_type: video.format_type
      };
      
      // Track unique values
      if (video.topic_niche) {
        uniqueNiches.add(video.topic_niche);
      }
      if (video.topic_cluster_id !== null) {
        uniqueClusters.add(video.topic_cluster_id);
      }
      
      // Add cluster info if requested
      if (include_cluster_info && video.topic_cluster_id !== null) {
        topic.cluster_info = await getClusterInfo(video.topic_cluster_id);
      }
      
      // Add related topics if requested
      if (include_related_topics && video.topic_niche) {
        topic.related_topics = getRelatedTopics(video.topic_niche);
      }
      
      topics.push(topic);
    }
    
    const response: TopicLookupResponse = {
      video_count: topics.length,
      topics,
      missing_videos: missingVideos,
      unique_niches: Array.from(uniqueNiches).sort(),
      unique_clusters: Array.from(uniqueClusters).sort((a, b) => a - b)
    };
    
    return {
      success: true,
      data: response
    };
    
  } catch (error: any) {
    console.error('Error fetching topic data:', error);
    return {
      success: false,
      error: {
        code: 'DATABASE_ERROR',
        message: 'Failed to fetch topic data',
        details: error.message,
        retryable: true
      }
    };
  }
}

// Wrap handler with caching and retry logic
const wrappedHandler = wrapTool({
  name: 'topic_lookup',
  description: 'Batch fetch topic classifications and cluster information',
  parameters: {
    type: 'object',
    properties: {
      video_ids: {
        type: 'array',
        items: { type: 'string' },
        description: 'List of video IDs to fetch topics for (max 200)',
        maxItems: 200
      },
      include_cluster_info: {
        type: 'boolean',
        description: 'Include detailed cluster information',
        default: false
      },
      include_related_topics: {
        type: 'boolean',
        description: 'Include related topic suggestions',
        default: false
      }
    },
    required: ['video_ids']
  },
  handler: topicLookupHandler,
  parallelSafe: true,
  cacheTTL: 600, // Cache for 10 minutes (topics are stable)
  timeout: 8000,
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
export { topicLookupHandler, getClusterInfo, getRelatedTopics };