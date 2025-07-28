#!/usr/bin/env node

import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config();

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function analyzeDescriptions() {
  // Get top 1000 videos by view count
  const { data: videos } = await supabase
    .from('videos')
    .select('id, title, channel_name, description, view_count')
    .is('llm_summary', null)
    .order('view_count', { ascending: false })
    .limit(1000);
  
  console.log('Total videos fetched:', videos.length);
  
  // Analyze descriptions
  const noDesc = videos.filter(v => !v.description);
  const shortDesc = videos.filter(v => v.description && v.description.length < 50);
  const validDesc = videos.filter(v => v.description && v.description.length >= 50);
  
  console.log('\nDescription breakdown:');
  console.log('- No description:', noDesc.length);
  console.log('- Description < 50 chars:', shortDesc.length);
  console.log('- Description >= 50 chars:', validDesc.length);
  
  // Show some examples of short descriptions
  console.log('\nExamples of short descriptions:');
  shortDesc.slice(0, 5).forEach(v => {
    console.log('\n' + v.title);
    console.log('  Views:', v.view_count?.toLocaleString());
    console.log('  Desc length:', v.description?.length);
    console.log('  Description:', JSON.stringify(v.description));
  });
  
  // Show some examples of no descriptions
  console.log('\nExamples of videos with no description:');
  noDesc.slice(0, 5).forEach(v => {
    console.log('\n' + v.title);
    console.log('  Channel:', v.channel_name);
    console.log('  Views:', v.view_count?.toLocaleString());
  });
  
  // Check what channels these are from
  const channelCounts = {};
  videos.forEach(v => {
    channelCounts[v.channel_name] = (channelCounts[v.channel_name] || 0) + 1;
  });
  
  console.log('\nTop channels in this batch:');
  Object.entries(channelCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .forEach(([channel, count]) => {
      console.log(`  ${channel}: ${count} videos`);
    });
}

analyzeDescriptions();