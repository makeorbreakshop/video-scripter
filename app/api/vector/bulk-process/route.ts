import { NextResponse } from 'next/server';
import { processYoutubeVideo } from '@/lib/video-processor';
import { getSupabase } from '@/lib/supabase';
import { isPgvectorEnabled } from '@/lib/env-config';

interface ProcessResult {
  videoId: string;
  status: 'success' | 'error' | 'already_exists';
  message: string;
  title?: string;
  channelTitle?: string;
  commentCount?: number;
  wordCount?: number;
  totalChunks?: number;
}

interface ProcessError {
  videoId: string;
  error: string;
}

// Real implementation for video processing
async function processVideo(videoUrl: string, userId: string, chunkingMethod: string) {
  const videoId = videoUrl.split('v=')[1];
  
  // Check if the video already exists in the database
  const { data: existingVideo, error: videoError } = await supabase
    .from('videos')
    .select('*')
    .eq('id', videoId)
    .single();

  if (videoError && videoError.code !== 'PGRST116') { // PGRST116 is "not found"
    console.error('Error checking existing video:', videoError);
    throw new Error('Failed to check existing video');
  }

  if (existingVideo) {
    console.log(`🔄 Video ${videoId} already exists in database, skipping processing`);
    
    // Get the total chunks for this video
    const { data: chunks, error: chunksError } = await supabase
      .from('chunks')
      .select('*')
      .eq('video_id', videoId);

    if (chunksError) {
      console.error('Error fetching chunks:', chunksError);
      throw new Error('Failed to fetch chunks');
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
    
    return {
      success: true,
      videoId,
      totalChunks: chunks?.length || 0,
      alreadyExists: true,
      title: existingVideo.title,
      videoTitle: videoMetadata?.title || existingVideo.title,
      channelTitle: videoMetadata?.channel_id || null,
      viewCount: videoMetadata?.view_count || null,
      commentCount: videoMetadata?.comment_count || null
    };
  }
  
  // Process the video using the real implementation
  console.log(`🎬 Processing video ${videoId} for user ${userId}`);
  const result = await processYoutubeVideo(videoUrl, {
    userId,
    maxChunkSize: 512,
    commentLimit: 500,
    chunkingMethod: chunkingMethod as 'standard' | 'enhanced'
  });
  
  if (!result.success) {
    throw new Error(result.error || 'Failed to process video');
  }
  
  // Get video metadata from the database to include in the response
  const { data: videoMetadata, error: metadataError } = await supabase
    .from('videos')
    .select('title, channel_id, view_count')
    .eq('id', videoId)
    .single();
    
  if (metadataError) {
    console.warn('Warning: Could not fetch video metadata:', metadataError);
  }
  
  return {
    success: true,
    videoId,
    totalChunks: result.totalChunks,
    title: videoMetadata?.title || null,
    channelTitle: videoMetadata?.channel_id || null,
    viewCount: videoMetadata?.view_count || null,
    commentCount: result.commentCount || 0,
    wordCount: result.wordCount || 0,
    alreadyExists: false
  };
}

export async function POST(request: Request) {
  const supabase = getSupabase();
  try {
    // Check if pgvector is enabled
    if (!isPgvectorEnabled()) {
      return NextResponse.json(
        { error: 'Vector database functionality is disabled' },
        { status: 400 }
      );
    }
    
    const { videoIds, userId = "00000000-0000-0000-0000-000000000000", chunkingMethod = "enhanced" } = await request.json();
    
    if (!videoIds || !Array.isArray(videoIds) || videoIds.length === 0) {
      return NextResponse.json(
        { error: 'Video IDs array is required' },
        { status: 400 }
      );
    }
    
    console.log(`🔄 Bulk processing ${videoIds.length} videos for user: ${userId}`);
    
    // Process each video in parallel with limited concurrency
    const results: ProcessResult[] = [];
    const errors: ProcessError[] = [];
    const batchSize = 3;
    
    // Process in batches
    for (let i = 0; i < videoIds.length; i += batchSize) {
      const batch = videoIds.slice(i, i + batchSize);
      
      console.log(`🔄 Processing batch ${i/batchSize + 1} of ${Math.ceil(videoIds.length/batchSize)}: ${batch.join(', ')}`);
      
      // Process each video in the batch concurrently
      const batchResults = await Promise.all(
        batch.map(async (videoId) => {
          try {
            // Generate YouTube URL from ID
            const videoUrl = `https://www.youtube.com/watch?v=${videoId}`;
            
            // Process the video using the real implementation
            const result = await processVideo(videoUrl, userId, chunkingMethod);
            
            if (result.alreadyExists) {
              return {
                videoId,
                status: 'already_exists' as const,
                message: 'Video already exists in database',
                title: result.title,
                channelTitle: result.channelTitle,
                commentCount: result.commentCount || 0,
                totalChunks: result.totalChunks || 0
              };
            }
            
            return {
              videoId,
              status: 'success' as const,
              message: 'Successfully processed video',
              title: result.title,
              channelTitle: result.channelTitle,
              commentCount: result.commentCount || 0,
              wordCount: result.wordCount || 0,
              totalChunks: result.totalChunks || 0
            };
          } catch (error: unknown) {
            console.error(`Error processing video ${videoId}:`, error);
            
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            
            errors.push({
              videoId,
              error: errorMessage
            });
            
            return {
              videoId,
              status: 'error' as const,
              message: errorMessage
            };
          }
        })
      );
      
      results.push(...batchResults);
      
      // Add a small delay between batches to avoid rate limiting
      if (i + batchSize < videoIds.length) {
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
    }
    
    // Return summary of results
    return NextResponse.json({
      totalVideos: videoIds.length,
      successCount: results.filter(r => r.status === 'success').length,
      alreadyExistsCount: results.filter(r => r.status === 'already_exists').length,
      errorCount: results.filter(r => r.status === 'error').length,
      results,
      errors: errors.length > 0 ? errors : undefined
    });
  } catch (error: unknown) {
    console.error('Error in bulk processing:', error);
    const errorMessage = error instanceof Error ? error.message : 'Failed to bulk process videos';
    return NextResponse.json(
      { error: errorMessage },
      { status: 500 }
    );
  }
} 