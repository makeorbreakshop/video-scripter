#!/usr/bin/env node

import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config();

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function checkWittWoodworks() {
  // Search for Witt Woodworks in different ways
  console.log('🔍 Searching for Witt Woodworks videos...\n');

  // Check exact match
  const { data: exact, count: exactCount } = await supabase
    .from('videos')
    .select('id, title, channel_name', { count: 'exact' })
    .eq('channel_name', 'Witt Woodworks')
    .limit(5);

  console.log(`Exact match "Witt Woodworks": ${exactCount || 0} videos`);
  if (exact && exact.length > 0) {
    exact.forEach(v => console.log(`- ${v.title}`));
  }

  // Check case-insensitive
  const { data: ilike, count: ilikeCount } = await supabase
    .from('videos')
    .select('id, title, channel_name', { count: 'exact' })
    .ilike('channel_name', '%witt%')
    .limit(10);

  console.log(`\nPartial match containing "witt": ${ilikeCount || 0} videos`);
  if (ilike && ilike.length > 0) {
    const uniqueChannels = [...new Set(ilike.map(v => v.channel_name))];
    console.log('Unique channel names:');
    uniqueChannels.forEach(c => console.log(`- "${c}"`));
  }

  // Check for woodworking content
  const { data: woodworking } = await supabase
    .from('videos')
    .select('id, title, channel_name')
    .or('title.ilike.%woodwork%,channel_name.ilike.%woodwork%')
    .limit(10);

  console.log(`\nVideos/channels with "woodwork": ${woodworking?.length || 0}`);
  if (woodworking && woodworking.length > 0) {
    const uniqueChannels = [...new Set(woodworking.map(v => v.channel_name))];
    console.log('Woodworking channels:');
    uniqueChannels.forEach(c => console.log(`- "${c}"`));
  }

  // Show sample of channel names
  const { data: sampleChannels } = await supabase
    .from('videos')
    .select('channel_name')
    .limit(100);

  if (sampleChannels) {
    const unique = [...new Set(sampleChannels.map(v => v.channel_name))];
    console.log(`\n📺 Sample of ${unique.length} channel names in database:`);
    unique.slice(0, 20).forEach(c => console.log(`- ${c}`));
  }
}

checkWittWoodworks();