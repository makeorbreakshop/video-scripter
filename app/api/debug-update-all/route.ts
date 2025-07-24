import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { Database } from '@/types/database';

export async function GET(request: NextRequest) {
  try {
    const supabase = createClient<Database>(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD format
    
    // Get distinct count of videos with snapshots from today
    const { data: recentVideoIds } = await supabase
      .from('view_snapshots')
      .select('video_id')
      .eq('snapshot_date', today)
      .limit(100000);
    
    // Get unique video IDs
    const uniqueRecentIds = new Set(recentVideoIds?.map(r => r.video_id) || []);
    
    // Get total count of videos
    const { count: totalVideos } = await supabase
      .from('videos')
      .select('*', { count: 'exact', head: true });
    
    const videosNeedingUpdate = (totalVideos || 0) - uniqueRecentIds.size;

    return NextResponse.json({
      debug: {
        today,
        totalVideos,
        recentVideoIdsLength: recentVideoIds?.length || 0,
        uniqueRecentIdsSize: uniqueRecentIds.size,
        videosNeedingUpdate,
        firstFewRecentIds: recentVideoIds?.slice(0, 5) || []
      }
    });
  } catch (error) {
    console.error('Debug API error:', error);
    return NextResponse.json({ 
      error: 'Internal server error' 
    }, { status: 500 });
  }
}