import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// Format subscriber count as ballpark figure
function getBallparkSubs(count: number): number {
  if (!count) return 0;
  
  if (count < 1000) return Math.round(count / 100) * 100;
  if (count < 10000) return Math.round(count / 1000) * 1000;
  if (count < 100000) return Math.round(count / 10000) * 10000;
  if (count < 1000000) return Math.round(count / 100000) * 100000;
  return Math.round(count / 1000000) * 1000000;
}

export async function GET() {
  try {
    const startTime = Date.now();
    
    // Get the date 30 days ago
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

    // Step 1: Get a random seed video with good/bad performance
    // Randomly decide if we want a high or low performer as seed
    const wantHighPerformer = Math.random() > 0.5;
    
    const { data: seedVideos, error: seedError } = await supabase
      .from('videos')
      .select('*')
      .not('temporal_performance_score', 'is', null)
      .not('thumbnail_url', 'is', null)
      .not('pinecone_embedding_version', 'is', null)
      .lte('published_at', thirtyDaysAgo)
      .lte('temporal_performance_score', 100)
      .eq('is_short', false)
      .eq('is_institutional', false)
      .gte('temporal_performance_score', wantHighPerformer ? 1.5 : 0.1)
      .lte('temporal_performance_score', wantHighPerformer ? 100 : 0.8)
      .limit(50); // Get a batch to randomly select from

    if (seedError || !seedVideos || seedVideos.length === 0) {
      console.error('Failed to get seed video:', seedError);
      return NextResponse.json({ error: 'Failed to get seed video' }, { status: 500 });
    }

    // Pick a random seed video
    const seedVideo = seedVideos[Math.floor(Math.random() * seedVideos.length)];
    console.log(`🎯 Seed video: "${seedVideo.title.substring(0, 50)}..." (${seedVideo.temporal_performance_score.toFixed(1)}x)`);

    // Step 2: Find similar videos based on topic and format
    return getTopicBasedMatchup(seedVideo, supabase, thirtyDaysAgo, wantHighPerformer);

  } catch (error) {
    console.error('Error getting similar matchup:', error);
    return NextResponse.json(
      { error: 'Failed to get similar matchup' },
      { status: 500 }
    );
  }
}

// Topic-based matching for similar content
async function getTopicBasedMatchup(seedVideo: any, supabase: any, thirtyDaysAgo: string, seedIsHighPerformer: boolean) {
  const startTime = Date.now();
  console.log(`🎯 Finding topic match for: ${seedVideo.topic_domain}/${seedVideo.topic_niche} - ${seedVideo.format_type}`);
  
  // We want opposite performer with similar topic/format
  const wantOppositePerformer = !seedIsHighPerformer;
  
  // Build query for similar videos
  let query = supabase
    .from('videos')
    .select('*')
    .not('temporal_performance_score', 'is', null)
    .not('thumbnail_url', 'is', null)
    .neq('id', seedVideo.id) // Don't match the same video
    .lte('published_at', thirtyDaysAgo)
    .lte('temporal_performance_score', 100)
    .eq('is_short', false)
    .eq('is_institutional', false)
    .gte('temporal_performance_score', wantOppositePerformer ? 1.5 : 0.1)
    .lte('temporal_performance_score', wantOppositePerformer ? 100 : 0.8);

  // Try to match on topic and format first
  if (seedVideo.topic_domain && seedVideo.topic_domain !== 'Outlier') {
    query = query.eq('topic_domain', seedVideo.topic_domain);
  }
  if (seedVideo.format_type) {
    query = query.eq('format_type', seedVideo.format_type);
  }

  const { data: similarVideos, error: similarError } = await query.limit(100);

  let oppositeVideo;
  
  if (similarVideos && similarVideos.length > 0) {
    // Found similar topic/format videos
    oppositeVideo = similarVideos[Math.floor(Math.random() * similarVideos.length)];
    console.log(`✅ Found ${similarVideos.length} videos with same topic/format`);
  } else {
    // Fallback to just opposite performance
    console.log(`⚠️ No exact topic/format match, using random opposite performer`);
    const { data: fallbackVideos } = await supabase
      .from('videos')
      .select('*')
      .not('temporal_performance_score', 'is', null)
      .not('thumbnail_url', 'is', null)
      .neq('id', seedVideo.id)
      .lte('published_at', thirtyDaysAgo)
      .lte('temporal_performance_score', 100)
      .eq('is_short', false)
      .eq('is_institutional', false)
      .gte('temporal_performance_score', wantOppositePerformer ? 1.5 : 0.1)
      .lte('temporal_performance_score', wantOppositePerformer ? 100 : 0.8)
      .limit(100);
    
    if (!fallbackVideos || fallbackVideos.length === 0) {
      return NextResponse.json({ error: 'No videos available' }, { status: 500 });
    }
    
    oppositeVideo = fallbackVideos[Math.floor(Math.random() * fallbackVideos.length)];
  }

  // Get channel data
  const channelIds = [seedVideo.channel_id, oppositeVideo.channel_id].filter(Boolean);
  const { data: channels } = await supabase
    .from('channels')
    .select('channel_id, subscriber_count')
    .in('channel_id', channelIds);

  const channelSubMap = new Map();
  if (channels) {
    channels.forEach(c => {
      channelSubMap.set(c.channel_id, c.subscriber_count);
    });
  }

  const formatVideo = (video: any) => ({
    id: video.id,
    title: video.title,
    thumbnail_url: video.thumbnail_url,
    channel_title: video.channel_name || 'Unknown Channel',
    channel_subscriber_count: getBallparkSubs(channelSubMap.get(video.channel_id) || 0),
    temporal_performance_score: video.temporal_performance_score,
    view_count: video.view_count,
    topic: video.topic_domain,
    format: video.format_type
  });

  const randomOrder = Math.random() > 0.5;
  
  const totalTime = Date.now() - startTime;
  console.log(`✅ Generated topic-based matchup in ${totalTime}ms`);
  
  return NextResponse.json({
    videoA: formatVideo(randomOrder ? seedVideo : oppositeVideo),
    videoB: formatVideo(randomOrder ? oppositeVideo : seedVideo),
    similarity_type: 'topic_based',
    processing_time_ms: totalTime
  });
}

// Fallback function when semantic search fails
async function fallbackToRandomMatchup(seedVideo: any, supabase: any, thirtyDaysAgo: string) {
  console.log('⚠️ Falling back to random matchup');
  
  const isHighPerformer = seedVideo.temporal_performance_score >= 1.5;
  
  // Get a random opposite performer
  const { data: oppositeVideos } = await supabase
    .from('videos')
    .select('*')
    .not('temporal_performance_score', 'is', null)
    .not('thumbnail_url', 'is', null)
    .lte('published_at', thirtyDaysAgo)
    .lte('temporal_performance_score', 100)
    .eq('is_short', false)
    .eq('is_institutional', false)
    .gte('temporal_performance_score', isHighPerformer ? 0.1 : 1.5)
    .lte('temporal_performance_score', isHighPerformer ? 0.8 : 100)
    .limit(50);

  if (!oppositeVideos || oppositeVideos.length === 0) {
    return NextResponse.json({ error: 'No videos available' }, { status: 500 });
  }

  const oppositeVideo = oppositeVideos[Math.floor(Math.random() * oppositeVideos.length)];

  // Get channel data
  const channelIds = [seedVideo.channel_id, oppositeVideo.channel_id].filter(Boolean);
  const { data: channels } = await supabase
    .from('channels')
    .select('channel_id, subscriber_count')
    .in('channel_id', channelIds);

  const channelSubMap = new Map();
  if (channels) {
    channels.forEach(c => {
      channelSubMap.set(c.channel_id, c.subscriber_count);
    });
  }

  const formatVideo = (video: any) => ({
    id: video.id,
    title: video.title,
    thumbnail_url: video.thumbnail_url,
    channel_title: video.channel_name || 'Unknown Channel',
    channel_subscriber_count: getBallparkSubs(channelSubMap.get(video.channel_id) || 0),
    temporal_performance_score: video.temporal_performance_score,
    view_count: video.view_count
  });

  const randomOrder = Math.random() > 0.5;
  
  return NextResponse.json({
    videoA: formatVideo(randomOrder ? seedVideo : oppositeVideo),
    videoB: formatVideo(randomOrder ? oppositeVideo : seedVideo),
    similarity_type: 'random_fallback'
  });
}