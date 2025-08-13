/**
 * API endpoint for search_thumbs tool
 * Visual similarity search on thumbnails using CLIP vectors and Pinecone
 */

import { NextRequest, NextResponse } from 'next/server';
import { Pinecone } from '@pinecone-database/pinecone';
import Replicate from 'replicate';
import { createClient } from '@supabase/supabase-js';
import { SearchResult, SearchFilters, ToolResponse } from '@/types/tools';
import { wrapTool, createToolContext } from '@/lib/tools/base-wrapper';

// Initialize clients
const pinecone = new Pinecone({
  apiKey: process.env.PINECONE_API_KEY!
});

const replicate = new Replicate({
  auth: process.env.REPLICATE_API_TOKEN!
});

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

interface SearchThumbsParams {
  query: string | string[];  // Text query or image URL(s)
  query_type?: 'text' | 'image';
  filters?: SearchFilters;
  top_k?: number;
  min_score?: number;
}

interface SearchThumbsResponse {
  query: string | string[];
  results: SearchResult[];
  total_results: number;
}

/**
 * Generate CLIP embedding from text or image
 */
async function generateCLIPEmbedding(input: string, type: 'text' | 'image'): Promise<number[]> {
  try {
    // Using CLIP model via Replicate
    const model = "pharmapsychotic/clip-interrogator:a4a8bafd6089e1716b06057c42b19378250d008b80fe87caa5cd36d40c1eda90";
    
    if (type === 'text') {
      // Generate text embedding
      const output = await replicate.run(model, {
        input: {
          mode: "embedding",
          text: input,
          clip_model_name: "ViT-L-14/openai"
        }
      });
      
      return output as number[];
    } else {
      // Generate image embedding from URL
      const output = await replicate.run(model, {
        input: {
          mode: "embedding",
          image: input,
          clip_model_name: "ViT-L-14/openai"
        }
      });
      
      return output as number[];
    }
  } catch (error) {
    console.error('Error generating CLIP embedding:', error);
    throw new Error('Failed to generate CLIP embedding');
  }
}

/**
 * Search thumbnails using visual similarity
 */
async function searchThumbsHandler(
  params: SearchThumbsParams,
  context?: any
): Promise<ToolResponse<SearchThumbsResponse>> {
  const {
    query,
    query_type = 'text',
    filters = {},
    top_k = 10,
    min_score = 0.2
  } = params;

  // Validate inputs
  if (!query || (Array.isArray(query) && query.length === 0)) {
    return {
      success: false,
      error: {
        code: 'INVALID_PARAMS',
        message: 'query is required and must not be empty'
      }
    };
  }

  const safeTopK = Math.min(Math.max(1, top_k), 100);

  try {
    // Generate CLIP embeddings for query
    let queryEmbeddings: number[][] = [];
    
    if (Array.isArray(query)) {
      // Multiple queries - generate embeddings for each
      for (const q of query) {
        const embedding = await generateCLIPEmbedding(q, query_type);
        queryEmbeddings.push(embedding);
      }
    } else {
      // Single query
      const embedding = await generateCLIPEmbedding(query, query_type);
      queryEmbeddings.push(embedding);
    }

    // Connect to Pinecone thumbnail index
    const index = pinecone.index(process.env.PINECONE_THUMBNAIL_INDEX_NAME!);

    // Build metadata filter for Pinecone
    const pineconeFilter: any = {};

    if (filters.niches && filters.niches.length > 0) {
      pineconeFilter.topic_niche = { $in: filters.niches };
    }

    if (filters.channels && filters.channels.length > 0) {
      pineconeFilter.channel_id = { $in: filters.channels };
    }

    if (filters.dateRange) {
      if (filters.dateRange.start) {
        pineconeFilter.published_at = pineconeFilter.published_at || {};
        pineconeFilter.published_at.$gte = filters.dateRange.start.toISOString();
      }
      if (filters.dateRange.end) {
        pineconeFilter.published_at = pineconeFilter.published_at || {};
        pineconeFilter.published_at.$lte = filters.dateRange.end.toISOString();
      }
    }

    if (filters.minTPS !== undefined) {
      pineconeFilter.temporal_performance_score = pineconeFilter.temporal_performance_score || {};
      pineconeFilter.temporal_performance_score.$gte = filters.minTPS;
    }

    if (filters.maxTPS !== undefined) {
      pineconeFilter.temporal_performance_score = pineconeFilter.temporal_performance_score || {};
      pineconeFilter.temporal_performance_score.$lte = filters.maxTPS;
    }

    if (filters.excludeShorts !== false) {
      pineconeFilter.is_short = false;
    }

    // Query Pinecone for each embedding and combine results
    const allMatches = new Map<string, { score: number; metadata: any }>();

    for (const embedding of queryEmbeddings) {
      const queryOptions: any = {
        vector: embedding,
        topK: safeTopK * 2,  // Get extra results for post-filtering
        includeMetadata: true
      };

      if (Object.keys(pineconeFilter).length > 0) {
        queryOptions.filter = pineconeFilter;
      }

      const pineconeResponse = await index.query(queryOptions);

      // Aggregate results (take max score if video appears multiple times)
      for (const match of pineconeResponse.matches || []) {
        const existing = allMatches.get(match.id);
        if (!existing || (match.score || 0) > existing.score) {
          allMatches.set(match.id, {
            score: match.score || 0,
            metadata: match.metadata || {}
          });
        }
      }
    }

    // Convert to array and sort by score
    const sortedResults = Array.from(allMatches.entries())
      .map(([id, data]) => ({
        video_id: id,
        similarity_score: data.score,
        metadata: data.metadata
      }))
      .sort((a, b) => b.similarity_score - a.similarity_score)
      .filter(match => match.similarity_score >= min_score)
      .slice(0, safeTopK);

    // Enrich with additional data if requested
    let enrichedResults = sortedResults;
    
    if (sortedResults.length > 0 && context?.enrichMetadata) {
      const videoIds = sortedResults.map(r => r.video_id);
      
      const { data: videos } = await supabase
        .from('videos')
        .select(`
          id, 
          title, 
          channel_name, 
          view_count, 
          published_at,
          temporal_performance_score,
          thumbnail_url,
          format_type,
          topic_niche
        `)
        .in('id', videoIds);

      if (videos) {
        const videoMap = new Map(videos.map(v => [v.id, v]));
        enrichedResults = sortedResults.map(result => ({
          ...result,
          metadata: {
            ...result.metadata,
            ...(videoMap.get(result.video_id) || {})
          }
        }));
      }
    }

    const response: SearchThumbsResponse = {
      query,
      results: enrichedResults,
      total_results: enrichedResults.length
    };

    return {
      success: true,
      data: response
    };

  } catch (error: any) {
    console.error('Error searching thumbnails:', error);
    
    // Determine error type
    let errorCode = 'SEARCH_ERROR';
    let retryable = false;
    
    if (error.message?.includes('rate limit')) {
      errorCode = 'RATE_LIMIT';
      retryable = true;
    } else if (error.message?.includes('CLIP')) {
      errorCode = 'EMBEDDING_ERROR';
      retryable = true;
    } else if (error.message?.includes('Pinecone')) {
      errorCode = 'PINECONE_ERROR';
      retryable = true;
    } else if (error.message?.includes('Replicate')) {
      errorCode = 'REPLICATE_ERROR';
      retryable = true;
    }

    return {
      success: false,
      error: {
        code: errorCode,
        message: 'Failed to search thumbnails',
        details: error.message,
        retryable
      }
    };
  }
}

// Wrap handler with caching and retry logic
const wrappedHandler = wrapTool({
  name: 'search_thumbs',
  description: 'Visual similarity search on thumbnails using CLIP vectors',
  parameters: {
    type: 'object',
    properties: {
      query: {
        oneOf: [
          { type: 'string' },
          { type: 'array', items: { type: 'string' } }
        ],
        description: 'Text description or image URL(s) to search for'
      },
      query_type: {
        type: 'string',
        enum: ['text', 'image'],
        default: 'text',
        description: 'Type of query - text description or image URL'
      },
      filters: {
        type: 'object',
        properties: {
          niches: {
            type: 'array',
            items: { type: 'string' },
            description: 'Filter by topic niches'
          },
          channels: {
            type: 'array',
            items: { type: 'string' },
            description: 'Filter by channel IDs'
          },
          dateRange: {
            type: 'object',
            properties: {
              start: { type: 'string', format: 'date-time' },
              end: { type: 'string', format: 'date-time' }
            }
          },
          minTPS: {
            type: 'number',
            description: 'Minimum temporal performance score'
          },
          maxTPS: {
            type: 'number',
            description: 'Maximum temporal performance score'
          },
          excludeShorts: {
            type: 'boolean',
            default: true,
            description: 'Exclude YouTube Shorts'
          }
        }
      },
      top_k: {
        type: 'number',
        description: 'Number of results to return (1-100)',
        default: 10,
        minimum: 1,
        maximum: 100
      },
      min_score: {
        type: 'number',
        description: 'Minimum similarity score (0-1)',
        default: 0.2,
        minimum: 0,
        maximum: 1
      }
    },
    required: ['query']
  },
  handler: searchThumbsHandler,
  parallelSafe: true,
  cacheTTL: 300, // Cache for 5 minutes
  timeout: 15000, // 15 seconds for CLIP embedding + search
  retryConfig: {
    maxRetries: 3,
    backoffMs: 2000  // Longer backoff for Replicate
  }
});

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const context = createToolContext({
      requestId: request.headers.get('x-request-id') || undefined,
      mode: request.headers.get('x-analysis-mode') as 'classic' | 'agentic' || 'agentic',
      enrichMetadata: body.enrich_metadata || false
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
export { searchThumbsHandler, generateCLIPEmbedding };