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

    // Fetch all view snapshots for this video
    const { data: snapshots, error } = await supabase
      .from('view_snapshots')
      .select('*')
      .eq('video_id', videoId)
      .order('snapshot_date', { ascending: true });

    if (error) {
      console.error('Error fetching snapshots:', error);
      return NextResponse.json(
        { error: 'Failed to fetch snapshots' },
        { status: 500 }
      );
    }

    // Get the initial view count from the video's import
    const { data: video } = await supabase
      .from('videos')
      .select('view_count, import_date, created_at')
      .eq('id', videoId)
      .single();

    // If we have a video with import data, add it as the first snapshot
    const allSnapshots = [];
    
    if (video && video.import_date && video.view_count) {
      // Add initial snapshot from import
      allSnapshots.push({
        video_id: videoId,
        snapshot_date: video.import_date,
        view_count: video.view_count,
        days_since_published: 0,
        daily_views_rate: 0
      });
    }

    // Add the rest of the snapshots
    if (snapshots) {
      allSnapshots.push(...snapshots);
    }

    return NextResponse.json({ 
      snapshots: allSnapshots,
      count: allSnapshots.length 
    });
  } catch (error) {
    console.error('Error in snapshots endpoint:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}