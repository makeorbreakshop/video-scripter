#!/usr/bin/env node

/**
 * Smart transcript downloader that skips shorts and music videos
 */

import { createClient } from '@supabase/supabase-js';
import fetch from 'node-fetch';
import dotenv from 'dotenv';
import pLimit from 'p-limit';
import { parseDurationToSeconds, getVideoType } from './utils/video-type-detector.js';

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
const limit = pLimit(1);
const DELAY_MS = 6000; // 6 seconds between requests

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

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

async function storeTranscript(videoId, transcriptData) {
  const plainText = transcriptData.content
    .map(segment => segment.text)
    .join(' ');

  const wordCount = plainText.split(/\s+/).length;
  const characterCount = plainText.length;

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

  const { error } = await supabase
    .from('transcripts')
    .upsert(transcriptRecord, {
      onConflict: 'video_id'
    });

  if (error) throw error;

  return { wordCount, characterCount };
}

async function downloadTranscriptsSmart(limit = 20) {
  console.log('🧪 Smart Transcript Download (Skipping Shorts & Music)\n');

  try {
    // Get videos without transcripts, excluding those we already know are problematic
    console.log('🔍 Finding suitable videos for transcripts...');
    const { data: videos, error: fetchError } = await supabase
      .from('videos')
      .select(`
        id, 
        title, 
        channel_name, 
        view_count,
        duration,
        transcripts!left(video_id)
      `)
      .is('transcripts.video_id', null)
      .order('view_count', { ascending: false })
      .limit(limit * 3); // Get extra to account for filtering

    if (fetchError) throw fetchError;

    // Filter out shorts and music videos
    console.log(`\n🎯 Filtering videos...`);
    const regularVideos = [];
    let skippedShorts = 0;
    let skippedMusic = 0;

    for (const video of videos) {
      const type = getVideoType(video);
      if (type === 'short') {
        skippedShorts++;
      } else if (type === 'music') {
        skippedMusic++;
      } else {
        regularVideos.push(video);
        if (regularVideos.length >= limit) break;
      }
    }

    console.log(`✅ Found ${regularVideos.length} regular videos`);
    console.log(`⏭️  Skipped ${skippedShorts} shorts`);
    console.log(`⏭️  Skipped ${skippedMusic} music videos\n`);

    // Track statistics
    const stats = {
      attempted: 0,
      successful: 0,
      failed: 0,
      noTranscript: 0,
      totalWords: 0,
      totalChars: 0
    };

    // Process regular videos
    for (const video of regularVideos) {
      stats.attempted++;
      const progress = `[${stats.attempted}/${regularVideos.length}]`;
      const seconds = parseDurationToSeconds(video.duration);
      const duration = seconds ? `${Math.floor(seconds/60)}:${(seconds%60).toString().padStart(2,'0')}` : 'unknown';
      
      try {
        console.log(`${progress} Processing: ${video.title.substring(0, 40)}... (${duration})`);
        console.log(`   Channel: ${video.channel_name}`);
        
        // Add delay for rate limiting (except first request)
        if (stats.attempted > 1) {
          await sleep(DELAY_MS);
        }
        
        // Fetch transcript
        const transcriptData = await fetchTranscript(video.id);
        
        if (!transcriptData.content || transcriptData.content.length === 0) {
          stats.noTranscript++;
          console.log(`   ⚠️  No transcript available`);
          continue;
        }

        // Store transcript
        const { wordCount, characterCount } = await storeTranscript(video.id, transcriptData);
        
        stats.successful++;
        stats.totalWords += wordCount;
        stats.totalChars += characterCount;
        
        console.log(`   ✅ Success! ${wordCount} words\n`);
        
      } catch (error) {
        stats.failed++;
        console.log(`   ❌ Error: ${error.message}\n`);
      }
    }

    // Show summary
    console.log('='.repeat(60));
    console.log('📊 SUMMARY:');
    console.log('='.repeat(60));
    console.log(`Attempted:        ${stats.attempted}`);
    console.log(`Successful:       ${stats.successful} (${(stats.successful/stats.attempted*100).toFixed(1)}%)`);
    console.log(`Failed:           ${stats.failed}`);
    console.log(`No Transcript:    ${stats.noTranscript}`);
    console.log(`\nTotal Words:      ${stats.totalWords.toLocaleString()}`);
    console.log(`Avg Words/Video:  ${stats.successful > 0 ? Math.round(stats.totalWords / stats.successful) : 0}`);

    // Check total transcripts
    const { count } = await supabase
      .from('transcripts')
      .select('*', { count: 'exact', head: true });
    
    console.log(`\nTotal transcripts in database: ${count || 0}`);

    // Show remaining credits estimate
    const creditsUsed = stats.successful;
    const remainingCredits = Math.max(0, 100 - count);
    console.log(`\n💰 Credits: ~${remainingCredits} remaining (of 100 total)`);

  } catch (error) {
    console.error('\n❌ Fatal error:', error);
  }
}

// Get limit from command line or default to 10
const requestLimit = parseInt(process.argv[2]) || 10;
downloadTranscriptsSmart(requestLimit);