/**
 * API endpoint for search_summaries tool
 * Conceptual search on video summaries using OpenAI embeddings and Pinecone
 */

import { NextRequest, NextResponse } from 'next/server';
import { Pinecone } from '@pinecone-database/pinecone';
import OpenAI from 'openai';
import { getSupabase } from '@/lib/supabase-lazy';
import { SearchResult, SearchFilters, ToolResponse } from '@/types/tools';
import { wrapTool, createToolContext } from '@/lib/tools/base-wrapper';

// Initialize clients
const pinecone = new Pinecone({
  apiKey: process.env.PINECONE_API_KEY!
});

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY!
});


interface SearchSummariesParams {
  query: string;
  filters?: SearchFilters;
  top_k?: number;
  min_score?: number;
}

interface SearchSummariesResponse {
  query: string;
  results: SearchResult[];
  total_results: number;
}

/**
 * Search video summaries using semantic similarity
 * Uses the llm-summaries namespace in Pinecone for deeper conceptual search
 */
async function searchSummariesHandler(
  params: SearchSummariesParams,
  context?: any
): Promise<ToolResponse<SearchSummariesResponse>> {
  const {
    query,
    filters = {},
    top_k = 30,
    min_score = 0.4  // Lower threshold for summaries (more abstract)
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
    // Using same model for consistency
    const embeddingResponse = await openai.embeddings.create({
      model: 'text-embedding-3-small',
      input: query,
      dimensions: 512
    });

    const queryEmbedding = embeddingResponse.data[0].embedding;

    // Connect to Pinecone index - using summaries namespace
    const index = pinecone.index(process.env.PINECONE_SUMMARY_INDEX_NAME || process.env.PINECONE_INDEX_NAME!);
    const namespace = index.namespace('llm-summaries');

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

    // Query Pinecone summaries namespace
    const queryOptions: any = {
      vector: queryEmbedding,
      topK: safeTopK * 2,  // Get extra results for post-filtering
      includeMetadata: true
    };

    if (Object.keys(pineconeFilter).length > 0) {
      queryOptions.filter = pineconeFilter;
    }

    const pineconeResponse = await namespace.query(queryOptions);

    // Filter by minimum score and limit
    const filteredResults = (pineconeResponse.matches || [])
      .filter(match => (match.score || 0) >= min_score)
      .slice(0, safeTopK)
      .map(match => ({
        video_id: match.id,
        similarity_score: match.score || 0,
        metadata: match.metadata || {}
      }));

    // Enrich with additional data if requested
    let enrichedResults = filteredResults;
    
    if (filteredResults.length > 0 && context?.enrichMetadata) {
      const videoIds = filteredResults.map(r => r.video_id);
      
      // Get video details and summaries
      const { data: videos } = await supabase
        .from('videos')
        .select(`
          id, 
          title, 
          channel_name, 
          view_count, 
          published_at,
          temporal_performance_score,
          format_type,
          topic_niche
        `)
        .in('id', videoIds);

      // Get actual summaries from analyses table
      const { data: analyses } = await supabase
        .from('analyses')
        .select('video_id, summary')
        .in('video_id', videoIds);

      if (videos || analyses) {
        const videoMap = new Map(videos?.map(v => [v.id, v]) || []);
        const summaryMap = new Map(analyses?.map(a => [a.video_id, a.summary]) || []);
        
        enrichedResults = filteredResults.map(result => ({
          ...result,
          metadata: {
            ...result.metadata,
            ...(videoMap.get(result.video_id) || {}),
            summary: summaryMap.get(result.video_id) || result.metadata.summary
          }
        }));
      }
    }

    const response: SearchSummariesResponse = {
      query,
      results: enrichedResults,
      total_results: enrichedResults.length
    };

    return {
      success: true,
      data: response
    };

  } catch (error: any) {
    console.error('Error searching summaries:', error);
    
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
        message: 'Failed to search summaries',
        details: error.message,
        retryable
      }
    };
  }
}

// Wrap handler with caching and retry logic
const wrappedHandler = wrapTool({
  name: 'search_summaries',
  description: 'Conceptual search on video summaries for deeper semantic matching',
  parameters: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description: 'Search query - can be more conceptual/abstract than title search'
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
        default: 0.4,  // Lower than titles since summaries are more abstract
        minimum: 0,
        maximum: 1
      }
    },
    required: ['query']
  },
  handler: searchSummariesHandler,
  parallelSafe: true,
  cacheTTL: 300, // Cache for 5 minutes
  timeout: 10000, // 10 seconds for embedding + search
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
export { searchSummariesHandler };