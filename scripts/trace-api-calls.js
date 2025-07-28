#!/usr/bin/env node

import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config();

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function traceAPICalls() {
  console.log('🔍 Tracing How We Got 41 Transcripts\n');

  // Get all transcripts grouped by fetch time
  const { data: transcripts } = await supabase
    .from('transcripts')
    .select('video_id, fetched_at, word_count')
    .order('fetched_at', { ascending: true });

  // Group by exact timestamp (videos fetched in same batch)
  const batches = {};
  transcripts.forEach(t => {
    const timestamp = t.fetched_at;
    if (!batches[timestamp]) {
      batches[timestamp] = [];
    }
    batches[timestamp].push(t.video_id);
  });

  console.log(`Found ${Object.keys(batches).length} distinct fetch times:\n`);

  Object.entries(batches).forEach(([timestamp, videos], i) => {
    const time = new Date(timestamp).toLocaleTimeString();
    console.log(`Batch ${i + 1} at ${time}: ${videos.length} videos`);
    if (videos.length > 1) {
      console.log(`  ⚠️  Multiple videos with EXACT same timestamp!`);
      console.log(`  Videos: ${videos.slice(0, 3).join(', ')}${videos.length > 3 ? '...' : ''}`);
    }
  });

  // Check for the initial test videos
  const testVideos = ['dQw4w9WgXcQ', '0e3GPea1Tyg', 'zxYjTTXc-J8'];
  console.log('\n🎯 Initial test videos:');
  
  for (const videoId of testVideos) {
    const { data } = await supabase
      .from('transcripts')
      .select('fetched_at')
      .eq('video_id', videoId)
      .single();
    
    if (data) {
      console.log(`${videoId}: Fetched at ${new Date(data.fetched_at).toLocaleTimeString()}`);
    }
  }

  console.log('\n💡 Theory: We likely:');
  console.log('1. Made 3-4 real API calls in initial tests');
  console.log('2. All other "downloads" reused these same popular videos');
  console.log('3. Database shows 41 records but many are duplicates from different test runs');
}

traceAPICalls();