#!/usr/bin/env node

/**
 * Bulk Envelope Performance Score Calculation Script
 * 
 * This script populates the envelope_performance_ratio and envelope_performance_category
 * columns for all videos in the database using the existing performance envelope system.
 * 
 * The script processes videos in batches to avoid API timeouts and provides progress tracking.
 */

import { createClient } from '@supabase/supabase-js';
import fetch from 'node-fetch';

// Environment setup
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error('❌ Missing required environment variables:');
  console.error('   NEXT_PUBLIC_SUPABASE_URL');
  console.error('   SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

// Configuration
const BATCH_SIZE = 250; // Process 250 videos at a time
const DELAY_BETWEEN_BATCHES = 500; // 500ms delay between batches
const API_BASE_URL = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';

// Progress tracking
let totalVideos = 0;
let processedVideos = 0;
let successfulUpdates = 0;
let errors = 0;
let startTime = Date.now();

/**
 * Get all videos that need envelope performance calculation
 */
async function getVideosNeedingCalculation() {
  console.log('📊 Fetching videos that need envelope performance calculation...');
  
  const { data: videos, error } = await supabase
    .from('videos')
    .select('id, title, view_count, published_at, channel_id')
    .is('envelope_performance_ratio', null)
    .not('view_count', 'is', null)
    .not('published_at', 'is', null)
    .order('published_at', { ascending: false });

  if (error) {
    console.error('❌ Error fetching videos:', error);
    throw error;
  }

  console.log(`📈 Found ${videos.length} videos needing envelope performance calculation`);
  return videos;
}

/**
 * Process a batch of videos using the performance classification API
 */
async function processBatch(videos, batchNumber, totalBatches) {
  const videoIds = videos.map(v => v.id);
  
  console.log(`\n📦 Processing batch ${batchNumber}/${totalBatches} (${videos.length} videos)...`);
  
  try {
    const response = await fetch(`${API_BASE_URL}/api/performance/classify-video`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        video_ids: videoIds,
        update_database: true // This tells the API to update the database
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`API Error ${response.status}: ${errorText}`);
    }

    const result = await response.json();
    
    if (result.classifications) {
      successfulUpdates += result.classifications.length;
      
      // Log sample results from this batch
      const sample = result.classifications.slice(0, 3);
      console.log(`   ✅ Processed ${result.classifications.length} videos`);
      console.log('   📊 Sample results:');
      sample.forEach(video => {
        console.log(`      "${video.title.substring(0, 40)}..." → ${video.performance_ratio.toFixed(2)}x (${video.performance_category})`);
      });
      
      // Log category summary for this batch
      if (result.categories_summary) {
        const summary = result.categories_summary;
        console.log(`   📈 Categories: Viral: ${summary.viral}, Outperforming: ${summary.outperforming}, On Track: ${summary.on_track}, Underperforming: ${summary.underperforming}, Poor: ${summary.poor}`);
      }
    }

    return result;
    
  } catch (error) {
    console.error(`   ❌ Error processing batch ${batchNumber}:`, error.message);
    errors++;
    return null;
  }
}

/**
 * Display progress statistics
 */
function displayProgress() {
  const elapsed = Date.now() - startTime;
  const rate = processedVideos / (elapsed / 1000);
  const remaining = totalVideos - processedVideos;
  const eta = remaining / rate;
  
  console.log(`\n📊 PROGRESS UPDATE:`);
  console.log(`   Total Videos: ${totalVideos.toLocaleString()}`);
  console.log(`   Processed: ${processedVideos.toLocaleString()} (${((processedVideos / totalVideos) * 100).toFixed(1)}%)`);
  console.log(`   Successful Updates: ${successfulUpdates.toLocaleString()}`);
  console.log(`   Errors: ${errors}`);
  console.log(`   Processing Rate: ${rate.toFixed(1)} videos/second`);
  console.log(`   Elapsed Time: ${Math.floor(elapsed / 1000)}s`);
  console.log(`   ETA: ${Math.floor(eta / 60)}m ${Math.floor(eta % 60)}s`);
}

/**
 * Main execution function
 */
async function main() {
  console.log('🚀 Starting Bulk Envelope Performance Calculation');
  console.log(`⚙️  Configuration:`);
  console.log(`   Batch Size: ${BATCH_SIZE} videos`);
  console.log(`   Delay Between Batches: ${DELAY_BETWEEN_BATCHES}ms`);
  console.log(`   API Base URL: ${API_BASE_URL}`);
  
  try {
    // Get all videos needing calculation
    const videos = await getVideosNeedingCalculation();
    totalVideos = videos.length;
    
    if (totalVideos === 0) {
      console.log('✅ No videos need envelope performance calculation. All done!');
      return;
    }
    
    // Calculate batches
    const totalBatches = Math.ceil(totalVideos / BATCH_SIZE);
    console.log(`📦 Processing ${totalVideos.toLocaleString()} videos in ${totalBatches} batches`);
    
    // Process in batches
    for (let i = 0; i < totalBatches; i++) {
      const start = i * BATCH_SIZE;
      const end = Math.min(start + BATCH_SIZE, totalVideos);
      const batch = videos.slice(start, end);
      
      await processBatch(batch, i + 1, totalBatches);
      processedVideos += batch.length;
      
      // Display progress every 10 batches or at the end
      if ((i + 1) % 10 === 0 || i === totalBatches - 1) {
        displayProgress();
      }
      
      // Delay between batches (except for the last one)
      if (i < totalBatches - 1) {
        await new Promise(resolve => setTimeout(resolve, DELAY_BETWEEN_BATCHES));
      }
    }
    
    // Final statistics
    const totalTime = Date.now() - startTime;
    const finalRate = successfulUpdates / (totalTime / 1000);
    
    console.log('\n🎉 BULK PROCESSING COMPLETE!');
    console.log(`📊 FINAL STATISTICS:`);
    console.log(`   Total Videos Processed: ${processedVideos.toLocaleString()}`);
    console.log(`   Successful Updates: ${successfulUpdates.toLocaleString()}`);
    console.log(`   Errors: ${errors}`);
    console.log(`   Success Rate: ${((successfulUpdates / processedVideos) * 100).toFixed(1)}%`);
    console.log(`   Total Time: ${Math.floor(totalTime / 60000)}m ${Math.floor((totalTime % 60000) / 1000)}s`);
    console.log(`   Average Rate: ${finalRate.toFixed(1)} videos/second`);
    
    if (successfulUpdates > 0) {
      console.log('\n✅ Envelope performance scores are now populated!');
      console.log('   Videos will now show accurate age-adjusted performance scores');
      console.log('   Channel pages will display the new envelope-based calculations');
    }
    
  } catch (error) {
    console.error('\n❌ CRITICAL ERROR:', error.message);
    console.error('   Stack trace:', error.stack);
    process.exit(1);
  }
}

/**
 * Handle script interruption gracefully
 */
process.on('SIGINT', () => {
  console.log('\n\n⚠️  Script interrupted by user');
  displayProgress();
  console.log('   You can restart the script to continue processing remaining videos');
  process.exit(0);
});

// Run the script
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
}