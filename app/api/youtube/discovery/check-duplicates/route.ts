import { NextRequest, NextResponse } from 'next/server';
import { getSupabase } from '@/lib/supabase-lazy';


export async function POST(request: NextRequest) {
  const supabase = getSupabase();
  try {
    const { channelIds } = await request.json();

    if (!channelIds || !Array.isArray(channelIds) || channelIds.length === 0) {
      return NextResponse.json(
        { error: 'channelIds array is required' },
        { status: 400 }
      );
    }

    console.log(`🔍 Checking ${channelIds.length} channels for duplicates...`);

    // Check multiple sources for existing channels
    const duplicateInfo: Record<string, {
      isImported: boolean;
      inQueue: boolean;
      videoCount: number;
      lastImportDate: string | null;
      importStatus: string | null;
      jobStatus: string | null;
    }> = {};

    // 1. Check videos table for existing channel videos
    const { data: videoData, error: videoError } = await supabase
      .from('videos')
      .select('channel_id, import_date')
      .in('channel_id', channelIds);

    if (videoError) {
      console.error('Error checking videos table:', videoError);
    }

    // Group video data by channel
    const videosByChannel: Record<string, { count: number; lastImport: string | null }> = {};
    if (videoData) {
      videoData.forEach(video => {
        if (!videosByChannel[video.channel_id]) {
          videosByChannel[video.channel_id] = { count: 0, lastImport: null };
        }
        videosByChannel[video.channel_id].count++;
        if (!videosByChannel[video.channel_id].lastImport || 
            (video.import_date && video.import_date > videosByChannel[video.channel_id].lastImport!)) {
          videosByChannel[video.channel_id].lastImport = video.import_date;
        }
      });
    }

    // 2. Check channel_import_status table
    const { data: importStatusData, error: importStatusError } = await supabase
      .from('channel_import_status')
      .select('channel_id, is_fully_imported, last_refresh_date, total_videos_found')
      .in('channel_id', channelIds);

    if (importStatusError) {
      console.error('Error checking channel_import_status:', importStatusError);
    }

    const importStatusByChannel: Record<string, any> = {};
    if (importStatusData) {
      importStatusData.forEach(status => {
        if (status.channel_id) {
          importStatusByChannel[status.channel_id] = status;
        }
      });
    }

    // 3. Check for pending/processing jobs in video_processing_jobs
    const { data: jobData, error: jobError } = await supabase
      .from('video_processing_jobs')
      .select('id, status, metadata, created_at')
      .or('status.eq.pending,status.eq.processing')
      .order('created_at', { ascending: false });

    if (jobError) {
      console.error('Error checking jobs:', jobError);
    }

    // Check if any jobs contain our channels
    const channelsInQueue: Record<string, string> = {};
    if (jobData) {
      jobData.forEach(job => {
        const metadata = job.metadata as any;
        if (metadata?.channelIds) {
          metadata.channelIds.forEach((channelId: string) => {
            if (channelIds.includes(channelId)) {
              channelsInQueue[channelId] = job.status;
            }
          });
        }
      });
    }

    // 4. Compile duplicate info for each channel
    channelIds.forEach(channelId => {
      const videoInfo = videosByChannel[channelId];
      const importStatus = importStatusByChannel[channelId];
      const jobStatus = channelsInQueue[channelId];

      duplicateInfo[channelId] = {
        isImported: !!videoInfo || !!importStatus,
        inQueue: !!jobStatus,
        videoCount: videoInfo?.count || 0,
        lastImportDate: videoInfo?.lastImport || importStatus?.last_refresh_date || null,
        importStatus: importStatus?.is_fully_imported ? 'fully_imported' : (videoInfo ? 'partial' : null),
        jobStatus: jobStatus || null
      };
    });

    // Count statistics
    const stats = {
      totalChecked: channelIds.length,
      alreadyImported: Object.values(duplicateInfo).filter(d => d.isImported).length,
      inQueue: Object.values(duplicateInfo).filter(d => d.inQueue).length,
      newChannels: Object.values(duplicateInfo).filter(d => !d.isImported && !d.inQueue).length
    };

    console.log(`✅ Duplicate check complete:`);
    console.log(`   - ${stats.alreadyImported} already imported`);
    console.log(`   - ${stats.inQueue} in queue`);
    console.log(`   - ${stats.newChannels} new channels`);

    return NextResponse.json({
      success: true,
      duplicates: duplicateInfo,
      stats,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('Duplicate check error:', error);
    return NextResponse.json(
      { error: 'Failed to check for duplicates' },
      { status: 500 }
    );
  }
}