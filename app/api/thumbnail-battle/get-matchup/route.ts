import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

function getSupabaseClient() {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error('Missing Supabase environment variables');
  }
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  );
}

// Format subscriber count as ballpark figure
function getBallparkSubs(count: number): number {
  if (!count) return 0;
  
  // Round to nearest significant figure
  if (count < 1000) return Math.round(count / 100) * 100;
  if (count < 10000) return Math.round(count / 1000) * 1000;
  if (count < 100000) return Math.round(count / 10000) * 10000;
  if (count < 1000000) return Math.round(count / 100000) * 100000;
  return Math.round(count / 1000000) * 1000000;
}

export async function GET() {
  const startTime = Date.now();
  console.log('API: Starting matchup generation');
  
  try {
    const supabase = getSupabaseClient();
    // Get the date 30 days ago
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

    // Get channels that have enough videos for comparison
    const { data: eligibleChannels, error: channelError } = await supabase
      .from('videos')
      .select('channel_id')
      .not('temporal_performance_score', 'is', null)
      .gt('temporal_performance_score', 0.1)  // Filter out 0 or near-0 scores (likely bad data)
      .not('thumbnail_url', 'is', null)
      .lte('published_at', thirtyDaysAgo)
      .lte('temporal_performance_score', 100)
      .eq('is_short', false)
      .eq('is_institutional', false)
      .not('channel_id', 'is', null);

    if (channelError || !eligibleChannels || eligibleChannels.length === 0) {
      return NextResponse.json({ error: 'No eligible channels found' }, { status: 500 });
    }

    // Count videos per channel and find one with enough videos
    const channelCounts = new Map<string, number>();
    eligibleChannels.forEach(v => {
      const count = channelCounts.get(v.channel_id) || 0;
      channelCounts.set(v.channel_id, count + 1);
    });

    // Find channels with at least 10 videos
    const goodChannels = Array.from(channelCounts.entries())
      .filter(([_, count]) => count >= 10)
      .map(([channelId, _]) => channelId);

    if (goodChannels.length === 0) {
      return NextResponse.json({ error: 'No channels with enough videos' }, { status: 500 });
    }

    // Pick a random channel
    const selectedChannelId = goodChannels[Math.floor(Math.random() * goodChannels.length)];

    // Get videos from this channel
    const { data: videos, error: videosError } = await supabase
      .from('videos')
      .select('*')
      .eq('channel_id', selectedChannelId)
      .not('temporal_performance_score', 'is', null)
      .gt('temporal_performance_score', 0.1)  // Filter out 0 or near-0 scores (likely bad data)
      .not('thumbnail_url', 'is', null)
      .lte('published_at', thirtyDaysAgo)
      .lte('temporal_performance_score', 100)
      .eq('is_short', false)
      .eq('is_institutional', false)
      .limit(50);

    if (videosError || !videos || videos.length < 2) {
      return NextResponse.json({ error: 'Failed to get matchup' }, { status: 500 });
    }

    // Get channel data for the selected channel
    const { data: channelData, error: channelDataError } = await supabase
      .from('channels')
      .select('channel_id, channel_name, subscriber_count, thumbnail_url')
      .eq('channel_id', selectedChannelId)
      .single();

    // Enrich videos with channel data
    // Fix avatar URL size - s800 doesn't work, use s88 instead
    let avatarUrl = channelData?.thumbnail_url || null;
    if (avatarUrl && avatarUrl.includes('s800')) {
      avatarUrl = avatarUrl.replace('s800', 's88');
    }
    
    const channelInfo = {
      channel_title: channelData?.channel_name || 'Unknown Channel',
      channel_avatar: avatarUrl,
      channel_subscriber_count: getBallparkSubs(channelData?.subscriber_count || 0)
    };

    const enrichedVideos = videos.map(v => ({
      ...v,
      ...channelInfo
    }));

    // Separate high and low performers
    const highPerformers = enrichedVideos.filter(v => v.temporal_performance_score >= 1.5);
    const lowPerformers = enrichedVideos.filter(v => v.temporal_performance_score <= 0.8);

    let videoA, videoB;

    if (highPerformers.length > 0 && lowPerformers.length > 0) {
      // Ideal case: one high, one low
      const highVideo = highPerformers[Math.floor(Math.random() * highPerformers.length)];
      
      // Try to find a low performer within 1 year of the high performer
      const oneYearBefore = new Date(highVideo.published_at);
      oneYearBefore.setFullYear(oneYearBefore.getFullYear() - 1);
      const oneYearAfter = new Date(highVideo.published_at);
      oneYearAfter.setFullYear(oneYearAfter.getFullYear() + 1);
      
      const similarTimeLowPerformers = lowPerformers.filter(v => {
        const videoDate = new Date(v.published_at);
        return videoDate >= oneYearBefore && videoDate <= oneYearAfter;
      });
      
      if (similarTimeLowPerformers.length > 0) {
        const lowVideo = similarTimeLowPerformers[Math.floor(Math.random() * similarTimeLowPerformers.length)];
        videoA = highVideo;
        videoB = lowVideo;
      } else {
        // No videos within 1 year, just take any low performer
        const lowVideo = lowPerformers[Math.floor(Math.random() * lowPerformers.length)];
        videoA = highVideo;
        videoB = lowVideo;
      }
    } else {
      // Fallback: just take any two different videos within 1 year of each other if possible
      const shuffled = enrichedVideos.sort(() => Math.random() - 0.5);
      const firstVideo = shuffled[0];
      
      // Try to find a second video within 1 year
      const oneYearBefore = new Date(firstVideo.published_at);
      oneYearBefore.setFullYear(oneYearBefore.getFullYear() - 1);
      const oneYearAfter = new Date(firstVideo.published_at);
      oneYearAfter.setFullYear(oneYearAfter.getFullYear() + 1);
      
      const nearbyVideos = shuffled.slice(1).filter(v => {
        const videoDate = new Date(v.published_at);
        return videoDate >= oneYearBefore && videoDate <= oneYearAfter;
      });
      
      if (nearbyVideos.length > 0) {
        videoA = firstVideo;
        videoB = nearbyVideos[0];
      } else {
        // No videos within 1 year, just take first two
        [videoA, videoB] = shuffled.slice(0, 2);
      }
    }

    // Format the response
    const formatVideo = (video: any) => ({
      id: video.id,
      title: video.title,
      thumbnail_url: video.thumbnail_url,
      channel_title: video.channel_title || video.channel_name || 'Unknown Channel',
      channel_avatar: video.channel_avatar,
      channel_subscriber_count: video.channel_subscriber_count,
      temporal_performance_score: video.temporal_performance_score,
      view_count: video.view_count
    });

    // Randomly assign positions
    const randomOrder = Math.random() > 0.5;
    
    return NextResponse.json({
      channel: channelInfo, // Include channel info separately
      videoA: formatVideo(randomOrder ? videoA : videoB),
      videoB: formatVideo(randomOrder ? videoB : videoA)
    });

  } catch (error) {
    console.error('Error getting matchup:', error);
    return NextResponse.json(
      { error: 'Failed to get matchup' },
      { status: 500 }
    );
  }
}