import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function POST(req: NextRequest) {
  try {
    const { videoIds } = await req.json();
    
    if (!videoIds || !Array.isArray(videoIds)) {
      return NextResponse.json({ error: 'videoIds array is required' }, { status: 400 });
    }

    const { data: videos, error } = await supabase
      .from('videos')
      .select('id, title, channel_name, view_count, published_at, thumbnail_url')
      .in('id', videoIds);

    if (error) {
      console.error('Error fetching videos:', error);
      return NextResponse.json({ error: 'Failed to fetch videos' }, { status: 500 });
    }

    // Create a map to preserve the order of videoIds
    const videoMap = new Map(videos?.map(v => [v.id, v]) || []);
    const orderedVideos = videoIds
      .map(id => videoMap.get(id))
      .filter(Boolean);

    return NextResponse.json({ videos: orderedVideos });
  } catch (error) {
    console.error('Error in videos by IDs endpoint:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}