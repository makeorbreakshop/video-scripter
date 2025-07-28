#!/usr/bin/env node

import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config();

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function sampleRealVideos() {
  console.log('🎥 Sampling YOUR ACTUAL video database:\n');
  
  // Get videos with descriptions from different channels
  const { data: videos, error } = await supabase
    .from('videos')
    .select('id, title, description, channel_name, view_count')
    .not('description', 'is', null)
    .limit(200);  // Get more to filter
    
  if (error) {
    console.error('Error:', error);
    return;
  }
  
  // Filter for substantial descriptions and random sample
  const filtered = videos
    .filter(v => v.description && v.description.length >= 200)
    .sort(() => Math.random() - 0.5)  // Random shuffle
    .slice(0, 20);
  
  console.log(`Found ${filtered.length} videos with substantial descriptions\n`);
  
  // Group by channel to see diversity
  const channels = new Set(filtered.map(v => v.channel_name));
  console.log(`Channels represented: ${channels.size}`);
  console.log('Channels:', Array.from(channels).join(', '));
  
  console.log('\n\nSample videos:\n');
  
  filtered.forEach((video, i) => {
    console.log(`${i + 1}. "${video.title}"`);
    console.log(`   Channel: ${video.channel_name}`);
    console.log(`   Views: ${video.view_count?.toLocaleString() || 'N/A'}`);
    console.log(`   Description: ${video.description.substring(0, 150)}...`);
    console.log('');
  });
}

sampleRealVideos().catch(console.error);