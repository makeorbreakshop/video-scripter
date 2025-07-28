#!/usr/bin/env node

import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config();

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function checkTranscriptDetails() {
  // Get all transcripts with video details
  const { data: transcripts } = await supabase
    .from('videos_with_transcripts')
    .select('id, title, channel_name, duration, word_count, transcript')
    .not('transcript', 'is', null)
    .order('word_count', { ascending: true });

  console.log('\n📊 Transcript Analysis:\n');
  console.log('Words  | Duration | Title');
  console.log('-'.repeat(80));
  
  transcripts.forEach(t => {
    const durMin = Math.floor(t.duration / 60);
    const durSec = t.duration % 60;
    const duration = `${durMin}:${durSec.toString().padStart(2, '0')}`;
    console.log(`${t.word_count.toString().padEnd(6)} | ${duration.padEnd(8)} | ${t.title.substring(0, 50)}...`);
    
    // Show preview of short transcripts
    if (t.word_count < 500) {
      console.log(`       Preview: "${t.transcript.substring(0, 100)}..."`);
      console.log('');
    }
  });

  // Calculate stats
  const totalWords = transcripts.reduce((sum, t) => sum + t.word_count, 0);
  const avgWords = Math.round(totalWords / transcripts.length);
  const shortTranscripts = transcripts.filter(t => t.word_count < 500).length;
  
  console.log('\n📈 Summary:');
  console.log(`Total transcripts: ${transcripts.length}`);
  console.log(`Average words: ${avgWords}`);
  console.log(`Short transcripts (<500 words): ${shortTranscripts}`);
  console.log(`Shortest: ${transcripts[0].word_count} words`);
  console.log(`Longest: ${transcripts[transcripts.length-1].word_count} words`);
}

checkTranscriptDetails();