#!/usr/bin/env node

/**
 * Test downloading transcripts from Supadata and storing in Supabase
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
async function fetchTranscript(videoUrl) {
  const params = new URLSearchParams({
    url: videoUrl,
    includeTimestamps: 'true',
    lang: 'en'
  });

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

  return await response.json();
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

  // Prepare data for insertion
  const transcriptRecord = {
    video_id: videoId,
    transcript: plainText,
    language: transcriptData.lang,
    available_languages: transcriptData.availableLangs || [],
    segments: transcriptData.content, // Store full segment data
    word_count: wordCount,
    character_count: characterCount,
    fetched_from: 'supadata'
  };

  // Insert into database
  const { data, error } = await supabase
    .from('transcripts')
    .upsert(transcriptRecord, {
      onConflict: 'video_id'
    })
    .select();

  if (error) {
    throw error;
  }

  return data[0];
}

/**
 * Main test function
 */
async function testTranscriptDownload() {
  console.log('🧪 Testing Transcript Download & Storage\n');

  try {
    // First, create the transcripts table if it doesn't exist
    console.log('📊 Creating transcripts table...');
    const sqlContent = await fs.readFile('./scripts/create-transcripts-table.sql', 'utf8');
    const { error: tableError } = await supabase.rpc('exec_sql', { sql: sqlContent });
    
    if (tableError && !tableError.message.includes('already exists')) {
      console.error('❌ Error creating table:', tableError);
      // Continue anyway, table might already exist
    }

    // Get a few test videos from the database
    console.log('\n🔍 Fetching test videos from database...');
    const { data: videos, error: fetchError } = await supabase
      .from('videos')
      .select('id, title, channel_name')
      .order('view_count', { ascending: false })
      .limit(3);

    if (fetchError) {
      throw fetchError;
    }

    console.log(`\n📹 Found ${videos.length} test videos`);

    // Process each video
    for (const video of videos) {
      console.log(`\n➡️  Processing: ${video.title}`);
      console.log(`   Channel: ${video.channel_name}`);
      console.log(`   Video ID: ${video.id}`);

      try {
        // Check if transcript already exists
        const { data: existing } = await supabase
          .from('transcripts')
          .select('video_id, word_count, fetched_at')
          .eq('video_id', video.id)
          .single();

        if (existing) {
          console.log(`   ⏭️  Transcript already exists (${existing.word_count} words)`);
          continue;
        }

        // Fetch transcript from Supadata
        console.log('   📥 Fetching transcript from Supadata...');
        const videoUrl = `https://www.youtube.com/watch?v=${video.id}`;
        const transcriptData = await fetchTranscript(videoUrl);

        if (!transcriptData.content || transcriptData.content.length === 0) {
          console.log('   ⚠️  No transcript available for this video');
          continue;
        }

        // Store in database
        console.log('   💾 Storing transcript in database...');
        const stored = await storeTranscript(video.id, transcriptData);

        console.log(`   ✅ Success! Stored ${stored.word_count} words (${stored.character_count} chars)`);
        console.log(`   🌐 Language: ${stored.language}`);
        console.log(`   🎯 Segments: ${transcriptData.content.length}`);

      } catch (error) {
        console.error(`   ❌ Error: ${error.message}`);
      }
    }

    // Show summary
    console.log('\n📊 Summary:');
    const { count } = await supabase
      .from('transcripts')
      .select('*', { count: 'exact', head: true });
    
    console.log(`Total transcripts in database: ${count || 0}`);

    // Test the view
    console.log('\n🔍 Testing videos_with_transcripts view...');
    const { data: viewData, error: viewError } = await supabase
      .from('videos_with_transcripts')
      .select('id, title, transcript, word_count')
      .not('transcript', 'is', null)
      .limit(1);

    if (viewError) {
      console.error('❌ View error:', viewError);
    } else if (viewData && viewData.length > 0) {
      console.log('✅ View working! Sample transcript:');
      console.log(`   Title: ${viewData[0].title}`);
      console.log(`   Words: ${viewData[0].word_count}`);
      console.log(`   Preview: ${viewData[0].transcript.substring(0, 100)}...`);
    }

  } catch (error) {
    console.error('\n❌ Fatal error:', error);
  }
}

// Import fs/promises
import { promises as fs } from 'fs';

// Run the test
testTranscriptDownload();