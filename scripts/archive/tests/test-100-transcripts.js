#!/usr/bin/env node

/**
 * Test downloading 100 transcripts from Supadata
 * Updates videos table to track which videos have transcripts
 */

import { createClient } from '@supabase/supabase-js';
import fetch from 'node-fetch';
import dotenv from 'dotenv';
import pLimit from 'p-limit';

dotenv.config();

// Initialize Supabase
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// Supadata config
const SUPADATA_API_KEY = process.env.SUPADATA_API_KEY;
const API_BASE_URL = 'https://api.supadata.ai/v1';

// Rate limiting - Supadata starter plan: 10 requests per minute
const limit = pLimit(1); // 1 concurrent request
const DELAY_MS = 6000; // 6 seconds between requests (10 per minute)

/**
 * Sleep function for rate limiting
 */
async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Fetch transcript from Supadata
 */
async function fetchTranscript(videoId) {
  const videoUrl = `https://www.youtube.com/watch?v=${videoId}`;
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
    segments: transcriptData.content,
    word_count: wordCount,
    character_count: characterCount,
    fetched_from: 'supadata'
  };

  // Insert into transcripts table
  const { error } = await supabase
    .from('transcripts')
    .upsert(transcriptRecord, {
      onConflict: 'video_id'
    });

  if (error) throw error;

  // No need to update videos table since we're checking via join

  return { wordCount, characterCount };
}

/**
 * Main test function
 */
async function test100Transcripts() {
  console.log('🧪 Testing Transcript Downloads (Rate Limited: 10/min)\n');

  try {
    // Get 100 videos that don't have transcripts yet
    // Check by joining with transcripts table instead of using has_transcript column
    console.log('🔍 Finding videos without transcripts...');
    const { data: videos, error: fetchError } = await supabase
      .from('videos')
      .select(`
        id, 
        title, 
        channel_name, 
        view_count,
        transcripts!left(video_id)
      `)
      .is('transcripts.video_id', null)
      .order('view_count', { ascending: false })
      .limit(10);

    if (fetchError) throw fetchError;

    console.log(`📹 Found ${videos.length} videos to process\n`);

    // Track statistics
    const stats = {
      attempted: 0,
      successful: 0,
      failed: 0,
      noTranscript: 0,
      totalWords: 0,
      totalChars: 0
    };

    // Process videos with rate limiting
    const results = await Promise.allSettled(
      videos.map(video => 
        limit(async () => {
          stats.attempted++;
          const progress = `[${stats.attempted}/${videos.length}]`;
          
          try {
            console.log(`${progress} Processing: ${video.title.substring(0, 50)}...`);
            
            // Add delay for rate limiting (except for first request)
            if (stats.attempted > 1) {
              await sleep(DELAY_MS);
            }
            
            // Fetch transcript
            const transcriptData = await fetchTranscript(video.id);
            
            if (!transcriptData.content || transcriptData.content.length === 0) {
              stats.noTranscript++;
              console.log(`${progress} ⚠️  No transcript available`);
              return { videoId: video.id, status: 'no_transcript' };
            }

            // Store transcript
            const { wordCount, characterCount } = await storeTranscript(video.id, transcriptData);
            
            stats.successful++;
            stats.totalWords += wordCount;
            stats.totalChars += characterCount;
            
            console.log(`${progress} ✅ Success! ${wordCount} words`);
            return { videoId: video.id, status: 'success', wordCount };
            
          } catch (error) {
            stats.failed++;
            console.log(`${progress} ❌ Error: ${error.message}`);
            return { videoId: video.id, status: 'error', error: error.message };
          }
        })
      )
    );

    // Show summary
    console.log('\n' + '='.repeat(60));
    console.log('📊 SUMMARY:');
    console.log('='.repeat(60));
    console.log(`Attempted:        ${stats.attempted}`);
    console.log(`Successful:       ${stats.successful} (${(stats.successful/stats.attempted*100).toFixed(1)}%)`);
    console.log(`Failed:           ${stats.failed}`);
    console.log(`No Transcript:    ${stats.noTranscript}`);
    console.log(`\nTotal Words:      ${stats.totalWords.toLocaleString()}`);
    console.log(`Total Characters: ${stats.totalChars.toLocaleString()}`);
    console.log(`Avg Words/Video:  ${Math.round(stats.totalWords / stats.successful)}`);

    // Check total transcripts in database
    const { count } = await supabase
      .from('transcripts')
      .select('*', { count: 'exact', head: true });
    
    console.log(`\nTotal transcripts in database: ${count || 0}`);

    // Show cost estimate
    const costPer1000 = 0.93;
    const costForThisBatch = (stats.successful * costPer1000 / 1000);
    const costFor170k = (170000 * costPer1000 / 1000);
    
    console.log('\n💰 COST ANALYSIS:');
    console.log(`This batch cost: $${costForThisBatch.toFixed(2)}`);
    console.log(`Estimated for 170K videos: $${costFor170k.toFixed(2)}`);

  } catch (error) {
    console.error('\n❌ Fatal error:', error);
  }
}

// Run the test
test100Transcripts();