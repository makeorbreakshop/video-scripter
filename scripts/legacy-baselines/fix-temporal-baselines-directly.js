#!/usr/bin/env node

/**
 * Fix temporal baselines by calling the calculate_video_channel_baseline function directly
 * This uses the ALREADY FIXED function that no longer has the 30-day restriction
 */

import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config();

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('❌ Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey);

async function fixBaselines() {
  console.log('🔧 Starting temporal baseline fix...');
  
  // First, get all videos that need fixing
  const { data: videosToFix, error: fetchError } = await supabase
    .from('videos')
    .select('id, channel_id, view_count')
    .eq('channel_baseline_at_publish', 1.0)
    .eq('is_short', false)
    .gte('import_date', '2025-08-09')
    .limit(1000); // Process in chunks
  
  if (fetchError) {
    console.error('❌ Failed to fetch videos:', fetchError);
    return;
  }
  
  console.log(`📊 Found ${videosToFix.length} videos to fix`);
  
  let fixed = 0;
  let failed = 0;
  
  for (const video of videosToFix) {
    try {
      // Call the function to calculate the baseline
      const { data: baseline, error: calcError } = await supabase.rpc(
        'calculate_video_channel_baseline',
        { p_video_id: video.id }
      );
      
      if (calcError) {
        console.error(`❌ Failed to calculate baseline for ${video.id}:`, calcError);
        failed++;
        continue;
      }
      
      // Update the video with the calculated baseline
      const score = baseline > 0 ? (video.view_count / baseline).toFixed(3) : null;
      
      const { error: updateError } = await supabase
        .from('videos')
        .update({
          channel_baseline_at_publish: baseline,
          temporal_performance_score: score
        })
        .eq('id', video.id);
      
      if (updateError) {
        console.error(`❌ Failed to update ${video.id}:`, updateError);
        failed++;
      } else {
        fixed++;
        if (fixed % 100 === 0) {
          console.log(`✅ Fixed ${fixed} videos...`);
        }
      }
      
    } catch (error) {
      console.error(`❌ Error processing ${video.id}:`, error);
      failed++;
    }
  }
  
  console.log(`\n🎉 Complete! Fixed ${fixed} videos, ${failed} failed`);
  
  // Check how many still need fixing
  const { count } = await supabase
    .from('videos')
    .select('*', { count: 'exact', head: true })
    .eq('channel_baseline_at_publish', 1.0)
    .eq('is_short', false)
    .gte('import_date', '2025-08-09');
  
  console.log(`📊 ${count} videos still need fixing`);
  
  if (count > 0) {
    console.log('💡 Run this script again to process more videos');
  }
}

fixBaselines().catch(console.error);