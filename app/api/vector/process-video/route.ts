import { NextResponse } from 'next/server';
import { processYoutubeVideo } from '@/lib/video-processor';
import { extractYouTubeId } from '@/lib/utils';
import { isPgvectorEnabled } from '@/lib/env-config';
import { supabase } from '@/lib/supabase';

// Add these types at the top of the file
interface VideoChunk {
  content: string;
  contentType: 'transcript' | 'comment' | 'comment_cluster' | 'description';
  metadata?: {
    commentCount?: number;
  };
}

interface ProcessingResult {
  success: boolean;
  videoId: string;
  totalChunks: number;
  error?: string;
  chunks?: VideoChunk[];
  wordCount?: number;
  commentCount?: number;
  reprocessed?: boolean;
}

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
 *   commentLimit?: number,  // Optional: Number of comments to process
 *   reprocess?: boolean     // Optional: Whether to reprocess an existing video
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
    const { videoUrl, userId, maxChunkSize, commentLimit, chunkingMethod, reprocess } = await request.json();
    
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

    // If reprocessing, delete existing chunks first
    if (reprocess) {
      console.log(`🔄 Reprocessing video ${videoId} - deleting existing chunks...`);
      
      // Delete from chunks table
      const { error: chunksError } = await supabase
        .from('chunks')
        .delete()
        .eq('video_id', videoId);

      if (chunksError) {
        console.error('Error deleting existing chunks:', chunksError);
        return NextResponse.json(
          { error: 'Failed to delete existing chunks' },
          { status: 500 }
        );
      }
    } else {
      // Check if the video already exists in the database
      const { data: existingVideo, error: videoError } = await supabase
        .from('videos')
        .select('*')
        .eq('id', videoId)
        .single();

      if (videoError && videoError.code !== 'PGRST116') { // PGRST116 is "not found"
        console.error('Error checking existing video:', videoError);
        return NextResponse.json(
          { error: 'Failed to check existing video' },
          { status: 500 }
        );
      }

      if (existingVideo && !reprocess) {
        console.log(`🔄 Video ${videoId} already exists in database, skipping processing`);
        
        // Get the total chunks for this video
        const { data: chunks, error: chunksError } = await supabase
          .from('chunks')
          .select('*')
          .eq('video_id', videoId);

        if (chunksError) {
          console.error('Error fetching chunks:', chunksError);
          return NextResponse.json(
            { error: 'Failed to fetch chunks' },
            { status: 500 }
          );
        }
        
        // Get additional metadata for the response
        const { data: videoMetadata, error: metadataError } = await supabase
          .from('videos')
          .select('title, channel_id, view_count, comment_count')
          .eq('id', videoId)
          .single();
          
        if (metadataError) {
          console.warn('Warning: Could not fetch video metadata:', metadataError);
        }
        
        return NextResponse.json({
          success: true,
          videoId,
          totalChunks: chunks?.length || 0,
          alreadyExists: true,
          title: existingVideo.title,
          videoTitle: videoMetadata?.title || existingVideo.title,
          channelTitle: videoMetadata?.channel_id || null,
          viewCount: videoMetadata?.view_count || null,
          commentCount: videoMetadata?.comment_count || null
        });
      }
    }
    
    console.log(`🎬 API: ${reprocess ? 'Reprocessing' : 'Processing'} video ${videoId} for user ${userId}`);
    
    // Process the video
    const result = await processYoutubeVideo(videoUrl, {
      userId,
      maxChunkSize: maxChunkSize || 512,
      commentLimit: commentLimit || 500,
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
    
    console.log(`✅ API: Successfully ${reprocess ? 'reprocessed' : 'processed'} video ${videoId} with ${result.totalChunks} chunks`);
    
    // Get video metadata from the database to include in the response
    const { data: videoMetadata, error: metadataError } = await supabase
      .from('videos')
      .select('title, channel_id, view_count')
      .eq('id', videoId)
      .single();
      
    if (metadataError) {
      console.warn('Warning: Could not fetch video metadata:', metadataError);
    }
    
    return NextResponse.json({
      ...result,
      reprocessed: reprocess,
      videoTitle: videoMetadata?.title || null,
      channelTitle: videoMetadata?.channel_id || null,
      viewCount: videoMetadata?.view_count || null,
      wordCount: result.wordCount || result.chunks?.reduce((count: number, chunk: any) => 
        count + (chunk.content?.split(/\s+/).length || 0), 0) || 0,
      commentCount: result.chunks?.filter((chunk: any) => 
        chunk.contentType === 'comment' || 
        (chunk.contentType === 'comment_cluster' && chunk.metadata?.commentCount)
      ).reduce((count: number, chunk: any) => 
        count + (chunk.contentType === 'comment_cluster' ? 
          (chunk.metadata?.commentCount || 0) : 1), 0) || 0,
      chunks: reprocess ? result.chunks : undefined
    });
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