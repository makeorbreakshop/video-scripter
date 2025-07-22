import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export async function GET(
  request: NextRequest,
  { params }: { params: { videoId: string } }
) {
  try {
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    const { videoId } = params;

    // Fetch video details with all related data
    const { data: video, error } = await supabase
      .from('videos')
      .select(`
        *,
        view_tracking_priority (
          priority_tier,
          last_tracked,
          next_track_date
        )
      `)
      .eq('id', videoId)
      .single();

    if (error || !video) {
      return NextResponse.json(
        { error: 'Video not found' },
        { status: 404 }
      );
    }

    // Parse metadata if it's a string
    if (video.metadata && typeof video.metadata === 'string') {
      try {
        video.metadata = JSON.parse(video.metadata);
      } catch (e) {
        console.error('Error parsing metadata:', e);
      }
    }

    return NextResponse.json(video);
  } catch (error) {
    console.error('Error fetching video:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}