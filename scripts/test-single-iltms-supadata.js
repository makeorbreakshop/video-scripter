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

async function testSingleILTMSTranscript() {
  console.log('🧪 Testing Single ILTMS Transcript with Supadata\n');

  // Get a recent ILTMS video we don't have yet
  const { data: videos } = await supabase
    .from('videos')
    .select('id, title, published_at')
    .eq('channel_title', 'I Like To Make Stuff')
    .order('published_at', { ascending: false })
    .limit(20);

  if (!videos || videos.length === 0) {
    console.log('❌ No ILTMS videos found');
    return;
  }

  // Find one we don't have a transcript for
  let targetVideo = null;
  for (const video of videos) {
    const { data: existing } = await supabase
      .from('transcripts')
      .select('video_id')
      .eq('video_id', video.id)
      .single();
    
    if (!existing) {
      targetVideo = video;
      break;
    }
  }

  if (!targetVideo) {
    console.log('❌ No ILTMS videos without transcripts found');
    return;
  }

  console.log(`📹 Selected Video: ${targetVideo.title}`);
  console.log(`   ID: ${targetVideo.id}`);
  console.log(`   Published: ${new Date(targetVideo.published_at).toLocaleDateString()}\n`);

  // Make Supadata API call
  const videoUrl = `https://www.youtube.com/watch?v=${targetVideo.id}`;
  const params = new URLSearchParams({
    url: videoUrl,
    includeTimestamps: 'true',
    lang: 'en'
  });

  console.log('🚀 Calling Supadata API...');
  console.log(`   URL: ${API_BASE_URL}/youtube/transcript?${params}\n`);

  try {
    const response = await fetch(`${API_BASE_URL}/youtube/transcript?${params}`, {
      method: 'GET',
      headers: {
        'x-api-key': SUPADATA_API_KEY
      }
    });

    if (!response.ok) {
      const error = await response.text();
      console.error(`❌ API Error: ${error}`);
      return;
    }

    const data = await response.json();
    
    console.log('✅ Successfully fetched transcript!');
    console.log(`   Language: ${data.lang}`);
    console.log(`   Segments: ${data.content?.length || 0}`);
    console.log(`   Available languages: ${data.availableLangs?.join(', ') || 'none'}\n`);

    // Calculate word count
    const fullText = data.content.map(s => s.text).join(' ');
    const wordCount = fullText.split(/\s+/).filter(w => w.length > 0).length;
    const charCount = fullText.length;

    console.log(`📊 Transcript Stats:`);
    console.log(`   Words: ${wordCount.toLocaleString()}`);
    console.log(`   Characters: ${charCount.toLocaleString()}\n`);

    // Store in database
    console.log('💾 Storing transcript in database...');
    
    const { error: insertError } = await supabase
      .from('transcripts')
      .insert({
        video_id: targetVideo.id,
        transcript: fullText,
        language: data.lang,
        available_languages: data.availableLangs || ['en'],
        segments: data.content,
        word_count: wordCount,
        character_count: charCount,
        fetched_from: 'supadata' // Correctly marking as Supadata
      });

    if (insertError) {
      console.error('❌ Database error:', insertError);
      return;
    }

    console.log('✅ Transcript stored successfully!\n');
    console.log('📈 This should have incremented your Supadata usage from 5 to 6');
    console.log('   Check: https://dash.supadata.ai\n');

    // Show first 200 chars of transcript
    console.log('📝 First 200 characters:');
    console.log(`   "${fullText.substring(0, 200)}..."`);

  } catch (error) {
    console.error('❌ Fatal error:', error);
  }
}

testSingleILTMSTranscript();