#!/usr/bin/env node

import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config();

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// YouTube's actual chapter detection algorithm
function hasYouTubeChapters(description) {
  if (!description) return false;
  
  const lines = description.split('\n');
  let timestamps = [];
  let foundFirstTimestamp = false;
  
  for (const line of lines) {
    // Timestamp must be at start of line (with optional whitespace)
    const match = line.trim().match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?\s+(.+)$/);
    
    if (match) {
      const hours = match[3] ? parseInt(match[1]) : 0;
      const minutes = match[3] ? parseInt(match[2]) : parseInt(match[1]);
      const seconds = match[3] ? parseInt(match[3]) : parseInt(match[2]);
      const totalSeconds = hours * 3600 + minutes * 60 + seconds;
      
      timestamps.push({
        time: totalSeconds,
        text: match[4].trim()
      });
      
      // First timestamp must be 0:00
      if (!foundFirstTimestamp) {
        if (totalSeconds !== 0) return false;
        foundFirstTimestamp = true;
      }
    }
  }
  
  // Need at least 3 timestamps
  if (timestamps.length < 3) return false;
  
  // Each chapter must be at least 10 seconds
  for (let i = 1; i < timestamps.length; i++) {
    if (timestamps[i].time - timestamps[i-1].time < 10) {
      return false;
    }
  }
  
  return timestamps;
}

async function accurateYouTubeChapterCount() {
  console.log('🎯 YouTube-Accurate Chapter Detection\n');
  console.log('Requirements:');
  console.log('- First timestamp must be exactly 0:00');
  console.log('- Timestamps at start of line');
  console.log('- At least 3 timestamps');
  console.log('- Each chapter ≥ 10 seconds\n');
  
  // Test on known channels first
  const testChannels = ['Linus Tech Tips', 'Veritasium', 'MKBHD'];
  
  for (const channel of testChannels) {
    const { data: videos } = await supabase
      .from('videos')
      .select('id, title, description')
      .eq('channel_name', channel)
      .not('description', 'is', null)
      .limit(10);
    
    let withChapters = 0;
    
    for (const video of videos || []) {
      const chapters = hasYouTubeChapters(video.description);
      if (chapters) {
        withChapters++;
        
        if (withChapters === 1) {
          console.log(`\n📺 ${channel} - Example:`);
          console.log(`"${video.title.substring(0, 60)}..."`);
          console.log(`Chapters found: ${chapters.length}`);
          console.log('First 3 chapters:');
          chapters.slice(0, 3).forEach(ch => {
            const time = `${Math.floor(ch.time/60)}:${(ch.time%60).toString().padStart(2,'0')}`;
            console.log(`  ${time} - ${ch.text}`);
          });
        }
      }
    }
    
    console.log(`${channel}: ${withChapters}/10 recent videos have chapters`);
  }
  
  // Now do a broader scan
  console.log('\n\n📊 Scanning 10,000 random videos...\n');
  
  const { data: randomVideos } = await supabase
    .from('videos')
    .select('id, description, channel_name')
    .not('description', 'is', null)
    .limit(10000);
  
  let totalWithChapters = 0;
  const channelCounts = {};
  
  for (const video of randomVideos || []) {
    const chapters = hasYouTubeChapters(video.description);
    if (chapters) {
      totalWithChapters++;
      channelCounts[video.channel_name] = (channelCounts[video.channel_name] || 0) + 1;
    }
  }
  
  const percentage = (totalWithChapters / randomVideos.length * 100).toFixed(2);
  
  console.log(`✅ Results:`);
  console.log(`- Videos with proper YouTube chapters: ${totalWithChapters}/${randomVideos.length} (${percentage}%)`);
  console.log(`- Estimated total in database: ${Math.round(176479 * totalWithChapters / randomVideos.length).toLocaleString()}`);
  
  // Top channels
  const topChannels = Object.entries(channelCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10);
    
  console.log('\n🏆 Top channels using chapters:');
  topChannels.forEach(([channel, count]) => {
    console.log(`- ${channel}: ${count} videos`);
  });
}

accurateYouTubeChapterCount().catch(console.error);