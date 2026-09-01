#!/usr/bin/env node

/**
 * STEP 2: Process the baseline fixes in batches
 * Run this AFTER running fix-temporal-baseline-step1-functions.sql
 * 
 * This script will process all 54,356 videos in small batches to avoid timeouts
 */

import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('❌ Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey);

async function fixTemporalBaselines() {
  console.log('🔧 Starting temporal baseline fix...');
  console.log('📊 This will process 54,356 videos in batches of 100');
  
  let totalProcessed = 0;
  let batchCount = 0;
  let remaining = 54356; // Initial estimate
  
  const startTime = Date.now();
  
  while (remaining > 0) {
    batchCount++;
    
    try {
      // Call the batch fix function
      const { data, error } = await supabase.rpc('fix_temporal_baselines_batch', {
        batch_size: 100
      });
      
      if (error) {
        console.error(`❌ Batch ${batchCount} failed:`, error);
        // Continue anyway, some batches might fail
      } else if (data) {
        const videosProcessed = data.videos_updated || 0;
        remaining = data.remaining || 0;
        totalProcessed += videosProcessed;
        
        const elapsed = (Date.now() - startTime) / 1000;
        const rate = totalProcessed / elapsed;
        const eta = remaining / rate;
        
        console.log(`✅ Batch ${batchCount}: Processed ${videosProcessed} videos | Total: ${totalProcessed} | Remaining: ${remaining} | ETA: ${Math.round(eta)}s`);
        
        if (videosProcessed === 0) {
          console.log('✨ All videos processed!');
          break;
        }
      }
      
      // Small delay to avoid overwhelming the database
      await new Promise(resolve => setTimeout(resolve, 100));
      
    } catch (error) {
      console.error(`❌ Unexpected error in batch ${batchCount}:`, error);
      // Continue processing
    }
  }
  
  const totalTime = (Date.now() - startTime) / 1000;
  console.log(`\n🎉 COMPLETE! Processed ${totalProcessed} videos in ${Math.round(totalTime)} seconds (${batchCount} batches)`);
  
  // Show some statistics
  console.log('\n📊 Verifying the fix...');
  
  const { data: stats, error: statsError } = await supabase
    .from('videos')
    .select('channel_baseline_at_publish')
    .eq('channel_baseline_at_publish', 1.0)
    .eq('is_short', false)
    .gte('import_date', '2025-08-09');
  
  if (!statsError && stats) {
    console.log(`📈 Videos still with baseline 1.0: ${stats.length}`);
    if (stats.length === 0) {
      console.log('✅ All baselines successfully recalculated!');
    } else {
      console.log('⚠️ Some videos still have baseline 1.0 - they may genuinely have no historical data');
    }
  }
}

// Run the fix
fixTemporalBaselines().catch(console.error);