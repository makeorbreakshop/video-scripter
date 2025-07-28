#!/usr/bin/env node

import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config();

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function findVideoForTranscript() {
  // Get recent videos
  const { data: videos } = await supabase
    .from('videos')
    .select('id, title, channel_title')
    .order('created_at', { ascending: false })
    .limit(50);

  console.log(`Found ${videos?.length || 0} recent videos\n`);

  // Find one without a transcript
  for (const video of videos || []) {
    const { data: hasTranscript } = await supabase
      .from('transcripts')
      .select('video_id')
      .eq('video_id', video.id)
      .single();
    
    if (!hasTranscript) {
      console.log('✅ Found video without transcript:');
      console.log(`   Title: ${video.title}`);
      console.log(`   Channel: ${video.channel_title}`);
      console.log(`   ID: ${video.id}`);
      return video;
    }
  }

  console.log('❌ All recent videos already have transcripts');
  return null;
}

findVideoForTranscript();