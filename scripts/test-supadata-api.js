#!/usr/bin/env node

/**
 * Test Supadata API Connection
 * Verifies the API key is working correctly
 */

import fetch from 'node-fetch';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

const SUPADATA_API_KEY = process.env.SUPADATA_API_KEY;
const API_BASE_URL = 'https://api.supadata.ai/v1';

async function testSupadataAPI() {
  console.log('🧪 Testing Supadata API Connection...\n');

  // Check if API key exists
  if (!SUPADATA_API_KEY) {
    console.error('❌ SUPADATA_API_KEY not found in environment variables');
    return;
  }

  console.log('✅ API Key found:', SUPADATA_API_KEY.substring(0, 10) + '...');

  try {
    // Test with a popular YouTube video (MrBeast)
    const testVideoUrl = 'https://www.youtube.com/watch?v=NkE0AMGzpJY';
    console.log(`\n📹 Testing with video: ${testVideoUrl}`);

    // Build query parameters
    const params = new URLSearchParams({
      url: testVideoUrl,
      includeTimestamps: 'true',
      timestampType: 'seconds',
      lang: 'en'
    });

    const response = await fetch(`${API_BASE_URL}/youtube/transcript?${params}`, {
      method: 'GET',
      headers: {
        'x-api-key': SUPADATA_API_KEY
      }
    });

    console.log(`\n📡 Response Status: ${response.status} ${response.statusText}`);

    // Check rate limit headers
    const rateLimitLimit = response.headers.get('x-ratelimit-limit');
    const rateLimitRemaining = response.headers.get('x-ratelimit-remaining');
    const rateLimitReset = response.headers.get('x-ratelimit-reset');

    if (rateLimitLimit) {
      console.log(`\n📊 Rate Limit Info:`);
      console.log(`  - Limit: ${rateLimitLimit}`);
      console.log(`  - Remaining: ${rateLimitRemaining}`);
      console.log(`  - Reset: ${new Date(parseInt(rateLimitReset) * 1000).toLocaleString()}`);
    }

    const data = await response.json();

    if (response.ok) {
      console.log('\n✅ API Connection Successful!');
      
      // Debug: Show the entire response structure
      console.log('\n🔍 Response structure:', Object.keys(data));
      
      // Check different possible response formats
      const transcript = data.content || data.transcript || data.text || '';
      const segments = data.segments || data.timestamps || [];
      
      // If content is an array (with timestamps), extract the text
      let transcriptText = transcript;
      if (Array.isArray(transcript)) {
        transcriptText = transcript.map(item => 
          typeof item === 'string' ? item : (item.text || item.content || '')
        ).join(' ');
        segments.push(...transcript);
      }
      
      console.log('\n📝 Transcript Preview:');
      console.log(`  - Language: ${data.lang || data.language || 'en'}`);
      console.log(`  - Available languages:`, data.availableLangs?.join(', ') || 'Not specified');
      console.log(`  - Full transcript length: ${transcriptText.length} characters`);
      
      // Show first 200 characters of transcript
      if (transcriptText && transcriptText.length > 0) {
        console.log(`  - First 200 chars: "${transcriptText.substring(0, 200)}..."`);
      } else {
        console.log('  - Warning: Transcript appears to be empty');
        console.log('  - Full response:', JSON.stringify(data, null, 2));
      }

      // Show timestamp format if included
      if (segments && segments.length > 0) {
        console.log(`\n⏱️  Timestamp Format:`);
        console.log(`  - Total segments: ${segments.length}`);
        console.log(`  - First segment:`, JSON.stringify(segments[0], null, 2));
      }

      console.log('\n🎉 Your Supadata API is configured correctly!');
      console.log('\n💡 Next steps:');
      console.log('  1. You can now fetch transcripts for your 170K videos');
      console.log('  2. Consider starting with top 100K videos first');
      console.log('  3. Monitor your credit usage in the Supadata dashboard');

    } else {
      console.error('\n❌ API Error:', data.error || data.message || 'Unknown error');
      
      if (response.status === 401) {
        console.error('🔑 Authentication failed. Please check your API key.');
      } else if (response.status === 429) {
        console.error('⏱️  Rate limit exceeded. Try again later.');
      } else if (response.status === 400) {
        console.error('📹 Bad request. The video URL might be invalid.');
      }
    }

  } catch (error) {
    console.error('\n❌ Connection Error:', error.message);
    console.error('🔧 Please check your internet connection and try again.');
  }
}

// Run the test
testSupadataAPI();