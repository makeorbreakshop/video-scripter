#!/usr/bin/env node

import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config();

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function analyzeChaptersByDuration() {
  console.log('🔍 Chapter Analysis by Video Duration\n');
  
  // Check different duration buckets
  const durationBuckets = [
    { name: 'Short (<5 min)', minSeconds: 0, maxSeconds: 300 },
    { name: 'Medium (5-15 min)', minSeconds: 300, maxSeconds: 900 },
    { name: 'Long (15-30 min)', minSeconds: 900, maxSeconds: 1800 },
    { name: 'Very Long (30+ min)', minSeconds: 1800, maxSeconds: 99999 }
  ];
  
  for (const bucket of durationBuckets) {
    const { data: videos } = await supabase
      .from('videos')
      .select('id, title, description, duration, channel_name')
      .not('description', 'is', null)
      .gte('duration', bucket.minSeconds)
      .lt('duration', bucket.maxSeconds)
      .limit(1000);
    
    let withChapters = 0;
    const examples = [];
    
    for (const video of videos || []) {
      if (video.description && /^(0:00|00:00)\s+/m.test(video.description)) {
        const timestampMatches = video.description.match(/^\d{1,2}:\d{2}(?::\d{2})?\s+.+$/gm);
        
        if (timestampMatches && timestampMatches.length >= 2) {
          withChapters++;
          
          if (examples.length < 2) {
            examples.push({
              title: video.title.substring(0, 60) + '...',
              duration: Math.round(video.duration / 60) + ' min',
              chapters: timestampMatches.length
            });
          }
        }
      }
    }
    
    const percentage = ((withChapters / videos.length) * 100).toFixed(1);
    console.log(`\n${bucket.name}:`);
    console.log(`- Sample size: ${videos.length}`);
    console.log(`- With chapters: ${withChapters} (${percentage}%)`);
    
    if (examples.length > 0) {
      console.log(`- Examples:`);
      examples.forEach(ex => {
        console.log(`  • ${ex.title} (${ex.duration}, ${ex.chapters} chapters)`);
      });
    }
  }
  
  // Also check specific high-value channels
  console.log('\n\n🎯 High-Value Channels for Chapter Data:\n');
  
  const valuableChannels = [
    'Kurzgesagt – In a Nutshell',
    'Veritasium', 
    'Mark Rober',
    'Epicurious',
    'Bon Appétit',
    'First We Feast',
    'Babish Culinary Universe',
    'TED',
    'Khan Academy'
  ];
  
  for (const channelName of valuableChannels) {
    const { data: videos } = await supabase
      .from('videos')
      .select('id, description')
      .eq('channel_name', channelName)
      .not('description', 'is', null)
      .limit(100);
    
    if (videos && videos.length > 0) {
      let withChapters = 0;
      
      for (const video of videos) {
        if (video.description && /^(0:00|00:00)\s+/m.test(video.description)) {
          const timestampMatches = video.description.match(/^\d{1,2}:\d{2}(?::\d{2})?\s+.+$/gm);
          if (timestampMatches && timestampMatches.length >= 2) {
            withChapters++;
          }
        }
      }
      
      const percentage = ((withChapters / videos.length) * 100).toFixed(1);
      console.log(`${channelName}: ${withChapters}/${videos.length} (${percentage}%)`);
    }
  }
}

analyzeChaptersByDuration().catch(console.error);