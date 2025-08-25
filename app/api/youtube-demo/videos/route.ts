import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const limit = parseInt(searchParams.get('limit') || '20');
    const offset = parseInt(searchParams.get('offset') || '0');
    const sortBy = searchParams.get('sortBy') || 'view_count'; // view_count, published_at, title
    const order = searchParams.get('order') || 'desc'; // asc, desc
    
    const supabase = supabaseAdmin;
    
    // Fetch videos with all required data
    const { data: videos, error } = await supabase
      .from('videos')
      .select(`
        id,
        title,
        channel_name,
        thumbnail_url,
        view_count,
        published_at,
        duration,
        like_count,
        comment_count
      `)
      .not('thumbnail_url', 'is', null)
      .not('title', 'is', null)
      .not('channel_name', 'is', null)
      .not('view_count', 'is', null)
      .not('duration', 'is', null)
      .order(sortBy, { ascending: order === 'asc' })
      .range(offset, offset + limit - 1);

    if (error) {
      console.error('Error fetching videos:', error);
      return NextResponse.json(
        { error: 'Failed to fetch videos' },
        { status: 500 }
      );
    }

    // Transform the data to ensure proper types
    const transformedVideos = videos.map(video => ({
      id: video.id,
      title: video.title,
      channel_name: video.channel_name,
      thumbnail_url: video.thumbnail_url,
      view_count: video.view_count,
      published_at: video.published_at,
      duration: video.duration || 'PT0M0S',
      like_count: video.like_count,
      comment_count: video.comment_count
    }));

    return NextResponse.json({
      videos: transformedVideos,
      total: videos.length,
      offset,
      limit
    });

  } catch (error) {
    console.error('API error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}