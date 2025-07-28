#!/usr/bin/env node

/**
 * Test if we're REALLY calling Supadata API
 * This will make a fresh call for a video we DON'T have
 */

import fetch from 'node-fetch';
import dotenv from 'dotenv';

dotenv.config();

const SUPADATA_API_KEY = process.env.SUPADATA_API_KEY;
const API_BASE_URL = 'https://api.supadata.ai/v1';

async function testRealSupadataCall() {
  console.log('🧪 Testing REAL Supadata API Call\n');
  
  // Use a video we definitely don't have yet
  const testVideoId = 'kJQP7kiw5Fk'; // Luis Fonsi - Despacito
  const videoUrl = `https://www.youtube.com/watch?v=${testVideoId}`;
  
  console.log(`Video URL: ${videoUrl}`);
  console.log(`API Key: ${SUPADATA_API_KEY ? SUPADATA_API_KEY.substring(0, 10) + '...' : 'NOT SET'}`);
  console.log(`API URL: ${API_BASE_URL}/youtube/transcript`);
  
  const params = new URLSearchParams({
    url: videoUrl,
    includeTimestamps: 'true',
    lang: 'en'
  });

  console.log(`\n🚀 Making API call...`);
  console.log(`Full URL: ${API_BASE_URL}/youtube/transcript?${params}`);
  
  try {
    const response = await fetch(`${API_BASE_URL}/youtube/transcript?${params}`, {
      method: 'GET',
      headers: {
        'x-api-key': SUPADATA_API_KEY
      }
    });

    console.log(`\n📡 Response Status: ${response.status} ${response.statusText}`);
    console.log(`Headers:`, Object.fromEntries(response.headers.entries()));

    if (!response.ok) {
      const error = await response.text();
      console.error(`\n❌ API Error: ${error}`);
      return;
    }

    const data = await response.json();
    
    console.log(`\n✅ Success! Got transcript data:`);
    console.log(`- Language: ${data.lang}`);
    console.log(`- Segments: ${data.content?.length || 0}`);
    console.log(`- Available languages: ${data.availableLangs?.join(', ') || 'none'}`);
    
    if (data.content && data.content.length > 0) {
      const wordCount = data.content.map(s => s.text).join(' ').split(/\s+/).length;
      console.log(`- Total words: ${wordCount}`);
      console.log(`\nFirst segment: "${data.content[0].text}"`);
    }
    
    console.log(`\n💡 This call should increment your Supadata usage by 1!`);
    console.log(`Check https://dash.supadata.ai to verify.`);
    
  } catch (error) {
    console.error(`\n❌ Fatal error:`, error);
  }
}

testRealSupadataCall();