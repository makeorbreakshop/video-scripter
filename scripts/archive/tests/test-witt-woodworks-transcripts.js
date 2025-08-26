#!/usr/bin/env node

/**
 * Test downloading transcripts specifically from Witt Woodworks channel
 */

import { createClient } from '@supabase/supabase-js';
import fetch from 'node-fetch';
import dotenv from 'dotenv';

dotenv.config();

// Initialize Supabase
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// Supadata config
const SUPADATA_API_KEY = process.env.SUPADATA_API_KEY;
const API_BASE_URL = 'https://api.supadata.ai/v1';

/**
 * Fetch transcript from Supadata
 */
async function fetchTranscript(videoId, title) {
  const videoUrl = `https://www.youtube.com/watch?v=${videoId}`;
  const params = new URLSearchParams({
    url: videoUrl,
    includeTimestamps: 'true',
    lang: 'en'
  });

  console.log(`\n📥 Fetching transcript for: ${title}`);
  console.log(`   URL: ${videoUrl}`);

  const response = await fetch(`${API_BASE_URL}/youtube/transcript?${params}`, {
    method: 'GET',
    headers: {
      'x-api-key': SUPADATA_API_KEY
    }
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Supadata API error: ${response.status} - ${error}`);
  }

  const data = await response.json();
  
  console.log(`   ✅ Response received:`);
  console.log(`   - Language: ${data.lang}`);
  console.log(`   - Available languages: ${data.availableLangs?.join(', ') || 'none'}`);
  console.log(`   - Segments: ${data.content?.length || 0}`);
  
  return data;
}

/**
 * Store transcript in database
 */
async function storeTranscript(videoId, transcriptData) {
  // Extract plain text from segments
  const plainText = transcriptData.content
    .map(segment => segment.text)
    .join(' ');

  // Calculate metrics
  const wordCount = plainText.split(/\s+/).length;
  const characterCount = plainText.length;

  console.log(`\n💾 Storing transcript:`);
  console.log(`   - Words: ${wordCount}`);
  console.log(`   - Characters: ${characterCount}`);
  console.log(`   - Preview: "${plainText.substring(0, 100)}..."`);

  // Prepare data for insertion
  const transcriptRecord = {
    video_id: videoId,
    transcript: plainText,
    language: transcriptData.lang,
    available_languages: transcriptData.availableLangs || [],
    segments: transcriptData.content,
    word_count: wordCount,
    character_count: characterCount,
    fetched_from: 'supadata'
  };

  // Insert into transcripts table
  const { data, error } = await supabase
    .from('transcripts')
    .upsert(transcriptRecord, {
      onConflict: 'video_id'
    })
    .select();

  if (error) throw error;

  console.log(`   ✅ Stored successfully!`);
  return { wordCount, characterCount };
}

/**
 * Main test function
 */
async function testWittWoodworks() {
  console.log('🧪 Testing Witt Woodworks Transcript Downloads\n');

  try {
    // Get Witt Woodworks videos
    console.log('🔍 Finding Witt Woodworks videos...');
    const { data: videos, error: fetchError } = await supabase
      .from('videos')
      .select(`
        id, 
        title, 
        view_count,
        duration,
        transcripts!left(video_id)
      `)
      .eq('channel_name', 'wittworks')
      .is('transcripts.video_id', null)
      .order('view_count', { ascending: false })
      .limit(5);

    if (fetchError) throw fetchError;

    if (!videos || videos.length === 0) {
      console.log('❌ No Witt Woodworks videos found without transcripts');
      
      // Show what we do have
      const { data: allWitt } = await supabase
        .from('videos')
        .select('id, title, channel_name')
        .eq('channel_name', 'wittworks')
        .limit(5);
      
      console.log('\nAvailable Witt Woodworks videos in database:');
      allWitt?.forEach(v => console.log(`- ${v.title}`));
      return;
    }

    console.log(`📹 Found ${videos.length} Witt Woodworks videos without transcripts\n`);

    // Process each video
    for (const video of videos) {
      try {
        // Fetch transcript
        const transcriptData = await fetchTranscript(video.id, video.title);
        
        if (!transcriptData.content || transcriptData.content.length === 0) {
          console.log(`   ⚠️  No transcript available for this video`);
          continue;
        }

        // Store transcript
        const { wordCount, characterCount } = await storeTranscript(video.id, transcriptData);
        
        // Show some sample segments
        console.log(`\n📝 Sample segments:`);
        transcriptData.content.slice(0, 3).forEach((seg, i) => {
          console.log(`   ${i+1}. [${seg.start || '?'}s]: "${seg.text}"`);
        });

      } catch (error) {
        console.error(`\n❌ Error processing ${video.title}:`, error.message);
      }
      
      // Wait 6 seconds between requests (rate limit: 10/min)
      if (videos.indexOf(video) < videos.length - 1) {
        console.log('\n⏳ Waiting 6 seconds (rate limit)...');
        await new Promise(resolve => setTimeout(resolve, 6000));
      }
    }

    // Show summary
    console.log('\n' + '='.repeat(60));
    console.log('📊 SUMMARY:');
    console.log('='.repeat(60));
    
    // Check transcripts for Witt Woodworks
    const { data: wittTranscripts } = await supabase
      .from('transcripts')
      .select(`
        video_id,
        word_count,
        language,
        videos!inner(title, channel_name)
      `)
      .eq('videos.channel_name', 'wittworks');
    
    if (wittTranscripts && wittTranscripts.length > 0) {
      console.log(`\nWitt Woodworks transcripts in database: ${wittTranscripts.length}`);
      wittTranscripts.forEach(t => {
        console.log(`- ${t.videos.title}: ${t.word_count} words`);
      });
    } else {
      console.log('\nNo Witt Woodworks transcripts found in database');
    }

  } catch (error) {
    console.error('\n❌ Fatal error:', error);
  }
}

// Run the test
testWittWoodworks();