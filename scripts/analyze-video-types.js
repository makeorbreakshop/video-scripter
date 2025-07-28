#!/usr/bin/env node

import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config();

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function analyzeVideoTypes() {
  console.log('🔍 Analyzing video types in database...\n');

  // Get videos with #shorts
  const { data: shorts } = await supabase
    .from('videos')
    .select('id, title, duration, view_count')
    .ilike('title', '%#shorts%')
    .limit(5);

  console.log('📱 Sample YouTube Shorts:');
  shorts?.forEach(v => {
    console.log(`- ${v.title.substring(0, 60)}...`);
    console.log(`  Duration: ${v.duration}, Views: ${v.view_count?.toLocaleString()}`);
  });

  // Get music videos
  const { data: musicVideos } = await supabase
    .from('videos')
    .select('id, title, duration, channel_name')
    .or('title.ilike.%official video%,title.ilike.%music video%,title.ilike.%(official music video)%')
    .limit(5);

  console.log('\n🎵 Sample Music Videos:');
  musicVideos?.forEach(v => {
    console.log(`- ${v.title.substring(0, 60)}...`);
    console.log(`  Channel: ${v.channel_name}, Duration: ${v.duration}`);
  });

  // Check duration format
  const { data: durationSample } = await supabase
    .from('videos')
    .select('id, title, duration')
    .not('duration', 'is', null)
    .limit(10);

  console.log('\n⏱️ Duration data format:');
  durationSample?.forEach(v => {
    console.log(`- "${v.duration}" (${typeof v.duration}) - ${v.title.substring(0, 40)}...`);
  });

  // Try to parse duration if it's in ISO 8601 format
  if (durationSample && durationSample.length > 0) {
    const firstDuration = durationSample[0].duration;
    console.log(`\nTrying to parse duration: "${firstDuration}"`);
    
    // Check if it's ISO 8601 duration (e.g., "PT4M33S")
    if (firstDuration.startsWith('PT')) {
      const match = firstDuration.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
      if (match) {
        const hours = parseInt(match[1] || 0);
        const minutes = parseInt(match[2] || 0);
        const seconds = parseInt(match[3] || 0);
        const totalSeconds = hours * 3600 + minutes * 60 + seconds;
        console.log(`Parsed: ${hours}h ${minutes}m ${seconds}s = ${totalSeconds} total seconds`);
      }
    }
  }

  // Get videos with very short durations
  const { data: shortDurations } = await supabase
    .from('videos')
    .select('id, title, duration')
    .not('duration', 'is', null)
    .or('duration.like.PT%S,duration.like.PT1M%S,duration.eq.PT1M')
    .limit(10);

  console.log('\n⚡ Videos with short durations (likely Shorts):');
  shortDurations?.forEach(v => {
    console.log(`- ${v.duration} - ${v.title.substring(0, 50)}...`);
  });

  // Summary statistics
  console.log('\n📊 Summary:');
  
  const { count: totalVideos } = await supabase
    .from('videos')
    .select('*', { count: 'exact', head: true });
  
  const { count: hasShorts } = await supabase
    .from('videos')
    .select('*', { count: 'exact', head: true })
    .ilike('title', '%#shorts%');
  
  const { count: hasDuration } = await supabase
    .from('videos')
    .select('*', { count: 'exact', head: true })
    .not('duration', 'is', null);

  console.log(`Total videos: ${totalVideos?.toLocaleString()}`);
  console.log(`Videos with #shorts: ${hasShorts?.toLocaleString()} (${((hasShorts/totalVideos)*100).toFixed(1)}%)`);
  console.log(`Videos with duration data: ${hasDuration?.toLocaleString()} (${((hasDuration/totalVideos)*100).toFixed(1)}%)`);
  
  // Check our transcripts to see if shorts have fewer words
  const { data: transcriptComparison } = await supabase
    .from('videos')
    .select(`
      id,
      title,
      duration,
      transcripts!inner(word_count)
    `)
    .order('transcripts.word_count', { ascending: true })
    .limit(20);

  console.log('\n📝 Transcript word counts (sorted):');
  transcriptComparison?.forEach(v => {
    const isShort = v.title.includes('#shorts') || v.title.includes('#Shorts');
    const marker = isShort ? '📱' : '📹';
    console.log(`${marker} ${v.transcripts.word_count.toString().padStart(5)} words - ${v.title.substring(0, 40)}...`);
  });
}

analyzeVideoTypes();