/**
 * API endpoint for semantic search
 * POST /api/semantic-search
 */

import { NextRequest, NextResponse } from 'next/server';
import { generateQueryEmbedding } from '@/lib/title-embeddings';
import { pineconeService } from '@/lib/pinecone-service';

interface SearchRequest {
  query: string;
  limit?: number;
  min_score?: number;
  offset?: number;
}

interface SearchResponse {
  results: SearchResult[];
  query: string;
  total_results: number;
  has_more: boolean;
  total_available: number;
  current_page: number;
  processing_time_ms: number;
}

interface SearchResult {
  video_id: string;
  title: string;
  channel_id: string;
  channel_name?: string;
  view_count: number;
  published_at: string;
  performance_ratio: number;
  similarity_score: number;
}

export async function POST(request: NextRequest) {
  const startTime = Date.now();
  
  try {
    const body: SearchRequest = await request.json();
    const { query, limit = 20, min_score = 0.1, offset = 0 } = body;

    if (!query || query.trim().length === 0) {
      return NextResponse.json(
        { error: 'Query parameter is required and cannot be empty' },
        { status: 400 }
      );
    }

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        { error: 'OpenAI API key not configured' },
        { status: 500 }
      );
    }

    console.log(`🔍 Semantic search query: "${query}" (limit: ${limit}, offset: ${offset})`);
    
    // Generate embedding for the search query
    const queryEmbedding = await generateQueryEmbedding(query, apiKey);
    
    // Search for similar videos in Pinecone with pagination
    const searchResult = await pineconeService.searchSimilar(
      queryEmbedding,
      limit,
      min_score,
      offset
    );

    const processingTime = Date.now() - startTime;
    const currentPage = Math.floor(offset / limit) + 1;
    
    const response: SearchResponse = {
      results: searchResult.results,
      query,
      total_results: searchResult.results.length,
      has_more: searchResult.hasMore,
      total_available: searchResult.totalAvailable,
      current_page: currentPage,
      processing_time_ms: processingTime,
    };

    console.log(`✅ Search completed: ${searchResult.results.length} results in ${processingTime}ms (page ${currentPage}, hasMore: ${searchResult.hasMore})`);

    return NextResponse.json(response);
  } catch (error) {
    console.error('❌ Semantic search failed:', error);
    
    const processingTime = Date.now() - startTime;
    
    return NextResponse.json(
      { 
        error: 'Failed to perform semantic search',
        details: error instanceof Error ? error.message : 'Unknown error',
        processing_time_ms: processingTime
      },
      { status: 500 }
    );
  }
}

export async function GET(request: NextRequest) {
  try {
    // Get search statistics and health check
    const stats = await pineconeService.getIndexStats();
    
    return NextResponse.json({
      status: 'ready',
      pinecone_stats: {
        total_vectors: stats.totalVectorCount,
        dimension: stats.dimension,
        index_fullness: stats.indexFullness,
      },
      search_config: {
        default_limit: 20,
        default_min_score: 0.1,
        embedding_model: 'text-embedding-3-small',
        embedding_dimensions: 512,
      },
    });
  } catch (error) {
    console.error('❌ Failed to get search status:', error);
    
    return NextResponse.json(
      { 
        error: 'Failed to get search status',
        details: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  }
}