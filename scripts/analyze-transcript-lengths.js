#!/usr/bin/env node

import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config();

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function analyzeTranscriptLengths() {
  // Get all transcripts with video metadata
  const { data: transcripts } = await supabase
    .from('transcripts')
    .select(`
      word_count,
      transcript,
      video_id,
      videos!inner(
        id,
        title,
        channel_name,
        published_at
      )
    `)
    .order('word_count', { ascending: true });

  console.log('\n📊 Transcript Length Analysis:\n');
  console.log('Words  | Video Type | Title');
  console.log('-'.repeat(80));
  
  videos.forEach(v => {
    const wordCount = v.transcripts.word_count;
    let videoType = 'Regular';
    
    // Analyze video type based on patterns
    if (wordCount < 100) {
      videoType = 'Music/Animation';
    } else if (wordCount < 300) {
      videoType = 'Short/Clip';
    } else if (wordCount < 500) {
      videoType = 'Quick Video';
    } else if (wordCount > 2000) {
      videoType = 'Full Video';
    }
    
    console.log(`${wordCount.toString().padEnd(6)} | ${videoType.padEnd(14)} | ${v.title.substring(0, 45)}...`);
    
    // For very short ones, show what's in them
    if (wordCount < 100) {
      const preview = v.transcripts.transcript.substring(0, 80);
      console.log(`       Content: "${preview}..."`);
    }
  });

  // Get YouTube URLs to check manually
  console.log('\n🔗 YouTube URLs for short transcripts (<300 words):');
  const shortVideos = videos.filter(v => v.transcripts.word_count < 300);
  shortVideos.forEach(v => {
    console.log(`- https://youtube.com/watch?v=${v.id} (${v.transcripts.word_count} words)`);
  });
}

analyzeTranscriptLengths();