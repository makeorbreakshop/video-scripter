#!/usr/bin/env node

/**
 * Fix temporal baselines using the capped batch function
 * This prevents numeric overflow by capping scores at 99,999.999
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

async function fixTemporalBaselines() {
  console.log('🔧 Starting temporal baseline fix with capping...');
  console.log('📊 This will process ~54,000 videos in batches of 100');
  console.log('⚠️  Scores will be capped at 99,999.999 to prevent overflow');
  
  let totalProcessed = 0;
  let totalFailed = 0;
  let batchCount = 0;
  let remaining = 54356; // Initial estimate
  
  const startTime = Date.now();
  
  while (remaining > 0) {
    batchCount++;
    
    try {
      // Call the capped batch fix function
      const { data, error } = await supabase.rpc('fix_temporal_baselines_batch_capped', {
        batch_size: 100
      });
      
      if (error) {
        console.error(`❌ Batch ${batchCount} failed:`, error);
        break; // Stop on error
      } else if (data) {
        if (!data.success) {
          console.error(`❌ Batch ${batchCount} had overflow issues:`, data.error);
          break;
        }
        
        const videosProcessed = data.videos_updated || 0;
        const failedInBatch = data.failed_count || 0;
        remaining = data.remaining || 0;
        totalProcessed += videosProcessed;
        totalFailed += failedInBatch;
        
        const elapsed = (Date.now() - startTime) / 1000;
        const rate = totalProcessed / elapsed;
        const eta = remaining / rate;
        
        console.log(`✅ Batch ${batchCount}: Processed ${videosProcessed} | Failed: ${failedInBatch} | Total: ${totalProcessed} | Remaining: ${remaining} | ETA: ${Math.round(eta)}s`);
        
        if (videosProcessed === 0 && failedInBatch === 0) {
          console.log('✨ All videos processed!');
          break;
        }
      }
      
      // Small delay to avoid overwhelming the database
      await new Promise(resolve => setTimeout(resolve, 100));
      
    } catch (error) {
      console.error(`❌ Unexpected error in batch ${batchCount}:`, error);
      break;
    }
  }
  
  const totalTime = (Date.now() - startTime) / 1000;
  console.log(`\n🎉 COMPLETE! Processed ${totalProcessed} videos in ${Math.round(totalTime)} seconds (${batchCount} batches)`);
  if (totalFailed > 0) {
    console.log(`⚠️  ${totalFailed} videos couldn't be processed (likely no historical data)`);
  }
  
  // Show some statistics
  console.log('\n📊 Verifying the fix...');
  
  // Check remaining videos with baseline 1.0
  const { count: stillDefault } = await supabase
    .from('videos')
    .select('*', { count: 'exact', head: true })
    .eq('channel_baseline_at_publish', 1.0)
    .eq('is_short', false)
    .gte('import_date', '2025-08-09');
  
  console.log(`📈 Videos still with baseline 1.0: ${stillDefault || 0}`);
  
  // Check for any extremely high scores that might indicate issues
  const { data: highScores, error: highError } = await supabase
    .from('videos')
    .select('id, channel_name, view_count, channel_baseline_at_publish, temporal_performance_score')
    .gte('temporal_performance_score', 90000)
    .order('temporal_performance_score', { ascending: false })
    .limit(5);
  
  if (!highError && highScores && highScores.length > 0) {
    console.log('\n⚠️  Videos with capped scores (99,999.999):');
    highScores.forEach(v => {
      console.log(`  - ${v.channel_name}: Score ${v.temporal_performance_score} (${v.view_count} views / ${v.channel_baseline_at_publish} baseline)`);
    });
  }
  
  if (stillDefault === 0) {
    console.log('✅ All baselines successfully recalculated!');
  } else {
    console.log('ℹ️  Some videos still have baseline 1.0 - they may genuinely have no historical data');
  }
}

// Run the fix
fixTemporalBaselines().catch(console.error);