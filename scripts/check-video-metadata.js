#!/usr/bin/env node

import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config();

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function checkVideoMetadata() {
  console.log('🔍 Checking video metadata for shorts/music detection...\n');

  // Get a sample of videos to see what fields we have
  const { data: sample } = await supabase
    .from('videos')
    .select('*')
    .limit(1);

  if (sample && sample.length > 0) {
    console.log('📊 Available fields in videos table:');
    Object.keys(sample[0]).forEach(key => {
      const value = sample[0][key];
      const type = typeof value;
      console.log(`- ${key}: ${type}${value === null ? ' (null)' : ''}`);
    });
  }

  // Check specific videos we know are shorts or music
  console.log('\n🎵 Checking known music/short videos:\n');

  const knownVideos = [
    { id: 'dQw4w9WgXcQ', type: 'Music Video', name: 'Rick Astley - Never Gonna Give You Up' },
    { id: '_FTyY7UE2_E', type: 'Short', name: "World's Strongest Man VS Apple" },
    { id: 'pCBP4M08ndE', type: 'Animation', name: 'Cave Spider Roller Coaster' },
    { id: '0e3GPea1Tyg', type: 'Long Video', name: '$456,000 Squid Game In Real Life!' }
  ];

  for (const video of knownVideos) {
    const { data } = await supabase
      .from('videos')
      .select('id, title, duration, category_id, tags, description')
      .eq('id', video.id)
      .single();

    if (data) {
      console.log(`${video.type}: ${video.name}`);
      console.log(`  Duration: ${data.duration || 'null'} seconds`);
      console.log(`  Category: ${data.category_id || 'null'}`);
      console.log(`  Tags: ${data.tags ? JSON.stringify(data.tags).substring(0, 100) + '...' : 'null'}`);
      console.log(`  Description preview: ${data.description ? data.description.substring(0, 50) + '...' : 'null'}`);
      console.log('');
    }
  }

  // Check if we have any duration data
  const { data: durationStats } = await supabase
    .from('videos')
    .select('duration')
    .not('duration', 'is', null)
    .limit(100);

  console.log(`\n📏 Duration data availability:`);
  console.log(`Videos with duration data: ${durationStats?.length || 0} out of 100 checked`);

  if (durationStats && durationStats.length > 0) {
    const durations = durationStats.map(v => v.duration).filter(d => d > 0);
    console.log(`Min duration: ${Math.min(...durations)} seconds`);
    console.log(`Max duration: ${Math.max(...durations)} seconds`);
    
    // Count potential shorts (<=60 seconds)
    const shorts = durations.filter(d => d <= 60).length;
    console.log(`Potential shorts (≤60s): ${shorts}`);
  }

  // Check category_id distribution
  const { data: categories } = await supabase
    .from('videos')
    .select('category_id')
    .not('category_id', 'is', null);

  if (categories && categories.length > 0) {
    const categoryCounts = {};
    categories.forEach(v => {
      categoryCounts[v.category_id] = (categoryCounts[v.category_id] || 0) + 1;
    });

    console.log('\n📁 Category distribution:');
    Object.entries(categoryCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .forEach(([cat, count]) => {
        console.log(`  Category ${cat}: ${count} videos`);
      });
  }

  // Check for specific patterns in titles
  console.log('\n🔤 Title pattern analysis:');
  
  const { count: shortsInTitle } = await supabase
    .from('videos')
    .select('*', { count: 'exact', head: true })
    .ilike('title', '%#shorts%');
  
  const { count: musicInTitle } = await supabase
    .from('videos')
    .select('*', { count: 'exact', head: true })
    .or('title.ilike.%official video%,title.ilike.%music video%,title.ilike.%lyric video%');

  console.log(`Videos with "#shorts" in title: ${shortsInTitle || 0}`);
  console.log(`Videos with music video indicators: ${musicInTitle || 0}`);
}

checkVideoMetadata();