#!/usr/bin/env node

import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config();

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

function hasValidYouTubeChapters(description) {
  if (!description || !description.includes('0:00')) return false;
  
  // Extract all timestamps and their titles
  // Match: [optional hours:]minutes:seconds followed by any text until newline or next timestamp
  const lines = description.split('\n');
  const chapters = [];
  
  for (const line of lines) {
    // Match timestamp at start of line (with optional whitespace)
    const match = line.match(/^\s*(?:(\d{1,2}):)?(\d{1,2}):(\d{2})\s+(.+?)$/);
    
    if (match) {
      const hours = match[1] ? parseInt(match[1]) : 0;
      const minutes = parseInt(match[2]);
      const seconds = parseInt(match[3]);
      const title = match[4].trim();
      
      if (title && title.length >= 2) {
        const totalSeconds = hours * 3600 + minutes * 60 + seconds;
        chapters.push({ seconds: totalSeconds, title });
      }
    }
  }
  
  // Check YouTube requirements
  if (chapters.length < 3) return false;
  if (chapters[0].seconds !== 0) return false;
  
  // Check ascending order and 10-second minimum
  for (let i = 1; i < chapters.length; i++) {
    if (chapters[i].seconds <= chapters[i-1].seconds) return false;
    if (chapters[i].seconds - chapters[i-1].seconds < 10) return false;
  }
  
  return chapters;
}

async function finalChapterCount() {
  console.log('📊 Final Chapter Count\n');
  
  let total = 0;
  let withChapters = 0;
  let offset = 0;
  const batchSize = 5000;
  const channelStats = {};
  
  while (offset < 50000) { // Sample 50K videos
    const { data: videos } = await supabase
      .from('videos')
      .select('id, description, channel_name')
      .not('description', 'is', null)
      .range(offset, offset + batchSize - 1);
    
    if (!videos || videos.length === 0) break;
    
    for (const video of videos) {
      total++;
      const chapters = hasValidYouTubeChapters(video.description);
      
      if (chapters) {
        withChapters++;
        channelStats[video.channel_name] = (channelStats[video.channel_name] || 0) + 1;
      }
    }
    
    offset += batchSize;
    console.log(`Scanned ${offset} videos... Found ${withChapters} with chapters`);
  }
  
  const percentage = (withChapters / total * 100).toFixed(2);
  const estimated = Math.round(176479 * withChapters / total);
  
  console.log('\n✅ FINAL RESULTS:');
  console.log(`- Sample size: ${total.toLocaleString()} videos`);
  console.log(`- Videos with valid chapters: ${withChapters} (${percentage}%)`);
  console.log(`- Estimated total with chapters: ${estimated.toLocaleString()}`);
  
  console.log('\n🏆 TOP 20 CHANNELS USING CHAPTERS:');
  Object.entries(channelStats)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 20)
    .forEach(([channel, count], i) => {
      console.log(`${i+1}. ${channel}: ${count} videos`);
    });
}

finalChapterCount().catch(console.error);