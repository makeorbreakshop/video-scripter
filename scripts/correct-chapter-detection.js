#!/usr/bin/env node

import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config();

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

function detectYouTubeChapters(description) {
  if (!description) return null;
  
  // Find all timestamps with format: HH:MM:SS or MM:SS or M:SS
  // Must be followed by at least one space and some text
  const timestampRegex = /(?:(\d{1,2}):)?(\d{1,2}):(\d{2})\s+([^\n\d][^\n]*?)(?=\d{1,2}:\d{2}|$)/g;
  
  const chapters = [];
  let match;
  
  while ((match = timestampRegex.exec(description)) !== null) {
    const hours = match[1] ? parseInt(match[1]) : 0;
    const minutes = parseInt(match[2]);
    const seconds = parseInt(match[3]);
    const title = match[4].trim();
    
    // Skip if title is empty or just punctuation
    if (!title || title.length < 2) continue;
    
    const totalSeconds = hours * 3600 + minutes * 60 + seconds;
    
    chapters.push({
      seconds: totalSeconds,
      timestamp: match[0].split(/\s+/)[0],
      title: title
    });
  }
  
  // YouTube requirements:
  // 1. First timestamp must be 0:00
  if (chapters.length === 0 || chapters[0].seconds !== 0) return null;
  
  // 2. At least 3 timestamps
  if (chapters.length < 3) return null;
  
  // 3. Must be in ascending order
  for (let i = 1; i < chapters.length; i++) {
    if (chapters[i].seconds <= chapters[i-1].seconds) return null;
  }
  
  // 4. Each chapter must be at least 10 seconds
  for (let i = 1; i < chapters.length; i++) {
    if (chapters[i].seconds - chapters[i-1].seconds < 10) return null;
  }
  
  return chapters;
}

async function testCorrectDetection() {
  console.log('🎯 Correct YouTube Chapter Detection\n');
  
  // Test some known examples
  const testCases = [
    {
      name: 'Inline chapters',
      desc: 'Check out these parts: 0:00 Intro 2:15 Main Topic 5:30 Conclusion'
    },
    {
      name: 'Traditional format',
      desc: `Chapters:
0:00 Introduction
2:15 Main Topic
5:30 Conclusion`
    },
    {
      name: 'With extra text',
      desc: 'Video timestamps below! 0:00 Start here | 2:15 The good stuff | 5:30 Wrapping up'
    },
    {
      name: 'Invalid - no 0:00',
      desc: '1:00 Start 2:00 Middle 3:00 End'
    },
    {
      name: 'Invalid - only 2 timestamps',
      desc: '0:00 Start 5:00 End'
    }
  ];
  
  console.log('📝 Test Cases:\n');
  testCases.forEach(test => {
    const chapters = detectYouTubeChapters(test.desc);
    console.log(`${test.name}: ${chapters ? `✅ ${chapters.length} chapters` : '❌ No chapters'}`);
    if (chapters) {
      console.log(`  First chapter: "${chapters[0].title}"`);
    }
  });
  
  // Now scan real videos
  console.log('\n\n📊 Scanning 5,000 real videos...\n');
  
  const { data: videos } = await supabase
    .from('videos')
    .select('id, description, channel_name, view_count')
    .not('description', 'is', null)
    .gte('view_count', 10000)
    .order('view_count', { ascending: false })
    .limit(5000);
  
  let withChapters = 0;
  const examples = [];
  const channelStats = {};
  
  for (const video of videos || []) {
    const chapters = detectYouTubeChapters(video.description);
    
    if (chapters) {
      withChapters++;
      
      if (!channelStats[video.channel_name]) {
        channelStats[video.channel_name] = 0;
      }
      channelStats[video.channel_name]++;
      
      if (examples.length < 3) {
        examples.push({
          channel: video.channel_name,
          chapterCount: chapters.length,
          firstThree: chapters.slice(0, 3).map(ch => `${ch.timestamp} ${ch.title}`)
        });
      }
    }
  }
  
  const percentage = (withChapters / videos.length * 100).toFixed(2);
  const estimated = Math.round(176479 * withChapters / videos.length);
  
  console.log(`✅ Results:`);
  console.log(`- Videos with chapters: ${withChapters}/${videos.length} (${percentage}%)`);
  console.log(`- Estimated total: ${estimated.toLocaleString()} videos`);
  
  console.log('\n📝 Examples found:');
  examples.forEach((ex, i) => {
    console.log(`\n${i+1}. ${ex.channel} (${ex.chapterCount} chapters)`);
    ex.firstThree.forEach(ch => console.log(`   ${ch}`));
  });
  
  console.log('\n🏆 Top channels:');
  Object.entries(channelStats)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .forEach(([channel, count]) => {
      console.log(`- ${channel}: ${count} videos`);
    });
}

testCorrectDetection().catch(console.error);