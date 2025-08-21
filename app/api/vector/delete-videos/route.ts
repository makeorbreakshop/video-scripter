import { NextResponse } from 'next/server';
import { getSupabase } from '@/lib/supabase';

export async function DELETE(request: Request) {
  const supabase = getSupabase();
  try {
    const { videoIds } = await request.json();

    if (!videoIds || !Array.isArray(videoIds) || videoIds.length === 0) {
      return NextResponse.json(
        { error: "Invalid or missing videoIds" },
        { status: 400 }
      );
    }

    console.log('Attempting to delete videos:', videoIds);

    // Delete from chunks table first (foreign key dependency)
    const { error: chunksError } = await supabase
      .from('chunks')
      .delete()
      .in('video_id', videoIds);

    if (chunksError) {
      console.error('Error deleting from chunks table:', chunksError);
      return NextResponse.json(
        { error: `Failed to delete from chunks table: ${chunksError.message}` },
        { status: 500 }
      );
    }

    // Then delete from videos table
    const { error: videosError } = await supabase
      .from('videos')
      .delete()
      .in('id', videoIds);

    if (videosError) {
      console.error('Error deleting from videos table:', videosError);
      return NextResponse.json(
        { error: `Failed to delete from videos table: ${videosError.message}` },
        { status: 500 }
      );
    }

    console.log('Successfully deleted videos:', videoIds);

    return NextResponse.json({
      message: `Successfully deleted ${videoIds.length} video(s)`,
      deletedIds: videoIds
    });
  } catch (error) {
    console.error('Unexpected error deleting videos:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to delete videos" },
      { status: 500 }
    );
  }
} 