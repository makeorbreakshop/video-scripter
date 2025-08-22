import { NextRequest, NextResponse } from 'next/server';
import { getSupabase } from '@/lib/supabase-lazy';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ videoId: string }> }
) {
  try {

    const { videoId } = await params;

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
      .select('view_count, import_date, created_at, published_at')
      .eq('id', videoId)
      .single();

    // Combine snapshots, ensuring we don't duplicate the initial import
    const allSnapshots = [];
    
    // Add snapshots, filtering out any that might be duplicates
    if (snapshots && snapshots.length > 0) {
      allSnapshots.push(...snapshots);
    } else if (video) {
      // If no snapshots exist but we have video data, create a single point
      const publishedDate = new Date(video.published_at || video.created_at || video.import_date);
      const daysSincePublished = Math.floor(
        (Date.now() - publishedDate.getTime()) / (1000 * 60 * 60 * 24)
      );
      
      allSnapshots.push({
        video_id: videoId,
        snapshot_date: new Date().toISOString(),
        view_count: video.view_count || 0,
        days_since_published: daysSincePublished,
        daily_views_rate: video.view_count ? video.view_count / Math.max(daysSincePublished, 1) : 0
      });
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