import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

/**
 * API route for retrieving processed videos from the vector database
 * 
 * GET /api/vector/videos
 * 
 * Response:
 * {
 *   videos: Array<{
 *     id: string,
 *     title: string,
 *     channelTitle: string,
 *     viewCount: number,
 *     totalChunks: number,
 *     processed: boolean,
 *     processingDate: string,
 *     analyzed: boolean,
 *     analysisPhases: number,
 *     transcriptLength: number,
 *     wordCount: number,
 *     commentCount: number
 *   }>
 * }
 */
export async function GET(request: Request) {
  try {
    // Get user ID from query params, use default if not provided
    const { searchParams } = new URL(request.url);
    const userId = searchParams.get('userId') || '00000000-0000-0000-0000-000000000000';

    console.log('🔍 Retrieving videos for user', userId);

    // First get all videos for this user
    const { data: videos, error: videosError } = await supabase
      .from('videos')
      .select('*')
      .eq('user_id', userId);

    if (videosError) {
      console.error('Error fetching videos:', videosError);
      return NextResponse.json(
        { error: 'Failed to fetch videos' },
        { status: 500 }
      );
    }

    // Log the first video to see the actual field structure
    if (videos && videos.length > 0) {
      console.log('Sample video object structure:', JSON.stringify(videos[0], null, 2));
    }

    // For each video, get the chunks to calculate comment count and transcript length
    const videosWithCounts = await Promise.all(videos.map(async (video) => {
      // Get all chunks for this video
      const { data: chunks, error: chunksError } = await supabase
        .from('chunks')
        .select('content, content_type, metadata')
        .eq('video_id', video.id);

      if (chunksError) {
        console.error('Error fetching chunks for video', video.id, chunksError);
        return video;
      }

      // Get transcript chunks and calculate total length
      const transcriptChunks = chunks?.filter(chunk => chunk.content_type === 'transcript') || [];
      const transcriptLength = transcriptChunks.reduce((acc, chunk) => acc + chunk.content.length, 0);
      
      // Calculate word count from transcript chunks
      const wordCount = transcriptChunks.reduce((acc, chunk) => {
        return acc + (chunk.content.split(/\s+/).length || 0);
      }, 0);

      // Get comment count from the comments table instead of chunks
      const { count: commentCount, error: commentCountError } = await supabase
        .from('comments')
        .select('*', { count: 'exact', head: true })
        .eq('video_id', video.id);

      if (commentCountError) {
        console.error('Error fetching comment count for video', video.id, commentCountError);
      }

      // Check if this video has a skyscraper analysis
      const { data: skyscraperAnalysis, error: skyscraperError } = await supabase
        .from('skyscraper_analyses')
        .select('id')
        .eq('video_id', video.id)
        .limit(1);
        
      if (skyscraperError) {
        console.error('Error checking skyscraper analysis for video', video.id, skyscraperError);
      }
      
      const hasSkyscraperAnalysis = skyscraperAnalysis && skyscraperAnalysis.length > 0;

      // Format for the client interface
      return {
        id: video.id,
        title: video.title || 'Untitled',
        channelTitle: video.channel_id || 'Unknown Channel',
        viewCount: video.view_count || 0,
        totalChunks: chunks?.length || 0,
        processed: true,
        processingDate: video.created_at || video.updated_at,
        analyzed: !!video.analyzed,
        analysisPhases: video.analysis_phases || 0,
        transcriptLength,
        wordCount,
        commentCount: commentCount || 0,
        hasSkyscraperAnalysis: hasSkyscraperAnalysis
      };
    }));

    console.log(`✅ Found ${videos.length} videos for user ${userId}`);

    return NextResponse.json({
      videos: videosWithCounts
    });

  } catch (error) {
    console.error('Error in videos endpoint:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
} 