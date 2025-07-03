/**
 * API endpoint for semantic search
 * GET /api/search/semantic
 */

import { NextRequest, NextResponse } from 'next/server';
import { pineconeService } from '@/lib/pinecone-service';
import { generateQueryEmbedding } from '@/lib/title-embeddings';
import { supabasePineconeSync } from '@/lib/supabase-pinecone-sync';

interface SemanticSearchResponse {
  results: SearchResult[];
  total_results: number;
  query_time_ms: number;
  query: string;
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
  thumbnail_url: string;
}

export async function GET(request: NextRequest) {
  const startTime = Date.now();
  
  try {
    const { searchParams } = new URL(request.url);
    const query = searchParams.get('query');
    const limit = parseInt(searchParams.get('limit') || '20');
    const minScore = parseFloat(searchParams.get('min_score') || '0.5');

    if (!query || query.trim().length === 0) {
      return NextResponse.json(
        { error: 'Query parameter is required' },
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

    console.log(`🔍 Semantic search query: "${query}" (limit: ${limit}, minScore: ${minScore})`);

    // Generate query embedding
    const queryEmbedding = await generateQueryEmbedding(query, apiKey);
    
    // Search similar vectors in Pinecone
    const similarVideos = await pineconeService.searchSimilar(
      queryEmbedding,
      limit,
      minScore
    );

    console.log(`🎯 Found ${similarVideos.length} similar videos`);

    // Enrich results with additional metadata from Supabase if needed
    const enrichedResults: SearchResult[] = similarVideos.map(video => ({
      video_id: video.video_id,
      title: video.title,
      channel_id: video.channel_id,
      channel_name: video.channel_name,
      view_count: video.view_count,
      published_at: video.published_at,
      performance_ratio: video.performance_ratio,
      similarity_score: Math.round(video.similarity_score * 100) / 100, // Round to 2 decimal places
      thumbnail_url: `https://i.ytimg.com/vi/${video.video_id}/hqdefault.jpg`,
    }));

    const queryTime = Date.now() - startTime;

    const response: SemanticSearchResponse = {
      results: enrichedResults,
      total_results: enrichedResults.length,
      query_time_ms: queryTime,
      query: query,
    };

    console.log(`✅ Semantic search completed in ${queryTime}ms`);

    return NextResponse.json(response);
  } catch (error) {
    const queryTime = Date.now() - startTime;
    console.error('❌ Semantic search failed:', error);
    
    return NextResponse.json(
      { 
        error: 'Failed to perform semantic search',
        details: error instanceof Error ? error.message : 'Unknown error',
        query_time_ms: queryTime,
      },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { query, limit = 20, min_score = 0.5, filters = {} } = body;

    if (!query || query.trim().length === 0) {
      return NextResponse.json(
        { error: 'Query is required' },
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

    console.log(`🔍 Advanced semantic search: "${query}"`);

    // Generate query embedding
    const queryEmbedding = await generateQueryEmbedding(query, apiKey);
    
    // Search similar vectors in Pinecone
    const similarVideos = await pineconeService.searchSimilar(
      queryEmbedding,
      limit,
      min_score
    );

    // Apply additional filters if provided
    let filteredResults = similarVideos;
    
    if (filters.channel_ids && filters.channel_ids.length > 0) {
      filteredResults = filteredResults.filter(video => 
        filters.channel_ids.includes(video.channel_id)
      );
    }

    if (filters.min_views) {
      filteredResults = filteredResults.filter(video => 
        video.view_count >= filters.min_views
      );
    }

    if (filters.min_performance_ratio) {
      filteredResults = filteredResults.filter(video => 
        video.performance_ratio >= filters.min_performance_ratio
      );
    }

    // Enrich results
    const enrichedResults: SearchResult[] = filteredResults.map(video => ({
      video_id: video.video_id,
      title: video.title,
      channel_id: video.channel_id,
      channel_name: video.channel_name,
      view_count: video.view_count,
      published_at: video.published_at,
      performance_ratio: video.performance_ratio,
      similarity_score: Math.round(video.similarity_score * 100) / 100,
      thumbnail_url: `https://i.ytimg.com/vi/${video.video_id}/hqdefault.jpg`,
    }));

    console.log(`✅ Advanced search completed: ${enrichedResults.length} results`);

    return NextResponse.json({
      results: enrichedResults,
      total_results: enrichedResults.length,
      query: query,
      filters_applied: filters,
    });
  } catch (error) {
    console.error('❌ Advanced semantic search failed:', error);
    
    return NextResponse.json(
      { 
        error: 'Failed to perform advanced semantic search',
        details: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  }
}