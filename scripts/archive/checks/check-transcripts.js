#!/usr/bin/env node

import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config();

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function checkTranscripts() {
  // Get transcript count
  const { count } = await supabase
    .from('transcripts')
    .select('*', { count: 'exact', head: true });
  
  console.log(`\n📊 Total transcripts in database: ${count}\n`);

  // Get sample transcripts
  const { data: samples } = await supabase
    .from('transcripts')
    .select('video_id, word_count, character_count, language, fetched_at')
    .order('fetched_at', { ascending: false })
    .limit(10);

  console.log('Recent transcripts:');
  console.log('ID                   | Words  | Chars   | Lang | Fetched');
  console.log('-'.repeat(70));
  
  samples.forEach(t => {
    const fetched = new Date(t.fetched_at).toLocaleString();
    console.log(`${t.video_id.padEnd(20)} | ${t.word_count.toString().padEnd(6)} | ${t.character_count.toString().padEnd(7)} | ${t.language}   | ${fetched}`);
  });

  // Get a full transcript example
  const { data: example } = await supabase
    .from('transcripts')
    .select('video_id, transcript')
    .limit(1)
    .single();

  if (example) {
    console.log(`\n📝 Example transcript (${example.video_id}):`);
    console.log(example.transcript.substring(0, 200) + '...');
  }
}

checkTranscripts();