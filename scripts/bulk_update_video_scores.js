#!/usr/bin/env node

import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';

dotenv.config();

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function getAllVideoIds() {
  console.log('📊 Fetching all video IDs...');
  
  let allVideos = [];
  let offset = 0;
  const batchSize = 1000;
  
  while (true) {
    const { data, error } = await supabase
      .from('videos')
      .select('id')
      .range(offset, offset + batchSize - 1);
    
    if (error) {
      console.error('Error fetching videos:', error);
      break;
    }
    
    if (!data || data.length === 0) break;
    
    allVideos = allVideos.concat(data);
    
    if (data.length < batchSize) break;
    offset += batchSize;
    
    if (offset % 10000 === 0) {
      console.log(`  Fetched ${offset} videos...`);
    }
  }
  
  console.log(`✅ Found ${allVideos.length} total videos`);
  return allVideos.map(v => v.id);
}

async function updateVideoScoresInBatches(videoIds) {
  console.log('\n🔄 Updating video performance scores...');
  
  const batchSize = 250; // API can handle 250 at a time
  let totalProcessed = 0;
  let totalSuccess = 0;
  let totalFailed = 0;
  
  for (let i = 0; i < videoIds.length; i += batchSize) {
    const batch = videoIds.slice(i, i + batchSize);
    const batchNum = Math.floor(i / batchSize) + 1;
    const totalBatches = Math.ceil(videoIds.length / batchSize);
    
    console.log(`\n📦 Processing batch ${batchNum}/${totalBatches} (${batch.length} videos)...`);
    
    try {
      const response = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL.replace('/rest/v1', '')}/functions/v1/classify-video-performance`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`
        },
        body: JSON.stringify({
          video_ids: batch,
          update_database: true
        })
      });
      
      if (!response.ok) {
        // Try the local API endpoint as fallback
        console.log('  Edge function not available, trying local API...');
        
        const localResponse = await fetch('http://localhost:3000/api/performance/classify-video', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            video_ids: batch,
            update_database: true
          })
        });
        
        if (localResponse.ok) {
          const result = await localResponse.json();
          totalSuccess += batch.length;
          console.log(`  ✅ Batch ${batchNum} complete: ${result.categories_summary?.on_track || 0} on track, ${result.categories_summary?.outperforming || 0} outperforming`);
        } else {
          totalFailed += batch.length;
          console.log(`  ❌ Batch ${batchNum} failed: ${localResponse.status}`);
        }
      } else {
        const result = await response.json();
        totalSuccess += batch.length;
        console.log(`  ✅ Batch ${batchNum} complete`);
      }
      
      totalProcessed += batch.length;
      
      // Show progress
      const progress = ((totalProcessed / videoIds.length) * 100).toFixed(1);
      console.log(`  Progress: ${totalProcessed}/${videoIds.length} (${progress}%)`);
      
      // Small delay to avoid overwhelming the API
      await new Promise(resolve => setTimeout(resolve, 500));
      
    } catch (error) {
      console.error(`  ❌ Error processing batch ${batchNum}:`, error.message);
      totalFailed += batch.length;
      totalProcessed += batch.length;
    }
  }
  
  console.log('\n' + '='.repeat(60));
  console.log('✅ BULK UPDATE COMPLETE');
  console.log(`  Total videos processed: ${totalProcessed}`);
  console.log(`  Successful updates: ${totalSuccess}`);
  console.log(`  Failed updates: ${totalFailed}`);
  console.log('='.repeat(60));
}

async function main() {
  console.log('='.repeat(60));
  console.log('BULK VIDEO PERFORMANCE SCORE UPDATE');
  console.log('='.repeat(60));
  console.log('This will recalculate performance scores for all videos');
  console.log('using the new smoothed global performance envelopes.');
  console.log('');
  
  const startTime = Date.now();
  
  // Get all video IDs
  const videoIds = await getAllVideoIds();
  
  if (videoIds.length === 0) {
    console.log('❌ No videos found to update');
    return;
  }
  
  // Update scores in batches
  await updateVideoScoresInBatches(videoIds);
  
  const elapsed = ((Date.now() - startTime) / 1000 / 60).toFixed(1);
  console.log(`\n⏱️ Total processing time: ${elapsed} minutes`);
}

// Run the script
main().catch(console.error);