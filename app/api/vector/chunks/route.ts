import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { isPgvectorEnabled } from '@/lib/env-config';

/**
 * API route for fetching chunks for a specific video
 * 
 * GET /api/vector/chunks?videoId=xyz
 * 
 * Query Parameters:
 * - videoId: string (required) - The YouTube video ID to fetch chunks for
 * 
 * Response:
 * {
 *   success: boolean,
 *   data: array of chunks,
 *   error?: string
 * }
 */
export async function GET(request: Request) {
  try {
    // Check if pgvector is enabled
    if (!isPgvectorEnabled()) {
      return NextResponse.json(
        { success: false, error: 'Vector database functionality is disabled' },
        { status: 400 }
      );
    }
    
    // Parse query parameters
    const url = new URL(request.url);
    const videoId = url.searchParams.get('videoId');
    
    // Validate required parameters
    if (!videoId) {
      return NextResponse.json(
        { success: false, error: 'No video ID provided' },
        { status: 400 }
      );
    }
    
    // Query the database for chunks
    const { data, error, count } = await supabase
      .from('chunks')
      .select('*', { count: 'exact' })
      .eq('video_id', videoId);
    
    if (error) {
      console.error(`🚨 API: Error fetching chunks for video ${videoId}:`, error);
      
      return NextResponse.json(
        { success: false, error: 'Failed to fetch chunks' },
        { status: 500 }
      );
    }
    
    return NextResponse.json({
      success: true,
      data: data || [],
      count: count || 0
    });
  } catch (error) {
    console.error('🚨 API: Error in chunks endpoint:', error);
    
    return NextResponse.json(
      { 
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error occurred'
      },
      { status: 500 }
    );
  }
} 