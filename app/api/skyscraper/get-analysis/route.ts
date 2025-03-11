import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';

/**
 * API route to get a Skyscraper analysis for a specific video
 * GET /api/skyscraper/get-analysis?videoId=xyz
 */
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const videoId = searchParams.get('videoId');
    
    if (!videoId) {
      return NextResponse.json(
        { error: 'Video ID is required' },
        { status: 400 }
      );
    }

    // Get video details first
    const { data: videoData, error: videoError } = await supabaseAdmin
      .from('videos')
      .select('title, channel_id')
      .eq('id', videoId)
      .single();

    if (videoError) {
      console.error('Error fetching video details:', videoError);
      return NextResponse.json(
        { error: 'Failed to fetch video details' },
        { status: 500 }
      );
    }

    // Get the most recent analysis for this video
    const { data: analysisData, error: analysisError } = await supabaseAdmin
      .from('skyscraper_analyses')
      .select('*')
      .eq('video_id', videoId)
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    if (analysisError) {
      console.error('Error fetching analysis:', analysisError);
      return NextResponse.json(
        { error: 'Failed to fetch analysis' },
        { status: 500 }
      );
    }

    if (!analysisData) {
      return NextResponse.json(
        { error: 'No analysis found for this video' },
        { status: 404 }
      );
    }

    return NextResponse.json({
      video: {
        id: videoId,
        title: videoData.title,
        channelTitle: videoData.channel_id
      },
      analysis: analysisData
    });
  } catch (error) {
    console.error('Error in get-analysis endpoint:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
} 