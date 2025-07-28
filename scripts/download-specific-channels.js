#!/usr/bin/env node

/**
 * Download transcripts for specific channels: wittworks and I Like To Make Stuff
 */

import { createClient } from '@supabase/supabase-js';
import fetch from 'node-fetch';
import dotenv from 'dotenv';
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
const DELAY_MS = 6000; // Rate limit: 10/min

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

async function downloadChannelTranscripts(limit = 10) {
  console.log('🔨 Downloading Transcripts for wittworks & I Like To Make Stuff\n');

  try {
    // First, check what channel names we have for I Like To Make Stuff
    console.log('🔍 Checking channel names...');
    const { data: channels } = await supabase
      .from('videos')
      .select('channel_name')
      .or('channel_name.ilike.%i like to make stuff%,channel_name.ilike.%iltms%,channel_name.ilike.%iliketomakestuff%')
      .limit(5);

    const uniqueChannels = [...new Set(channels?.map(c => c.channel_name) || [])];
    console.log('Found "I Like To Make Stuff" as:', uniqueChannels.length > 0 ? uniqueChannels : 'Not found');

    // Get videos from both channels
    console.log('\n🔍 Finding videos without transcripts...');
    
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
      .or(`channel_name.eq.wittworks,channel_name.ilike.%i like to make stuff%`)
      .order('view_count', { ascending: false })
      .limit(limit * 2);

    if (fetchError) throw fetchError;

    // Filter out shorts
    console.log(`\n🎯 Filtering for regular videos...`);
    const regularVideos = [];
    let skipped = 0;

    for (const video of videos || []) {
      const type = getVideoType(video);
      if (type !== 'regular') {
        skipped++;
      } else {
        regularVideos.push(video);
        if (regularVideos.length >= limit) break;
      }
    }

    console.log(`✅ Found ${regularVideos.length} videos`);
    if (skipped > 0) console.log(`⏭️  Skipped ${skipped} shorts/music videos`);

    if (regularVideos.length === 0) {
      console.log('\n❌ No videos found without transcripts from these channels!');
      
      // Show what videos exist from these channels
      const { data: allVideos } = await supabase
        .from('videos')
        .select('title, channel_name')
        .or(`channel_name.eq.wittworks,channel_name.ilike.%i like to make stuff%`)
        .limit(10);
      
      console.log('\nSample videos from these channels:');
      allVideos?.forEach(v => console.log(`- [${v.channel_name}] ${v.title}`));
      
      return;
    }

    // Show what we're about to download
    console.log('\n📋 Videos to process:');
    regularVideos.forEach((v, i) => {
      const seconds = parseDurationToSeconds(v.duration);
      const duration = seconds ? `${Math.floor(seconds/60)}m ${seconds%60}s` : '?';
      console.log(`${i+1}. [${v.channel_name}] ${v.title.substring(0, 40)}... (${duration})`);
    });
    console.log('');

    // Track statistics
    const stats = {
      attempted: 0,
      successful: 0,
      failed: 0,
      totalWords: 0
    };

    // Process videos
    for (const video of regularVideos) {
      stats.attempted++;
      const progress = `[${stats.attempted}/${regularVideos.length}]`;
      
      try {
        console.log(`${progress} Processing: ${video.title.substring(0, 50)}...`);
        console.log(`   Channel: ${video.channel_name}`);
        
        // Rate limiting
        if (stats.attempted > 1) {
          console.log('   ⏳ Waiting 6s (rate limit)...');
          await sleep(DELAY_MS);
        }
        
        // Fetch transcript
        const transcriptData = await fetchTranscript(video.id);
        
        if (!transcriptData.content || transcriptData.content.length === 0) {
          console.log(`   ⚠️  No transcript available`);
          continue;
        }

        // Store transcript
        const { wordCount } = await storeTranscript(video.id, transcriptData);
        
        stats.successful++;
        stats.totalWords += wordCount;
        
        console.log(`   ✅ Success! ${wordCount} words\n`);
        
      } catch (error) {
        stats.failed++;
        console.log(`   ❌ Error: ${error.message}\n`);
      }
    }

    // Summary
    console.log('='.repeat(60));
    console.log('📊 SUMMARY:');
    console.log('='.repeat(60));
    console.log(`Attempted:        ${stats.attempted}`);
    console.log(`Successful:       ${stats.successful}`);
    console.log(`Failed:           ${stats.failed}`);
    console.log(`Total Words:      ${stats.totalWords.toLocaleString()}`);
    console.log(`Avg Words/Video:  ${stats.successful > 0 ? Math.round(stats.totalWords / stats.successful) : 0}`);

    // Check remaining credits
    const { count } = await supabase
      .from('transcripts')
      .select('*', { count: 'exact', head: true });
    
    const remainingCredits = Math.max(0, 100 - count);
    console.log(`\n💰 Credits: ~${remainingCredits} remaining (of 100 total)`);

  } catch (error) {
    console.error('\n❌ Fatal error:', error);
  }
}

// Get limit from command line or default to 10
const requestLimit = parseInt(process.argv[2]) || 10;
downloadChannelTranscripts(requestLimit);