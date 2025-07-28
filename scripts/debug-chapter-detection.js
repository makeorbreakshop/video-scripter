#!/usr/bin/env node

import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config();

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function debugChapterDetection() {
  console.log('🔍 Debug Chapter Detection\n');
  
  // Get videos from channels known to use chapters
  const channelsWithChapters = [
    'Linus Tech Tips',
    'MKBHD', 
    'Marques Brownlee',
    'Veritasium',
    'Kurzgesagt – In a Nutshell',
    'Mark Rober',
    'Peter McKinnon',
    'Unbox Therapy',
    'The Slow Mo Guys'
  ];
  
  for (const channel of channelsWithChapters) {
    const { data: videos } = await supabase
      .from('videos')
      .select('id, title, description, duration')
      .eq('channel_name', channel)
      .gte('duration', 300) // 5+ minutes
      .order('published_at', { ascending: false })
      .limit(5);
    
    if (!videos || videos.length === 0) continue;
    
    console.log(`\n📺 ${channel}:`);
    
    for (const video of videos) {
      const desc = video.description || '';
      
      // Look for any timestamp patterns
      const allTimestamps = desc.match(/\b\d{1,2}:\d{2}(?::\d{2})?\b/g) || [];
      
      if (allTimestamps.length > 0) {
        console.log(`\n  "${video.title.substring(0, 60)}..."`);
        console.log(`  Duration: ${Math.round(video.duration / 60)} minutes`);
        console.log(`  Timestamps found: ${allTimestamps.length}`);
        
        // Check different chapter formats
        const hasZeroStart = /\b0:00\b/.test(desc) || /\b00:00\b/.test(desc);
        console.log(`  Has 0:00 timestamp: ${hasZeroStart}`);
        
        // Show first few timestamps with context
        console.log(`  First timestamps:`);
        for (let i = 0; i < Math.min(3, allTimestamps.length); i++) {
          const timestamp = allTimestamps[i];
          const index = desc.indexOf(timestamp);
          const lineStart = desc.lastIndexOf('\n', index) + 1;
          const lineEnd = desc.indexOf('\n', index);
          const line = desc.substring(lineStart, lineEnd > -1 ? lineEnd : index + 50);
          console.log(`    ${line.trim()}`);
        }
      }
    }
  }
  
  // Also check videos with "Chapters:" in description
  console.log('\n\n🔍 Checking videos with "Chapters:" in description...\n');
  
  const { data: chaptersVideos } = await supabase
    .from('videos')
    .select('id, title, description, channel_name')
    .ilike('description', '%chapters:%')
    .limit(10);
  
  console.log(`Found ${chaptersVideos?.length || 0} videos with "Chapters:" in description\n`);
  
  for (const video of chaptersVideos || []) {
    console.log(`\n"${video.title.substring(0, 60)}..."`);
    console.log(`Channel: ${video.channel_name}`);
    
    // Extract the chapters section
    const chaptersIndex = video.description.toLowerCase().indexOf('chapters:');
    const chaptersSection = video.description.substring(chaptersIndex, chaptersIndex + 500);
    const lines = chaptersSection.split('\n').slice(0, 6);
    
    console.log('Chapters section:');
    lines.forEach(line => {
      if (line.trim()) console.log(`  ${line.trim()}`);
    });
  }
}

debugChapterDetection().catch(console.error);