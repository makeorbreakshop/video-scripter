/**
 * API endpoint for search_titles tool
 * Semantic search on video titles using OpenAI embeddings and Pinecone
 */

import { NextRequest, NextResponse } from 'next/server';
import { Pinecone } from '@pinecone-database/pinecone';
import OpenAI from 'openai';
import { createClient } from '@supabase/supabase-js';
import { SearchResult, SearchFilters, ToolResponse } from '@/types/tools';
import { wrapTool, createToolContext } from '@/lib/tools/base-wrapper';

// Initialize clients
const pinecone = new Pinecone({
  apiKey: process.env.PINECONE_API_KEY!
});

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY!
});

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

interface SearchTitlesParams {
  query: string;
  filters?: SearchFilters;
  top_k?: number;
  min_score?: number;
}

interface SearchTitlesResponse {
  query: string;
  results: SearchResult[];
  total_results: number;
}

/**
 * Search video titles using semantic similarity
 */
async function searchTitlesHandler(
  params: SearchTitlesParams,
  context?: any
): Promise<ToolResponse<SearchTitlesResponse>> {
  const {
    query,
    filters = {},
    top_k = 30,
    min_score = 0.3  // Lower threshold for better recall
  } = params;

  // Validate inputs
  if (!query || query.trim().length === 0) {
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
    // Generate embedding for the query
    const embeddingResponse = await openai.embeddings.create({
      model: 'text-embedding-3-small',
      input: query,
      dimensions: 512  // Using 512D for efficiency
    });

    const queryEmbedding = embeddingResponse.data[0].embedding;

    // Connect to Pinecone index
    const index = pinecone.index(process.env.PINECONE_INDEX_NAME!);

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

    // Only exclude shorts if explicitly requested
    if (filters.excludeShorts === true) {
      pineconeFilter.is_short = false;
    }

    // Query Pinecone
    const queryOptions: any = {
      vector: queryEmbedding,
      topK: safeTopK * 2,  // Get extra results for post-filtering
      includeMetadata: true
    };

    if (Object.keys(pineconeFilter).length > 0) {
      queryOptions.filter = pineconeFilter;
      console.log('[search-titles] Applying filters:', JSON.stringify(pineconeFilter));
    } else {
      console.log('[search-titles] No filters applied');
    }

    const pineconeResponse = await index.query(queryOptions);

    // Debug logging
    console.log('[search-titles] Query:', query);
    console.log('[search-titles] Pinecone returned:', pineconeResponse.matches?.length || 0, 'matches');
    if (pineconeResponse.matches && pineconeResponse.matches.length > 0) {
      console.log('[search-titles] Top score:', pineconeResponse.matches[0].score);
    }

    // Filter by minimum score and limit
    const filteredResults = (pineconeResponse.matches || [])
      .filter(match => (match.score || 0) >= min_score)
      .slice(0, safeTopK)
      .map(match => ({
        video_id: match.id,
        similarity_score: match.score || 0,
        metadata: match.metadata || {}
      }));

    // If requested, fetch additional metadata from Supabase
    let enrichedResults = filteredResults;
    
    if (filteredResults.length > 0 && context?.enrichMetadata) {
      const videoIds = filteredResults.map(r => r.video_id);
      
      const { data: videos } = await supabase
        .from('videos')
        .select('id, title, channel_name, view_count, published_at')
        .in('id', videoIds);

      if (videos) {
        const videoMap = new Map(videos.map(v => [v.id, v]));
        enrichedResults = filteredResults.map(result => ({
          ...result,
          metadata: {
            ...result.metadata,
            ...(videoMap.get(result.video_id) || {})
          }
        }));
      }
    }

    const response: SearchTitlesResponse = {
      query,
      results: enrichedResults,
      total_results: enrichedResults.length
    };

    return {
      success: true,
      data: response
    };

  } catch (error: any) {
    console.error('Error searching titles:', error);
    
    // Determine error type
    let errorCode = 'SEARCH_ERROR';
    let retryable = false;
    
    if (error.message?.includes('rate limit')) {
      errorCode = 'RATE_LIMIT';
      retryable = true;
    } else if (error.message?.includes('embedding')) {
      errorCode = 'EMBEDDING_ERROR';
      retryable = true;
    } else if (error.message?.includes('Pinecone')) {
      errorCode = 'PINECONE_ERROR';
      retryable = true;
    }

    return {
      success: false,
      error: {
        code: errorCode,
        message: 'Failed to search titles',
        details: error.message,
        retryable
      }
    };
  }
}

// Wrap handler with caching and retry logic
const wrappedHandler = wrapTool({
  name: 'search_titles',
  description: 'Semantic search on video titles using OpenAI embeddings',
  parameters: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description: 'Search query text'
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
        default: 30,
        minimum: 1,
        maximum: 100
      },
      min_score: {
        type: 'number',
        description: 'Minimum similarity score (0-1)',
        default: 0.5,
        minimum: 0,
        maximum: 1
      }
    },
    required: ['query']
  },
  handler: searchTitlesHandler,
  parallelSafe: true,
  cacheTTL: 300, // Cache for 5 minutes
  timeout: 10000, // 10 seconds for embedding + search
  retryConfig: {
    maxRetries: 3,
    backoffMs: 1000
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
export { searchTitlesHandler };