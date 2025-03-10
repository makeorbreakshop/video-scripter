import { NextResponse } from 'next/server';
import { getUserVideos } from '@/lib/vector-db-service';
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
 *     analysisPhases: number
 *   }>
 * }
 */
export async function GET(request: Request) {
  try {
    // For now we're using a default user ID
    // In a production app, you'd get this from an auth session
    const userId = "00000000-0000-0000-0000-000000000000";
    
    // Get videos from the database
    const videos = await getUserVideos(userId);
    
    if (videos.length === 0) {
      return NextResponse.json({ videos: [] });
    }
    
    // Get chunk counts for all videos in a more efficient way
    // First get all chunks for these videos
    const { data: chunks, error: chunksError } = await supabase
      .from('chunks')
      .select('video_id')
      .eq('user_id', userId)
      .in('video_id', videos.map(v => v.id));
    
    if (chunksError) {
      console.error('Error retrieving chunks:', chunksError);
    }
    
    // Count chunks per video
    const chunkCountMap: Record<string, number> = {};
    (chunks || []).forEach(chunk => {
      chunkCountMap[chunk.video_id] = (chunkCountMap[chunk.video_id] || 0) + 1;
    });
    
    // Get analysis data for all videos
    const { data: analyses, error: analysesError } = await supabase
      .from('analyses')
      .select('video_id, phase')
      .eq('user_id', userId)
      .in('video_id', videos.map(v => v.id));
      
    if (analysesError) {
      console.error('Error retrieving analyses:', analysesError);
    }
    
    // Count analysis phases per video
    const analysisMap: Record<string, number[]> = {};
    (analyses || []).forEach(analysis => {
      if (!analysisMap[analysis.video_id]) {
        analysisMap[analysis.video_id] = [];
      }
      if (!analysisMap[analysis.video_id].includes(analysis.phase)) {
        analysisMap[analysis.video_id].push(analysis.phase);
      }
    });
    
    // Transform the data for the frontend
    const formattedVideos = videos.map((video) => {
      const videoAnalyses = analysisMap[video.id] || [];
      
      return {
        id: video.id,
        title: video.title,
        channelTitle: video.channelId,
        viewCount: video.viewCount,
        totalChunks: chunkCountMap[video.id] || 0,
        processed: true,
        processingDate: video.updated_at || video.publishedAt,
        analyzed: videoAnalyses.length > 0,
        analysisPhases: videoAnalyses.length
      };
    });
    
    return NextResponse.json({
      videos: formattedVideos
    });
  } catch (error) {
    console.error('🚨 API: Error fetching videos:', error);
    
    return NextResponse.json(
      { 
        error: error instanceof Error ? error.message : 'Unknown error occurred'
      },
      { status: 500 }
    );
  }
} 