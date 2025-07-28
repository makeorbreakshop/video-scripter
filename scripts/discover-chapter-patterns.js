#!/usr/bin/env node

import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config();

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function discoverChapterPatterns() {
  console.log('🔍 Discovering Chapter Patterns in Video Descriptions\n');
  
  // Get a diverse sample - different view counts, durations, channels
  const samples = [
    { name: 'Super popular (1M+ views)', filter: { gte: ['view_count', 1000000] }, limit: 500 },
    { name: 'Long videos (20+ min)', filter: { gte: ['duration', 1200] }, limit: 500 },
    { name: 'Tutorial titles', filter: { ilike: ['title', '%how to%'] }, limit: 500 },
    { name: 'Gaming videos', filter: { ilike: ['title', '%gameplay%'] }, limit: 500 },
    { name: 'Recent uploads', filter: { gte: ['published_at', '2024-01-01'] }, limit: 500 }
  ];
  
  const allPatterns = {
    '0:00 start': 0,
    '00:00 start': 0,
    'Any 0:00': 0,
    'Timestamps (no 0:00)': 0,
    'Chapters: header': 0,
    'Timestamps: header': 0,
    'Timeline: header': 0,
    'In this video: header': 0,
    'Multiple timestamps': 0,
    'Single timestamp': 0,
    'Parentheses format': 0,
    'Dash format': 0,
    'Pipe format': 0
  };
  
  const interestingExamples = [];
  
  for (const sample of samples) {
    console.log(`\nAnalyzing ${sample.name}...`);
    
    // Build query
    let query = supabase
      .from('videos')
      .select('id, title, description, channel_name, duration')
      .not('description', 'is', null)
      .limit(sample.limit);
    
    // Apply filter
    const [method, [field, value]] = Object.entries(sample.filter)[0];
    query = query[method](field, value);
    
    const { data: videos } = await query;
    
    if (!videos) continue;
    
    const samplePatterns = { ...allPatterns };
    
    for (const video of videos) {
      const desc = video.description;
      
      // Check various patterns
      if (desc.match(/^0:00\s/m)) samplePatterns['0:00 start']++;
      if (desc.match(/^00:00\s/m)) samplePatterns['00:00 start']++;
      if (desc.includes('0:00') || desc.includes('00:00')) samplePatterns['Any 0:00']++;
      
      // Count all timestamps
      const allTimestamps = desc.match(/\d{1,2}:\d{2}(?::\d{2})?/g) || [];
      
      if (allTimestamps.length > 0) {
        if (!desc.includes('0:00') && !desc.includes('00:00')) {
          samplePatterns['Timestamps (no 0:00)']++;
          
          // Interesting case - timestamps but no 0:00
          if (interestingExamples.length < 5 && allTimestamps.length >= 3) {
            const firstTimestamp = allTimestamps[0];
            const context = desc.substring(
              Math.max(0, desc.indexOf(firstTimestamp) - 50),
              desc.indexOf(firstTimestamp) + 200
            );
            
            interestingExamples.push({
              title: video.title.substring(0, 60),
              channel: video.channel_name,
              firstTimestamp,
              timestampCount: allTimestamps.length,
              context: context.replace(/\n/g, '\\n')
            });
          }
        }
        
        if (allTimestamps.length >= 3) samplePatterns['Multiple timestamps']++;
        else if (allTimestamps.length === 1) samplePatterns['Single timestamp']++;
      }
      
      // Check for header patterns
      if (desc.match(/chapters?:/i)) samplePatterns['Chapters: header']++;
      if (desc.match(/timestamps?:/i)) samplePatterns['Timestamps: header']++;
      if (desc.match(/timeline:/i)) samplePatterns['Timeline: header']++;
      if (desc.match(/in this video:/i)) samplePatterns['In this video: header']++;
      
      // Check timestamp formats
      if (desc.match(/\(\d{1,2}:\d{2}\)/)) samplePatterns['Parentheses format']++;
      if (desc.match(/\s-\s*\d{1,2}:\d{2}/)) samplePatterns['Dash format']++;
      if (desc.match(/\s\|\s*\d{1,2}:\d{2}/)) samplePatterns['Pipe format']++;
    }
    
    // Show results for this sample
    console.log(`Sample size: ${videos.length}`);
    const topPatterns = Object.entries(samplePatterns)
      .filter(([_, count]) => count > 0)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5);
    
    topPatterns.forEach(([pattern, count]) => {
      const pct = ((count / videos.length) * 100).toFixed(1);
      console.log(`  ${pattern}: ${count} (${pct}%)`);
    });
  }
  
  console.log('\n\n🎯 INTERESTING CASES (timestamps but no 0:00):');
  interestingExamples.forEach((ex, i) => {
    console.log(`\n${i+1}. "${ex.title}..."`);
    console.log(`   Channel: ${ex.channel}`);
    console.log(`   First timestamp: ${ex.firstTimestamp} (${ex.timestampCount} total)`);
    console.log(`   Context: ${ex.context}`);
  });
  
  // Find videos with lots of timestamps
  console.log('\n\n📊 Looking for timestamp-heavy videos...');
  
  const { data: timestampHeavy } = await supabase
    .from('videos')
    .select('id, title, description, channel_name')
    .not('description', 'is', null)
    .limit(2000);
  
  const heavyExamples = [];
  
  for (const video of timestampHeavy || []) {
    const timestamps = video.description.match(/\d{1,2}:\d{2}(?::\d{2})?/g) || [];
    if (timestamps.length >= 10) {
      heavyExamples.push({
        title: video.title,
        channel: video.channel_name,
        count: timestamps.length,
        samples: timestamps.slice(0, 5)
      });
    }
  }
  
  heavyExamples.sort((a, b) => b.count - a.count);
  
  console.log('\nVideos with 10+ timestamps:');
  heavyExamples.slice(0, 10).forEach(ex => {
    console.log(`\n- "${ex.title.substring(0, 60)}..."`);
    console.log(`  ${ex.count} timestamps: ${ex.samples.join(', ')}...`);
  });
}

discoverChapterPatterns().catch(console.error);