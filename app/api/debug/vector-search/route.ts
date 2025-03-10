import { NextResponse } from 'next/server';
import { createEmbeddings } from '@/lib/server/openai-embeddings';
import { supabase } from '@/lib/supabase';
import { getOpenAIApiKey, isPgvectorEnabled, getVectorSimilarityThreshold, getVectorMaxResults } from '@/lib/env-config';

/**
 * Debug API endpoint for testing vector search directly
 * 
 * POST /api/debug/vector-search
 * 
 * Request Body:
 * {
 *   query: string,
 *   userId?: string // Optional user ID for filtering results
 * }
 */
export async function POST(request: Request) {
  try {
    // Check if pgvector is enabled
    if (!isPgvectorEnabled()) {
      return NextResponse.json(
        { error: 'Vector database functionality is disabled' },
        { status: 400 }
      );
    }
    
    // Parse request body
    const { query, userId } = await request.json();
    
    // Validate required parameters
    if (!query) {
      return NextResponse.json(
        { error: 'Query is required' },
        { status: 400 }
      );
    }
    
    console.log(`🔍 DEBUG API: Testing vector search for: "${query.substring(0, 50)}..."`);
    
    // Get the API key
    const openaiApiKey = getOpenAIApiKey();
    if (!openaiApiKey) {
      return NextResponse.json(
        { error: 'OpenAI API key not configured' },
        { status: 500 }
      );
    }
    
    // Generate embedding for the search query
    const embeddings = await createEmbeddings([query], openaiApiKey);
    if (!embeddings || embeddings.length === 0) {
      return NextResponse.json(
        { error: 'Failed to generate query embedding' },
        { status: 500 }
      );
    }
    
    // Set search parameters
    const threshold = getVectorSimilarityThreshold();
    const limit = getVectorMaxResults();
    
    // Get the user ID from the request or use default
    const userIdForSearch = userId || '00000000-0000-0000-0000-000000000000';
    
    // Search using regular function (with auth)
    const { data: normalResults, error: normalError } = await supabase.rpc('search_video_chunks', {
      query_embedding: embeddings[0],
      match_threshold: threshold,
      match_count: limit,
      p_user_id: userIdForSearch
    });
    
    // Attempt direct database query (bypass auth check)
    // Look at all chunks regardless of user_id
    let directResults = [];
    let directError = null;
    
    try {
      const { data, error } = await supabase.from('chunks')
        .select('*')
        .limit(20);
        
      if (error) throw error;
      directResults = data || [];
    } catch (err) {
      directError = err instanceof Error ? err.message : String(err);
    }
    
    // Count total chunks in database
    const { count: totalChunks, error: countError } = await supabase
      .from('chunks')
      .select('*', { count: 'exact', head: true });
      
    // Check if the search_video_chunks_no_auth function exists
    let noAuthResults = [];
    let noAuthError = null;
    
    try {
      // Try using the no-auth function if it exists
      const { data, error } = await supabase.rpc('search_video_chunks_no_auth', {
        query_embedding: embeddings[0],
        match_threshold: threshold,
        match_count: limit
      });
      
      if (error) throw error;
      noAuthResults = data || [];
    } catch (err) {
      // This will fail if the function doesn't exist, which is expected
      noAuthError = err instanceof Error ? err.message : String(err);
    }
    
    return NextResponse.json({
      query,
      userId: userIdForSearch,
      totalChunksInDb: totalChunks || 0,
      countError: countError ? countError.message : null,
      
      // Regular search (with auth)
      normalResults: normalResults || [],
      normalResultsCount: normalResults ? normalResults.length : 0,
      normalError: normalError ? normalError.message : null,
      
      // Direct query (all chunks)
      directResults: directResults.slice(0, 5), // Just show first 5 to avoid huge response
      directResultsCount: directResults.length,
      directError: directError,
      
      // No-auth function (if it exists)
      noAuthResults: noAuthResults,
      noAuthResultsCount: noAuthResults.length,
      noAuthError: noAuthError,
    });
  } catch (error) {
    console.error('🚨 API: Error in debug vector search endpoint:', error);
    
    return NextResponse.json(
      { 
        error: error instanceof Error ? error.message : 'Unknown error occurred'
      },
      { status: 500 }
    );
  }
} 