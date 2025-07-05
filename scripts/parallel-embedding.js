#!/usr/bin/env node

/**
 * Parallel embedding processor for faster completion
 * Runs multiple batches simultaneously
 */

const BATCH_SIZE = 500;
const PARALLEL_WORKERS = 4; // Run 4 batches at once

async function processBatch(batchNumber) {
  console.log(`🚀 Starting batch ${batchNumber}`);
  
  const response = await fetch('http://localhost:3000/api/embeddings/titles/batch', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ 
      limit: BATCH_SIZE, 
      force_refresh: false 
    })
  });

  const result = await response.json();
  console.log(`✅ Batch ${batchNumber} complete: ${result.successful}/${result.processed} videos`);
  
  return result;
}

async function runParallelEmbedding() {
  console.log(`🔥 Starting parallel embedding with ${PARALLEL_WORKERS} workers`);
  
  // Check current status
  const statusResponse = await fetch('http://localhost:3000/api/embeddings/titles/batch');
  const status = await statusResponse.json();
  console.log(`📊 Current status: ${status.stats?.synced_videos || 0}/${status.stats?.total_videos || 0} embedded`);
  
  let batchNumber = 1;
  let allCompleted = false;
  
  while (!allCompleted) {
    // Create array of parallel batch promises
    const promises = [];
    for (let i = 0; i < PARALLEL_WORKERS; i++) {
      promises.push(processBatch(batchNumber + i));
    }
    
    // Wait for all parallel batches to complete
    const results = await Promise.all(promises);
    
    // Check if any batch had no videos to process (we're done)
    const hasNoVideos = results.some(r => r.processed === 0);
    if (hasNoVideos) {
      console.log('🎯 All videos embedded! Process complete.');
      allCompleted = true;
      break;
    }
    
    const totalProcessed = results.reduce((sum, r) => sum + r.processed, 0);
    const totalSuccessful = results.reduce((sum, r) => sum + r.successful, 0);
    
    console.log(`📈 Parallel round ${Math.ceil(batchNumber/PARALLEL_WORKERS)} complete: ${totalSuccessful}/${totalProcessed} videos embedded`);
    
    batchNumber += PARALLEL_WORKERS;
    
    // Brief pause between parallel rounds
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
}

runParallelEmbedding().catch(console.error);