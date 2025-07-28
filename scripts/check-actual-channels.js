#!/usr/bin/env node

import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config();

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function checkActualChannels() {
  console.log('📊 Checking YOUR actual database channels:\n');
  
  // Get channel distribution
  const { data: channels, error } = await supabase
    .from('videos')
    .select('channel_name')
    .not('channel_name', 'is', null);
  
  if (error) {
    console.error('Error:', error);
    return;
  }
  
  // Count videos per channel
  const channelCounts = {};
  channels.forEach(video => {
    channelCounts[video.channel_name] = (channelCounts[video.channel_name] || 0) + 1;
  });
  
  // Sort by count
  const sortedChannels = Object.entries(channelCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 30);
  
  console.log('Top 30 channels by video count:');
  sortedChannels.forEach(([channel, count], i) => {
    console.log(`${i + 1}. ${channel}: ${count} videos`);
  });
  
  // Get sample of recent videos
  console.log('\n\nSample of actual videos with descriptions:');
  
  const { data: sampleVideos } = await supabase
    .from('videos')
    .select('title, channel_name, description')
    .not('description', 'is', null)
    .gte('length(description)', 300)
    .limit(10);
  
  sampleVideos?.forEach((video, i) => {
    console.log(`\n${i + 1}. "${video.title.substring(0, 60)}..."`);
    console.log(`   Channel: ${video.channel_name}`);
    console.log(`   Desc preview: ${video.description.substring(0, 100)}...`);
  });
  
  console.log('\n\nTotal videos in database:', channels.length);
}

checkActualChannels().catch(console.error);