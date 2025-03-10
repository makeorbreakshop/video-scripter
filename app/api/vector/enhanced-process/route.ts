import { NextResponse } from 'next/server';
import { processYoutubeVideoEnhanced } from '@/lib/enhanced-video-processor';
import { extractYouTubeId } from '@/lib/utils';
import { isPgvectorEnabled } from '@/lib/env-config';

/**
 * API route for processing a YouTube video with enhanced chunking
 * 
 * POST /api/vector/enhanced-process
 * 
 * Request Body:
 * {
 *   videoUrl: string,          // YouTube video URL
 *   userId: string,            // User ID for storage
 *   maxChunkDuration?: number, // Optional: Maximum chunk duration in seconds
 *   overlapDuration?: number,  // Optional: Overlap duration in seconds
 *   commentLimit?: number,     // Optional: Number of comments to process
 *   respectTransitions?: boolean, // Optional: Detect transition phrases
 *   detectPauses?: boolean     // Optional: Detect pauses in speech
 * }
 * 
 * Response:
 * {
 *   success: boolean,
 *   videoId: string,
 *   totalChunks: number,
 *   transcriptChunks: number,
 *   commentClusters: number,
 *   descriptionChunks: number,
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
    const { 
      videoUrl, 
      userId, 
      maxChunkDuration = 120,
      overlapDuration = 20,
      minChunkDuration = 30,
      commentLimit = 100,
      commentSimilarityThreshold = 0.3,
      maxCommentClusters = 10,
      minCommentsPerCluster = 3,
      detectPauses = true,
      respectTransitions = true
    } = await request.json();
    
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
    
    console.log(`🎬 API: Enhanced processing for video ${videoId} for user ${userId}`);
    
    // Process the video with enhanced chunking
    const result = await processYoutubeVideoEnhanced(videoUrl, {
      userId,
      maxChunkDuration,
      overlapDuration,
      minChunkDuration,
      commentLimit,
      commentSimilarityThreshold,
      maxCommentClusters,
      minCommentsPerCluster,
      detectPauses,
      respectTransitions
    });
    
    if (!result.success) {
      console.error(`🚨 API: Failed to process video ${videoId} with enhanced chunking: ${result.error}`);
      
      return NextResponse.json(
        { 
          success: false,
          videoId,
          totalChunks: result.totalChunks,
          transcriptChunks: result.transcriptChunks || 0,
          commentClusters: result.commentClusters || 0,
          descriptionChunks: result.descriptionChunks || 0,
          error: result.error || 'Failed to process video'
        },
        { status: 500 }
      );
    }
    
    console.log(`✅ API: Successfully processed video ${videoId} with enhanced chunking`);
    console.log(`   - Total chunks: ${result.totalChunks}`);
    console.log(`   - Transcript chunks: ${result.transcriptChunks}`);
    console.log(`   - Comment clusters: ${result.commentClusters}`);
    console.log(`   - Description chunks: ${result.descriptionChunks}`);
    
    return NextResponse.json(result);
  } catch (error) {
    console.error('🚨 API: Error in enhanced-process endpoint:', error);
    
    return NextResponse.json(
      { 
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error occurred'
      },
      { status: 500 }
    );
  }
} 