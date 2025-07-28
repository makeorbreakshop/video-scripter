#!/usr/bin/env node

import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config();

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function betterChapterDetection() {
  console.log('🔍 Better Chapter Detection\n');
  
  // Test different patterns
  const patterns = [
    {
      name: 'Strict (line start)',
      regex: /^(0:00|00:00)\s+/m,
      check: (desc) => desc.match(/^(0:00|00:00)\s+/m) && desc.match(/^\d{1,2}:\d{2}(?::\d{2})?\s+.+$/gm)?.length >= 2
    },
    {
      name: 'With leading spaces',
      regex: /^\s*(0:00|00:00)\s+/m,
      check: (desc) => desc.match(/^\s*(0:00|00:00)\s+/m) && desc.match(/^\s*\d{1,2}:\d{2}(?::\d{2})?\s+.+$/gm)?.length >= 2
    },
    {
      name: 'Anywhere in line',
      regex: /(0:00|00:00)\s+/,
      check: (desc) => desc.includes('0:00') && desc.match(/\d{1,2}:\d{2}(?::\d{2})?\s+\w+/g)?.length >= 2
    },
    {
      name: 'Common formats',
      regex: /\d{1,2}:\d{2}/,
      check: (desc) => {
        const hasStart = /(0:00|00:00)/.test(desc);
        const timestamps = desc.match(/\d{1,2}:\d{2}(?::\d{2})?/g) || [];
        const hasMultiple = timestamps.length >= 3; // At least 3 timestamps
        return hasStart && hasMultiple;
      }
    }
  ];
  
  // Get sample of videos
  const { data: videos } = await supabase
    .from('videos')
    .select('id, title, description, channel_name')
    .not('description', 'is', null)
    .gte('view_count', 50000)
    .order('view_count', { ascending: false })
    .limit(5000);
  
  console.log(`Testing ${videos?.length || 0} videos with different patterns:\n`);
  
  const results = {};
  patterns.forEach(p => results[p.name] = { count: 0, examples: [] });
  
  for (const video of videos || []) {
    for (const pattern of patterns) {
      if (pattern.check(video.description)) {
        results[pattern.name].count++;
        
        if (results[pattern.name].examples.length < 2) {
          // Extract actual chapter lines
          const chapterLines = video.description.match(/.*\d{1,2}:\d{2}(?::\d{2})?.*$/gm)?.slice(0, 3) || [];
          results[pattern.name].examples.push({
            title: video.title.substring(0, 60),
            channel: video.channel_name,
            chapters: chapterLines
          });
        }
      }
    }
  }
  
  // Show results
  console.log('📊 Results by Detection Method:\n');
  for (const [method, data] of Object.entries(results)) {
    const percentage = ((data.count / videos.length) * 100).toFixed(2);
    console.log(`${method}: ${data.count} videos (${percentage}%)`);
    
    if (data.examples.length > 0) {
      console.log('  Examples:');
      data.examples.forEach(ex => {
        console.log(`  - ${ex.title}...`);
        console.log(`    Channel: ${ex.channel}`);
        console.log(`    Sample chapters:`);
        ex.chapters.forEach(ch => console.log(`      ${ch.trim()}`));
      });
    }
    console.log();
  }
  
  // Estimate total
  const bestMethod = Object.entries(results).sort((a, b) => b[1].count - a[1].count)[0];
  const estimatedTotal = Math.round(176479 * bestMethod[1].count / videos.length);
  
  console.log(`\n✅ Best detection method: ${bestMethod[0]}`);
  console.log(`📈 Estimated total videos with chapters: ${estimatedTotal.toLocaleString()} (${((bestMethod[1].count / videos.length) * 100).toFixed(1)}%)`);
}

betterChapterDetection().catch(console.error);