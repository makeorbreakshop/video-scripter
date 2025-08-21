import { NextResponse } from 'next/server';
import { createEmbeddings } from '@/lib/server/openai-embeddings';
import { searchVideoContent, searchVideoById } from '@/lib/vector-db-service';
import { getOpenAIApiKey, isPgvectorEnabled, getVectorSimilarityThreshold, getVectorMaxResults } from '@/lib/env-config';

/**
 * API route for vector similarity search across videos
 * 
 * POST /api/vector/search
 * 
 * Request Body:
 * {
 *   query: string,          // Search query to embed and search
 *   userId: string,         // User ID for data access 
 *   limit?: number,         // Optional: Max results to return
 *   threshold?: number,     // Optional: Similarity threshold (0-1)
 *   videoId?: string        // Optional: Filter results to specific video
 * }
 * 
 * Response:
 * {
 *   results: Array<{
 *     id: string,
 *     videoId: string,
 *     content: string,
 *     contentType: string,
 *     startTime?: number,
 *     endTime?: number,
 *     similarity: number,
 *     metadata?: object
 *   }>,
 *   query: string,
 *   totalResults: number
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
    const { query, userId, limit, threshold, videoId } = await request.json();
    
    // Validate required parameters
    if (!query) {
      return NextResponse.json(
        { error: 'Search query is required' },
        { status: 400 }
      );
    }
    
    if (!userId) {
      return NextResponse.json(
        { error: 'User ID is required' },
        { status: 400 }
      );
    }
    
    console.log(`🔍 API: Searching for: "${query.substring(0, 50)}...${videoId ? ` in video ${videoId}` : ''}`);
    
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
    const searchLimit = limit || getVectorMaxResults();
    const searchThreshold = threshold || getVectorSimilarityThreshold();
    
    // Perform the vector search
    let results;
    if (videoId) {
      // Search within a specific video
      results = await searchVideoById(videoId, embeddings[0], {
        limit: searchLimit,
        threshold: searchThreshold,
        userId
      });
    } else {
      // Search across all videos
      results = await searchVideoContent(query, embeddings[0], {
        limit: searchLimit,
        threshold: searchThreshold,
        userId
      });
    }
    
    console.log(`✅ API: Found ${results.length} results for query${videoId ? ` in video ${videoId}` : ''}`);
    
    return NextResponse.json({
      results,
      query,
      totalResults: results.length,
      videoId: videoId || null
    });
  } catch (error) {
    console.error('🚨 API: Error in vector search endpoint:', error);
    
    return NextResponse.json(
      { 
        error: error instanceof Error ? error.message : 'Unknown error occurred'
      },
      { status: 500 }
    );
  }
} 