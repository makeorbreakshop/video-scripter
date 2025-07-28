#!/usr/bin/env node

import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config();

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function checkSummaryQuality() {
  // Get latest summaries
  const { data: videos, error } = await supabase
    .from('videos')
    .select('title, channel_name, llm_summary')
    .not('llm_summary', 'is', null)
    .order('llm_summary_generated_at', { ascending: false })
    .limit(10);
  
  if (error) {
    console.error('Error:', error);
    return;
  }
  
  console.log('🎉 LATEST GENERATED SUMMARIES:\n');
  
  videos.forEach((video, i) => {
    console.log(`${i+1}. "${video.title}"`);
    console.log(`   Channel: ${video.channel_name}`);
    console.log(`   Summary: ${video.llm_summary}\n`);
  });
  
  // Quality analysis
  console.log('📊 QUALITY ANALYSIS:');
  
  const issues = [];
  let totalWords = 0;
  
  videos.forEach((video, i) => {
    const summary = video.llm_summary?.toLowerCase() || '';
    totalWords += video.llm_summary?.split(' ').length || 0;
    
    if (summary.includes('video')) issues.push(`Summary ${i+1} contains "video"`);
    if (summary.includes('tutorial')) issues.push(`Summary ${i+1} contains "tutorial"`);
    if (summary.includes('channel')) issues.push(`Summary ${i+1} contains "channel"`);
    if (summary.includes('this ')) issues.push(`Summary ${i+1} starts with "this"`);
  });
  
  console.log(`  Average length: ${Math.round(totalWords / videos.length)} words`);
  console.log(`  Quality issues: ${issues.length}`);
  
  if (issues.length > 0) {
    console.log('\n⚠️  Issues found:');
    issues.forEach(issue => console.log(`  - ${issue}`));
  } else {
    console.log('\n✅ All summaries pass quality checks!');
  }
  
  // Count total summaries
  const { count } = await supabase
    .from('videos')
    .select('*', { count: 'exact', head: true })
    .not('llm_summary', 'is', null);
  
  console.log(`\n📈 Total summaries in database: ${count}`);
}

checkSummaryQuality();