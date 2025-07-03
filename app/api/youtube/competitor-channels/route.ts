import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

// Use service role to bypass RLS
const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  {
    auth: {
      autoRefreshToken: false,
      persistSession: false
    }
  }
);

export async function GET() {
  try {
    // Get video data with counts per channel
    const { data: videos, error: videosError } = await supabaseAdmin
      .from('videos')
      .select(`
        channel_id,
        imported_by,
        import_date,
        metadata
      `)
      .eq('is_competitor', true)
      .limit(5000);

    if (videosError) throw videosError;

    // Get channel tracking data for proper timestamps
    const { data: channelStatus, error: statusError } = await supabaseAdmin
      .from('channel_import_status')
      .select(`
        channel_name,
        first_import_date,
        last_refresh_date,
        total_videos_found
      `);

    if (statusError) {
      console.warn('Could not load channel status:', statusError);
    }

    // Group videos by channel and count them
    const channelMap = new Map();
    const channelCounts = new Map();
    
    videos?.forEach(video => {
      const channelId = video.channel_id;
      
      // Count videos per channel
      channelCounts.set(channelId, (channelCounts.get(channelId) || 0) + 1);
      
      // Keep latest video data per channel
      if (!channelMap.has(channelId) || new Date(video.import_date) > new Date(channelMap.get(channelId).import_date)) {
        channelMap.set(channelId, video);
      }
    });

    // Create channel status map for easy lookup
    const statusMap = new Map();
    channelStatus?.forEach(status => {
      statusMap.set(status.channel_name, status);
    });

    // Format response with proper data
    const channels = Array.from(channelMap.values()).map(video => {
      const channelStats = video.metadata?.channel_stats || {};
      const statusData = statusMap.get(video.channel_id);
      const videoCount = channelCounts.get(video.channel_id) || 0;
      
      // Use tracking data if available, fallback to video import_date
      const lastImportDate = statusData?.last_refresh_date || statusData?.first_import_date || video.import_date;
      
      return {
        id: video.metadata?.youtube_channel_id || video.channel_id,
        name: video.channel_id,
        handle: `@${video.channel_id.replace(/\s+/g, '').toLowerCase()}`,
        subscriberCount: channelStats.subscriber_count || 0,
        videoCount: videoCount,
        lastImport: lastImportDate,
        status: 'active',
        thumbnailUrl: channelStats.channel_thumbnail
      };
    });

    return NextResponse.json({ channels });
  } catch (error) {
    console.error('Error loading competitor channels:', error);
    return NextResponse.json(
      { error: 'Failed to load competitor channels' },
      { status: 500 }
    );
  }
}