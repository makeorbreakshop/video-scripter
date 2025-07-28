#!/usr/bin/env node

import fetch from 'node-fetch';
import fs from 'fs/promises';
import dotenv from 'dotenv';

dotenv.config();

const SUPADATA_API_KEY = process.env.SUPADATA_API_KEY;
const API_BASE_URL = 'https://api.supadata.ai/v1';

async function fetchTranscript() {
  // Using MrBeast's "Last To Leave Circle Wins $500,000" - one of your top videos
  const videoUrl = 'https://www.youtube.com/watch?v=zxYjTTXc-J8';
  const videoId = 'zxYjTTXc-J8';
  
  console.log(`📹 Fetching transcript for: ${videoUrl}`);
  
  const params = new URLSearchParams({
    url: videoUrl,
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

  if (!response.ok) {
    throw new Error(`API Error: ${response.status} ${response.statusText}`);
  }

  const data = await response.json();
  
  // Save the full response
  const outputPath = `/Users/brandoncullum/video-scripter/outputs/transcript_${videoId}.json`;
  await fs.writeFile(outputPath, JSON.stringify(data, null, 2));
  
  console.log(`✅ Transcript saved to: ${outputPath}`);
  console.log(`📊 Stats:`);
  console.log(`  - Language: ${data.lang}`);
  console.log(`  - Segments: ${data.content.length}`);
  console.log(`  - Total characters: ${data.content.reduce((sum, seg) => sum + seg.text.length, 0)}`);
  
  // Also save as plain text
  const plainText = data.content.map(seg => seg.text).join('\n');
  const textPath = `/Users/brandoncullum/video-scripter/outputs/transcript_${videoId}.txt`;
  await fs.writeFile(textPath, plainText);
  console.log(`📄 Plain text saved to: ${textPath}`);
}

fetchTranscript().catch(console.error);