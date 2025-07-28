#!/usr/bin/env node

import { createClient } from '@supabase/supabase-js';
import fetch from 'node-fetch';
import dotenv from 'dotenv';

dotenv.config();

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const SUPADATA_API_KEY = process.env.SUPADATA_API_KEY;
const API_BASE_URL = 'https://api.supadata.ai/v1';

async function testNewVideoTranscript() {
  console.log('🧪 Testing Supadata with a Fresh Video\n');

  // Use a popular ILTMS video
  const videoId = 'lP3eKX9JQeI'; // "Making a Giant Pencil"
  const videoUrl = `https://www.youtube.com/watch?v=${videoId}`;

  // Check if we already have this transcript
  const { data: existing } = await supabase
    .from('transcripts')
    .select('video_id')
    .eq('video_id', videoId)
    .single();

  if (existing) {
    console.log('⚠️  This video already has a transcript, but continuing anyway...\n');
  }

  console.log('📹 Video: I Like To Make Stuff - Making a Giant Pencil');
  console.log(`   URL: ${videoUrl}\n`);

  // Make Supadata API call
  const params = new URLSearchParams({
    url: videoUrl,
    includeTimestamps: 'true',
    lang: 'en'
  });

  console.log('🚀 Calling Supadata API...');
  console.log(`   Endpoint: ${API_BASE_URL}/youtube/transcript`);
  console.log(`   API Key: ${SUPADATA_API_KEY ? SUPADATA_API_KEY.substring(0, 10) + '...' : 'NOT SET'}\n`);

  try {
    const response = await fetch(`${API_BASE_URL}/youtube/transcript?${params}`, {
      method: 'GET',
      headers: {
        'x-api-key': SUPADATA_API_KEY
      }
    });

    console.log(`📡 Response Status: ${response.status} ${response.statusText}`);

    if (!response.ok) {
      const error = await response.text();
      console.error(`\n❌ API Error: ${error}`);
      return;
    }

    const data = await response.json();
    
    console.log('\n✅ Successfully fetched transcript!');
    console.log(`   Language: ${data.lang}`);
    console.log(`   Segments: ${data.content?.length || 0}`);
    console.log(`   Available languages: ${data.availableLangs?.join(', ') || 'none'}`);

    // Calculate stats
    const fullText = data.content.map(s => s.text).join(' ');
    const wordCount = fullText.split(/\s+/).filter(w => w.length > 0).length;
    const charCount = fullText.length;

    console.log(`\n📊 Transcript Stats:`);
    console.log(`   Words: ${wordCount.toLocaleString()}`);
    console.log(`   Characters: ${charCount.toLocaleString()}`);

    // Delete existing if present
    if (existing) {
      await supabase
        .from('transcripts')
        .delete()
        .eq('video_id', videoId);
    }

    // Store in database
    console.log('\n💾 Storing transcript in database...');
    
    const { error: insertError } = await supabase
      .from('transcripts')
      .insert({
        video_id: videoId,
        transcript: fullText,
        language: data.lang,
        available_languages: data.availableLangs || ['en'],
        segments: data.content,
        word_count: wordCount,
        character_count: charCount,
        fetched_from: 'supadata',
        fetched_at: new Date().toISOString()
      });

    if (insertError) {
      console.error('❌ Database error:', insertError);
      return;
    }

    console.log('✅ Transcript stored successfully!');
    
    // Verify it's in the database
    const { data: verify } = await supabase
      .from('transcripts')
      .select('video_id, word_count, fetched_from')
      .eq('video_id', videoId)
      .single();

    console.log('\n🔍 Verification:');
    console.log(`   Video ID: ${verify.video_id}`);
    console.log(`   Word Count: ${verify.word_count}`);
    console.log(`   Fetched From: ${verify.fetched_from}`);

    console.log('\n📈 IMPORTANT: This should increment your Supadata usage from 5 to 6!');
    console.log('   Check: https://dash.supadata.ai');
    console.log('\n📝 First 300 characters of transcript:');
    console.log(`   "${fullText.substring(0, 300)}..."`);

  } catch (error) {
    console.error('\n❌ Fatal error:', error);
  }
}

testNewVideoTranscript();