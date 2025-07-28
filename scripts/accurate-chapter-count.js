#!/usr/bin/env node

import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config();

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function accurateChapterCount() {
  console.log('📊 Accurate Chapter Count (Full Database Scan)\n');
  
  let totalVideos = 0;
  let videosWithChapters = 0;
  let videosWithTimestamps = 0;
  let offset = 0;
  const batchSize = 5000;
  
  const channelStats = {};
  
  while (true) {
    const { data: videos, error } = await supabase
      .from('videos')
      .select('id, description, channel_name')
      .range(offset, offset + batchSize - 1);
    
    if (error || !videos || videos.length === 0) break;
    
    for (const video of videos) {
      totalVideos++;
      
      if (video.description) {
        // Check for any timestamps
        const timestamps = video.description.match(/\b\d{1,2}:\d{2}(?::\d{2})?\b/g) || [];
        
        if (timestamps.length >= 2) {
          videosWithTimestamps++;
          
          // Check if it's proper chapters (has 0:00 or 00:00)
          if (/\b0:00\b/.test(video.description) || /\b00:00\b/.test(video.description)) {
            videosWithChapters++;
            
            // Track by channel
            channelStats[video.channel_name] = (channelStats[video.channel_name] || 0) + 1;
          }
        }
      }
    }
    
    offset += batchSize;
    console.log(`Scanned ${offset} videos... Found ${videosWithChapters} with chapters`);
  }
  
  // Get top channels
  const topChannels = Object.entries(channelStats)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 20);
  
  console.log('\n📊 FINAL RESULTS:');
  console.log('=================');
  console.log(`Total videos: ${totalVideos.toLocaleString()}`);
  console.log(`Videos with 2+ timestamps: ${videosWithTimestamps.toLocaleString()} (${((videosWithTimestamps/totalVideos)*100).toFixed(2)}%)`);
  console.log(`Videos with proper chapters (0:00 start): ${videosWithChapters.toLocaleString()} (${((videosWithChapters/totalVideos)*100).toFixed(2)}%)`);
  
  console.log('\n🏆 TOP 20 CHANNELS USING CHAPTERS:');
  topChannels.forEach(([channel, count], i) => {
    console.log(`${i+1}. ${channel}: ${count} videos`);
  });
  
  console.log('\n💡 This is valuable structured data for categorization!');
}

accurateChapterCount().catch(console.error);