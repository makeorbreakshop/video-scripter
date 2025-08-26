#!/usr/bin/env node

/**
 * Test envelope performance calculation on a few videos
 * to verify the system is working correctly
 */

import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';

dotenv.config();

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function testEnvelopeCalculation() {
  console.log('🧪 Testing envelope performance calculation on sample videos...\n');
  
  try {
    // Get a few test videos with different ages and view counts
    const { data: testVideos, error } = await supabase
      .from('videos')
      .select('id, title, view_count, published_at, channel_name, envelope_performance_ratio')
      .not('published_at', 'is', null)
      .not('view_count', 'is', null)
      .order('published_at', { ascending: false })
      .limit(5);
    
    if (error) {
      console.error('Error fetching test videos:', error);
      return;
    }
    
    console.log(`Found ${testVideos.length} test videos\n`);
    console.log('BEFORE UPDATE:');
    console.log('─'.repeat(80));
    
    for (const video of testVideos) {
      const age = Math.floor((Date.now() - new Date(video.published_at).getTime()) / (1000 * 60 * 60 * 24));
      console.log(`Video: ${video.title.substring(0, 50)}...`);
      console.log(`  ID: ${video.id}`);
      console.log(`  Channel: ${video.channel_name}`);
      console.log(`  Age: ${age} days`);
      console.log(`  Views: ${video.view_count.toLocaleString()}`);
      console.log(`  Current Ratio: ${video.envelope_performance_ratio?.toFixed(2) || 'null'}`);
      console.log();
    }
    
    console.log('─'.repeat(80));
    console.log('\n🔄 Calling classify-video API for each video...\n');
    
    // Call the API for each video
    for (const video of testVideos) {
      console.log(`Processing: ${video.title.substring(0, 50)}...`);
      
      const response = await fetch(`http://localhost:3000/api/performance/classify-video?video_id=${video.id}`);
      
      if (!response.ok) {
        console.error(`  ❌ API error: ${response.status} ${response.statusText}`);
        continue;
      }
      
      const result = await response.json();
      console.log(`  ✅ Updated!`);
      console.log(`     Expected Views: ${result.expected_views?.toLocaleString()}`);
      console.log(`     Performance Ratio: ${result.performance_ratio?.toFixed(2)}x`);
      console.log(`     Category: ${result.performance_category} (${result.description})`);
      console.log();
    }
    
    // Fetch the videos again to see the updated values
    console.log('─'.repeat(80));
    console.log('\nAFTER UPDATE:');
    console.log('─'.repeat(80));
    
    const { data: updatedVideos } = await supabase
      .from('videos')
      .select('id, title, view_count, envelope_performance_ratio, envelope_performance_category')
      .in('id', testVideos.map(v => v.id));
    
    for (const video of updatedVideos) {
      const original = testVideos.find(v => v.id === video.id);
      console.log(`Video: ${video.title.substring(0, 50)}...`);
      console.log(`  Views: ${video.view_count.toLocaleString()}`);
      console.log(`  Old Ratio: ${original.envelope_performance_ratio?.toFixed(2) || 'null'}`);
      console.log(`  New Ratio: ${video.envelope_performance_ratio?.toFixed(2) || 'null'}`);
      console.log(`  Category: ${video.envelope_performance_category}`);
      
      if (original.envelope_performance_ratio && video.envelope_performance_ratio) {
        const change = ((video.envelope_performance_ratio / original.envelope_performance_ratio - 1) * 100);
        console.log(`  Change: ${change > 0 ? '+' : ''}${change.toFixed(1)}%`);
      }
      console.log();
    }
    
    console.log('✅ Test complete! If the ratios look reasonable, you can run:');
    console.log('   node scripts/bulk-envelope-performance-calculation.js');
    console.log('   to update all videos.');
    
  } catch (error) {
    console.error('Error during test:', error);
  }
}

// Run the test
testEnvelopeCalculation();