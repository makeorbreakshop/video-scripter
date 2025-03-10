import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { createEmbeddings } from '@/lib/server/openai-embeddings';
import { getOpenAIApiKey, isPgvectorEnabled } from '@/lib/env-config';

/**
 * API route for retrieving patterns from Skyscraper Analyses
 * 
 * POST /api/skyscraper/patterns
 * 
 * Request Body:
 * {
 *   userId: string,       // User ID for data access
 *   videoId?: string,     // Optional: Specific video to get patterns for
 *   patternType?: string, // Optional: Specific pattern type to retrieve
 *   query?: string        // Optional: Search query for semantic search
 * }
 * 
 * Response:
 * {
 *   success: boolean,
 *   patterns: Array<{
 *     id: string,
 *     videoId: string,
 *     patternType: string,
 *     patternData: object,
 *     videoTitle?: string  // Joined from videos table
 *   }>,
 *   totalResults: number
 * }
 */
export async function POST(request: Request) {
  try {
    // Parse request body
    const { userId, videoId, patternType, query } = await request.json();
    
    // Validate required parameters
    if (!userId) {
      return NextResponse.json(
        { error: 'User ID is required' },
        { status: 400 }
      );
    }
    
    console.log(`🔍 API: Retrieving patterns for user ${userId}`);
    
    // If a search query is provided, use vector search
    if (query && query.trim()) {
      if (!isPgvectorEnabled()) {
        return NextResponse.json(
          { error: 'Vector database functionality is disabled' },
          { status: 400 }
        );
      }
      
      // Generate embedding for the search query
      const openaiApiKey = getOpenAIApiKey();
      if (!openaiApiKey) {
        return NextResponse.json(
          { error: 'OpenAI API key not configured for vector search' },
          { status: 500 }
        );
      }
      
      const embeddings = await createEmbeddings([query], openaiApiKey);
      if (!embeddings || embeddings.length === 0) {
        return NextResponse.json(
          { error: 'Failed to generate query embedding' },
          { status: 500 }
        );
      }
      
      // Search across analyses using the search_analyses function
      const { data: analysesResults, error: analysesError } = await supabase.rpc('search_analyses', {
        query_embedding: embeddings[0],
        match_threshold: 0.7,
        match_count: 10,
        p_user_id: userId
      });
      
      if (analysesError) {
        console.error('🚨 API: Error searching analyses:', analysesError);
        return NextResponse.json(
          { error: 'Failed to search analyses' },
          { status: 500 }
        );
      }
      
      // Get video IDs from the search results
      const videoIds = [...new Set(analysesResults.map((r: { video_id: string }) => r.video_id))];
      
      if (videoIds.length === 0) {
        return NextResponse.json({
          success: true,
          patterns: [],
          totalResults: 0
        });
      }
      
      // Get patterns for these videos
      let patternsQuery = supabase.from('patterns')
        .select('*, videos!inner(title)')
        .eq('user_id', userId)
        .in('video_id', videoIds);
        
      if (videoId) {
        patternsQuery = patternsQuery.eq('video_id', videoId);
      }
      
      if (patternType) {
        patternsQuery = patternsQuery.eq('pattern_type', patternType);
      }
      
      const { data: patterns, error: patternsError } = await patternsQuery;
      
      if (patternsError) {
        console.error('🚨 API: Error fetching patterns:', patternsError);
        return NextResponse.json(
          { error: 'Failed to fetch patterns' },
          { status: 500 }
        );
      }
      
      // Format patterns for response
      const formattedPatterns = patterns.map(p => ({
        id: p.id,
        videoId: p.video_id,
        patternType: p.pattern_type,
        patternData: p.pattern_data,
        videoTitle: p.videos.title
      }));
      
      return NextResponse.json({
        success: true,
        patterns: formattedPatterns,
        totalResults: formattedPatterns.length
      });
    }
    
    // Direct query if no search term
    let patternsQuery = supabase.from('patterns')
      .select('*, videos!inner(title)')
      .eq('user_id', userId);
      
    if (videoId) {
      patternsQuery = patternsQuery.eq('video_id', videoId);
    }
    
    if (patternType) {
      patternsQuery = patternsQuery.eq('pattern_type', patternType);
    }
    
    const { data: patterns, error: patternsError } = await patternsQuery;
    
    if (patternsError) {
      console.error('🚨 API: Error fetching patterns:', patternsError);
      return NextResponse.json(
        { error: 'Failed to fetch patterns' },
        { status: 500 }
      );
    }
    
    // Format patterns for response
    const formattedPatterns = patterns.map(p => ({
      id: p.id,
      videoId: p.video_id,
      patternType: p.pattern_type,
      patternData: p.pattern_data,
      videoTitle: p.videos.title
    }));
    
    return NextResponse.json({
      success: true,
      patterns: formattedPatterns,
      totalResults: formattedPatterns.length
    });
    
  } catch (error) {
    console.error('🚨 API: Error in patterns endpoint:', error);
    
    return NextResponse.json(
      { 
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error occurred'
      },
      { status: 500 }
    );
  }
} 