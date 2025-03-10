import { NextResponse } from 'next/server';
import { processYoutubeVideo } from '@/lib/video-processor';
import { extractYouTubeId } from '@/lib/utils';
import { isPgvectorEnabled } from '@/lib/env-config';
import { getVideoMetadata } from '@/lib/vector-db-service';

/**
 * API route for processing a YouTube video and storing its content with vector embeddings
 * 
 * POST /api/vector/process-video
 * 
 * Request Body:
 * {
 *   videoUrl: string,       // YouTube video URL
 *   userId: string,         // User ID for storage
 *   maxChunkSize?: number,  // Optional: Maximum chunk size in tokens
 *   commentLimit?: number   // Optional: Number of comments to process
 * }
 * 
 * Response:
 * {
 *   success: boolean,
 *   videoId: string,
 *   totalChunks: number,
 *   error?: string
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
    const { videoUrl, userId, maxChunkSize, commentLimit, chunkingMethod } = await request.json();
    
    // Validate required parameters
    if (!videoUrl) {
      return NextResponse.json(
        { error: 'No video URL provided' },
        { status: 400 }
      );
    }
    
    if (!userId) {
      return NextResponse.json(
        { error: 'User ID is required' },
        { status: 400 }
      );
    }
    
    // Validate YouTube URL
    const videoId = extractYouTubeId(videoUrl);
    if (!videoId) {
      return NextResponse.json(
        { error: 'Invalid YouTube URL' },
        { status: 400 }
      );
    }
    
    // Check if the video already exists in the database
    const existingVideo = await getVideoMetadata(videoId, userId);
    if (existingVideo) {
      console.log(`🔄 Video ${videoId} already exists in database, skipping processing`);
      
      // Get the total chunks for this video
      const { data: chunksData } = await fetch(`/api/vector/chunks?videoId=${videoId}`)
        .then(res => res.json())
        .catch(() => ({ data: [] }));
        
      const totalChunks = chunksData?.length || 0;
      
      // Return success with existing video data
      return NextResponse.json({
        success: true,
        videoId,
        totalChunks,
        alreadyExists: true,
        title: existingVideo.title
      });
    }
    
    console.log(`🎬 API: Processing video ${videoId} for user ${userId}`);
    
    // Process the video
    const result = await processYoutubeVideo(videoUrl, {
      userId,
      maxChunkSize: maxChunkSize || 512,
      commentLimit: commentLimit || 50,
      chunkingMethod: chunkingMethod || 'enhanced'
    });
    
    if (!result.success) {
      console.error(`🚨 API: Failed to process video ${videoId}: ${result.error}`);
      
      return NextResponse.json(
        { 
          success: false,
          videoId,
          totalChunks: result.totalChunks,
          error: result.error || 'Failed to process video'
        },
        { status: 500 }
      );
    }
    
    console.log(`✅ API: Successfully processed video ${videoId} with ${result.totalChunks} chunks`);
    
    return NextResponse.json(result);
  } catch (error) {
    console.error('🚨 API: Error in process-video endpoint:', error);
    
    return NextResponse.json(
      { 
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error occurred'
      },
      { status: 500 }
    );
  }
} 