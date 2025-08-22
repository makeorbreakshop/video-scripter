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

// Format subscriber count as ballpark figure (same as main endpoint)
function getBallparkSubs(count: number): number {
  if (!count) return 0;
  
  if (count < 1000) return Math.round(count / 100) * 100;
  if (count < 10000) return Math.round(count / 1000) * 1000;
  if (count < 50000) return Math.round(count / 5000) * 5000;
  if (count < 100000) return Math.round(count / 10000) * 10000;
  if (count < 500000) return Math.round(count / 50000) * 50000;
  if (count < 1000000) return Math.round(count / 100000) * 100000;
  return Math.round(count / 1000000) * 1000000;
}

export async function GET() {
  const startTime = Date.now();
  console.log('API: Starting preview generation');
  
  try {
    const supabase = getSupabaseClient();
    
    // Step 1: Get a random channel with 100K+ subscribers that has enough videos
    const { data: randomChannel, error: channelError } = await supabase
      .from('channels')
      .select('channel_id, channel_name, subscriber_count, thumbnail_url')
      .gte('subscriber_count', 100000)
      .order('channel_id', { ascending: false }) // Use deterministic order, then RANDOM()
      .limit(1000); // Get a pool to pick from

    if (channelError || !randomChannel || randomChannel.length === 0) {
      console.error('No eligible channels found:', channelError);
      return NextResponse.json({ error: 'No eligible channels found' }, { status: 500 });
    }

    // Pick a random channel from the pool
    const selectedChannel = randomChannel[Math.floor(Math.random() * randomChannel.length)];
    console.log(`Selected channel: ${selectedChannel.channel_name} (${selectedChannel.subscriber_count} subs)`);

    // Step 2: Get high performer from this channel
    const { data: highPerformer, error: highError } = await supabase
      .from('videos')
      .select('id, title, temporal_performance_score, thumbnail_url, view_count')
      .eq('channel_id', selectedChannel.channel_id)
      .not('temporal_performance_score', 'is', null)
      .gt('temporal_performance_score', 1.0) // At least decent performance
      .not('thumbnail_url', 'is', null)
      .lte('published_at', new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString())
      .eq('is_short', false)
      .eq('is_institutional', false)
      .order('temporal_performance_score', { ascending: false })
      .limit(1)
      .single();

    if (highError || !highPerformer) {
      console.error('No high performer found for channel:', highError);
      return NextResponse.json({ error: 'No suitable videos found' }, { status: 500 });
    }

    // Step 3: Get low performer from same channel
    const { data: lowPerformer, error: lowError } = await supabase
      .from('videos')
      .select('id, title, temporal_performance_score, thumbnail_url, view_count')
      .eq('channel_id', selectedChannel.channel_id)
      .not('temporal_performance_score', 'is', null)
      .lt('temporal_performance_score', 1.0) // Below average performance
      .not('thumbnail_url', 'is', null)
      .lte('published_at', new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString())
      .eq('is_short', false)
      .eq('is_institutional', false)
      .neq('id', highPerformer.id) // Different from high performer
      .order('temporal_performance_score', { ascending: true })
      .limit(1)
      .single();

    if (lowError || !lowPerformer) {
      console.error('No low performer found for channel:', lowError);
      return NextResponse.json({ error: 'No suitable video pair found' }, { status: 500 });
    }

    // Fix avatar URL size - only s88 and smaller work due to CORS restrictions
    let avatarUrl = selectedChannel.thumbnail_url || null;
    if (avatarUrl) {
      avatarUrl = avatarUrl.replace(/s\d+-c/, 's88-c');
    }
    
    const channelInfo = {
      channel_title: selectedChannel.channel_name,
      channel_avatar: avatarUrl,
      channel_subscriber_count: getBallparkSubs(selectedChannel.subscriber_count)
    };

    // Format videos with channel info
    const formatVideo = (video: any) => ({
      id: video.id,
      title: video.title,
      thumbnail_url: video.thumbnail_url,
      view_count: video.view_count,
      ...channelInfo
    });

    // Randomly assign A/B positions for variety
    const randomOrder = Math.random() > 0.5;
    const videoA = randomOrder ? highPerformer : lowPerformer;
    const videoB = randomOrder ? lowPerformer : highPerformer;

    const elapsed = Date.now() - startTime;
    console.log(`Preview generated in ${elapsed}ms - High: ${highPerformer.temporal_performance_score}, Low: ${lowPerformer.temporal_performance_score}`);

    return NextResponse.json({
      preview: true,
      channel: channelInfo,
      videoA: formatVideo(videoA),
      videoB: formatVideo(videoB)
    });

  } catch (error) {
    console.error('Error getting preview:', error);
    return NextResponse.json(
      { error: 'Failed to get preview' },
      { status: 500 }
    );
  }
}