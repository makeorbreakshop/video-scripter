#!/usr/bin/env node

import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config();

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function verifyTranscripts() {
  console.log('🔍 Verifying Transcript Content\n');

  // Get a few transcripts to check
  const { data: transcripts } = await supabase
    .from('transcripts')
    .select('video_id, transcript, word_count, segments')
    .limit(5);

  transcripts.forEach((t, i) => {
    console.log(`\n${i + 1}. Video ID: ${t.video_id}`);
    console.log(`   Claimed words: ${t.word_count}`);
    
    // Count actual words
    const actualWords = t.transcript.split(/\s+/).length;
    console.log(`   Actual words: ${actualWords}`);
    
    // Check if segments exist
    const segmentCount = t.segments ? t.segments.length : 0;
    console.log(`   Segments: ${segmentCount}`);
    
    // Show first 200 chars of transcript
    console.log(`   Content: "${t.transcript.substring(0, 200)}..."`);
    
    // Check for suspicious patterns
    if (actualWords < 50) {
      console.log(`   ⚠️  WARNING: Very short transcript!`);
    }
    if (Math.abs(actualWords - t.word_count) > 10) {
      console.log(`   ⚠️  WARNING: Word count mismatch!`);
    }
  });

  // Check for duplicate content
  const { data: allTranscripts } = await supabase
    .from('transcripts')
    .select('video_id, transcript');

  const transcriptHashes = {};
  let duplicates = 0;
  
  allTranscripts.forEach(t => {
    const hash = t.transcript.substring(0, 100); // Simple duplicate check
    if (transcriptHashes[hash]) {
      duplicates++;
      console.log(`\n⚠️  Duplicate content found: ${t.video_id} matches ${transcriptHashes[hash]}`);
    } else {
      transcriptHashes[hash] = t.video_id;
    }
  });

  console.log(`\n📊 Summary:`);
  console.log(`Total duplicates found: ${duplicates}`);
}

verifyTranscripts();