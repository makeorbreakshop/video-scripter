#!/usr/bin/env node

import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';

dotenv.config();

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function testSingleVideoUpdate() {
  // The video from your screenshot
  const videoId = 'rwlvVTzbbbw'; // "8 Rules for Sausages" by J. Kenji López-Alt
  
  console.log('=' + '='.repeat(60));
  console.log('TESTING SINGLE VIDEO SCORE UPDATE');
  console.log('=' + '='.repeat(60));
  
  // First, fetch current values from database
  console.log('\n📊 Fetching current values from database...');
  const { data: currentVideo, error: fetchError } = await supabase
    .from('videos')
    .select('title, channel_name, envelope_performance_ratio, envelope_performance_category, view_count, published_at')
    .eq('id', videoId)
    .single();
  
  if (fetchError || !currentVideo) {
    console.error('Error fetching video:', fetchError);
    return;
  }
  
  console.log('\n📌 Current Video:');
  console.log(`  Title: ${currentVideo.title}`);
  console.log(`  Channel: ${currentVideo.channel_name}`);
  console.log(`  Current Score: ${currentVideo.envelope_performance_ratio?.toFixed(2)}x`);
  console.log(`  Current Category: ${currentVideo.envelope_performance_category}`);
  console.log(`  View Count: ${currentVideo.view_count?.toLocaleString()}`);
  
  // Calculate days since published
  const daysSincePublished = Math.floor(
    (Date.now() - new Date(currentVideo.published_at).getTime()) / (1000 * 60 * 60 * 24)
  );
  console.log(`  Days Since Published: ${daysSincePublished}`);
  
  // Now call the classify-video API to recalculate with smoothed envelopes
  console.log('\n🔄 Calling classify-video API to recalculate...');
  
  try {
    const response = await fetch('http://localhost:3000/api/performance/classify-video?video_id=' + videoId, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json'
      }
    });
    
    if (!response.ok) {
      console.error('API request failed:', response.status);
      const text = await response.text();
      console.error('Response:', text);
      return;
    }
    
    const result = await response.json();
    
    console.log('\n✨ NEW Calculated Values (with smoothed envelopes):');
    console.log(`  Expected Views: ${result.expected_views?.toLocaleString()}`);
    console.log(`  Actual Views: ${result.actual_views?.toLocaleString()}`);
    console.log(`  Performance Ratio: ${result.performance_ratio?.toFixed(3)}x`);
    console.log(`  Performance Category: ${result.performance_category}`);
    console.log(`  Description: ${result.description}`);
    
    // Show the change
    if (currentVideo.envelope_performance_ratio && result.performance_ratio) {
      const change = ((result.performance_ratio - currentVideo.envelope_performance_ratio) / currentVideo.envelope_performance_ratio) * 100;
      console.log(`\n📈 Change: ${currentVideo.envelope_performance_ratio.toFixed(3)}x → ${result.performance_ratio.toFixed(3)}x (${change > 0 ? '+' : ''}${change.toFixed(1)}%)`);
    }
    
    // Now update the database with the new values
    console.log('\n💾 Updating database with new values...');
    const { error: updateError } = await supabase
      .from('videos')
      .update({
        envelope_performance_ratio: result.performance_ratio,
        envelope_performance_category: result.performance_category
      })
      .eq('id', videoId);
    
    if (updateError) {
      console.error('Error updating database:', updateError);
      return;
    }
    
    console.log('✅ Database updated successfully!');
    
    console.log('\n' + '='.repeat(60));
    console.log('RESULTS SUMMARY:');
    console.log(`  Video: ${currentVideo.title}`);
    console.log(`  Old Score: ${currentVideo.envelope_performance_ratio?.toFixed(2)}x (${currentVideo.envelope_performance_category})`);
    console.log(`  New Score: ${result.performance_ratio?.toFixed(2)}x (${result.performance_category})`);
    console.log('\n🎯 Now refresh the video page to see the updated score!');
    console.log('='.repeat(60));
    
  } catch (error) {
    console.error('Error calling API:', error);
  }
}

// Run the test
testSingleVideoUpdate().catch(console.error);