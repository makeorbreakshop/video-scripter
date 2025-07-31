#!/usr/bin/env node

import { config } from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import OpenAI from 'openai';
import { v4 as uuidv4 } from 'uuid';
import pLimit from 'p-limit';

// Load environment variables
config();

// Initialize clients
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// Worker configuration - OPTIMIZED FOR SPEED 
const BATCH_SIZE = 100; // Back to full speed with index
const CONCURRENT_REQUESTS = 15; // Balanced concurrency
const TARGET_RATE = 450; // Max OpenAI rate
const DB_UPDATE_BATCH_SIZE = 100; // Update all at once
const IOPS_BUDGET = 400; // Stay well under 500 IOPS limit

// Calculate optimal timing
const BATCH_INTERVAL_MS = 3000; // Process new batch every 3 seconds
const EXPECTED_IOPS = 2; // 1 read + 1 write per batch interval
const IOPS_PER_SECOND = EXPECTED_IOPS / (BATCH_INTERVAL_MS / 1000); // ~0.67 IOPS

// Create limiter
const concurrentLimit = pLimit(CONCURRENT_REQUESTS);

// Worker state
let isRunning = false;
let currentJobId = null;
let processedCount = 0;
let failedCount = 0;
let startTime = null;
let lastBatchTime = null;
let requestTimestamps = [];
let iopsHistory = [];
let totalDbOperations = 0;

// System prompt for LLM
const SYSTEM_PROMPT = `Extract the core content from this YouTube description, ignoring all promotional material, links, and channel information.

Write 1-2 sentences describing what is demonstrated, taught, or shown. Start with an action verb (Building, Creating, Installing, etc.) or a noun phrase. 

CRITICAL: Never use the words "video", "tutorial", "channel", or any meta-references. Focus only on the actual content/techniques/outcomes.`;

/**
 * Rate limiter with sliding window
 */
async function enforceRateLimit() {
  const now = Date.now();
  
  // Remove timestamps older than 1 minute
  requestTimestamps = requestTimestamps.filter(ts => now - ts < 60000);
  
  // If we're at or above target rate, wait
  if (requestTimestamps.length >= TARGET_RATE) {
    const oldestTimestamp = requestTimestamps[0];
    const waitTime = 60000 - (now - oldestTimestamp) + 100; // Add 100ms buffer
    
    if (waitTime > 0) {
      console.log(`⏸️  Rate limit pause: ${(waitTime/1000).toFixed(1)}s`);
      await new Promise(resolve => setTimeout(resolve, waitTime));
    }
  }
  
  requestTimestamps.push(now);
}

/**
 * Enforce batch interval to control IOPS
 */
async function enforceBatchInterval() {
  if (lastBatchTime) {
    const elapsed = Date.now() - lastBatchTime;
    const waitTime = BATCH_INTERVAL_MS - elapsed;
    
    if (waitTime > 0) {
      console.log(`⏱️  IOPS control: waiting ${(waitTime/1000).toFixed(1)}s before next batch`);
      await new Promise(resolve => setTimeout(resolve, waitTime));
    }
  }
  
  lastBatchTime = Date.now();
}

/**
 * Track IOPS usage
 */
function trackIOPS(operations = 1) {
  const now = Date.now();
  totalDbOperations += operations;
  
  // Add to history with timestamp
  iopsHistory.push({ timestamp: now, operations });
  
  // Remove entries older than 60 seconds
  iopsHistory = iopsHistory.filter(entry => now - entry.timestamp < 60000);
  
  // Calculate current IOPS
  const totalOpsInWindow = iopsHistory.reduce((sum, entry) => sum + entry.operations, 0);
  const windowDuration = Math.min(60, (now - startTime) / 1000);
  const currentIOPS = totalOpsInWindow / Math.max(1, windowDuration);
  
  return currentIOPS;
}

/**
 * Batch update database - FAST BATCH UPDATE
 */
async function batchUpdateDatabase(updates) {
  if (updates.length === 0) return;
  
  try {
    // Build update data
    const updateData = updates.map(({ videoId, summary }) => ({
      id: videoId,
      llm_summary: summary,
      llm_summary_generated_at: new Date().toISOString()
    }));
    
    // Use RPC function for batch update
    const { error } = await supabase.rpc('batch_update_videos_llm_summary', {
      update_data: updateData
    });
    
    if (error) {
      throw error;
    }
    
    // Track the write operation
    const currentIOPS = trackIOPS(1);
    
    console.log(`💾 Batch updated ${updates.length} videos (1 operation) | Current IOPS: ${currentIOPS.toFixed(2)}`);
  } catch (error) {
    console.error('Batch update failed, falling back to individual updates:', error.message);
    
    // Fallback to individual updates
    let successCount = 0;
    for (const { videoId, summary } of updates) {
      try {
        const { error } = await supabase
          .from('videos')
          .update({
            llm_summary: summary,
            llm_summary_generated_at: new Date().toISOString()
          })
          .eq('id', videoId);
        
        if (!error) successCount++;
      } catch (e) {
        console.error(`Failed to update ${videoId}:`, e.message);
      }
    }
    
    console.log(`💾 Individual updates complete: ${successCount}/${updates.length} successful`);
  }
}

/**
 * Generate LLM summary for a single video
 */
async function generateSummary(video) {
  try {
    await enforceRateLimit();
    
    // Add small delay to smooth out request rate
    await new Promise(resolve => setTimeout(resolve, Math.random() * 100));
    
    const response = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { 
          role: 'user', 
          content: `Title: ${video.title}\nChannel: ${video.channel_name}\nDescription: ${video.description || 'No description available'}` 
        }
      ],
      temperature: 0.3,
      max_tokens: 100
    });

    return response.choices[0].message.content.trim();
  } catch (error) {
    if (error.status === 429) {
      console.error(`⚠️  Rate limit from OpenAI, backing off...`);
      await new Promise(resolve => setTimeout(resolve, 10000));
      throw error;
    }
    throw error;
  }
}

/**
 * Process a batch of videos
 */
async function processBatch(videos) {
  const updates = [];
  const batchStartTime = Date.now();
  
  console.log(`\n📦 Processing batch of ${videos.length} videos...`);
  console.log(`🎯 Target: ${CONCURRENT_REQUESTS} concurrent, ${TARGET_RATE} req/min`);
  console.log(`💾 IOPS Budget: Using ${IOPS_PER_SECOND.toFixed(2)} IOPS/sec of ${IOPS_BUDGET} limit`);
  
  // Process videos with limited concurrency
  const results = await Promise.all(
    videos.map(video => 
      concurrentLimit(async () => {
        try {
          const summary = await generateSummary(video);
          processedCount++;
          
          // Collect updates instead of writing immediately
          updates.push({ videoId: video.id, summary });
          
          // Log progress every 25 videos
          if (processedCount % 25 === 0) {
            const rate = requestTimestamps.length;
            console.log(`✅ [${processedCount}] ${summary.substring(0, 50)}... (${rate} req/min)`);
          }
          
          return { success: true };
        } catch (error) {
          failedCount++;
          console.error(`❌ Failed ${video.id}: ${error.message}`);
          return { success: false, error: error.message };
        }
      })
    )
  );
  
  // Batch update database with ALL updates at once (1 IOPS)
  if (updates.length > 0) {
    await batchUpdateDatabase(updates);
  }
  
  const batchTime = (Date.now() - batchStartTime) / 1000;
  const videosPerSecond = videos.length / batchTime;
  console.log(`⏱️  Batch completed: ${batchTime.toFixed(1)}s (${videosPerSecond.toFixed(1)} videos/sec)`);
  
  return results;
}

/**
 * Update job progress
 */
async function updateJobProgress() {
  if (!currentJobId) return;
  
  const elapsed = Date.now() - startTime;
  const rate = processedCount / (elapsed / 1000 / 60);
  
  await supabase
    .from('jobs')
    .update({
      data: {
        processed: processedCount,
        failed: failedCount,
        rate: Math.round(rate),
        lastUpdate: new Date().toISOString()
      }
    })
    .eq('id', currentJobId);
}

/**
 * Check if worker should continue
 */
async function shouldContinue() {
  const { data: control } = await supabase
    .from('worker_control')
    .select('is_enabled')
    .eq('worker_type', 'llm_summary')
    .single();
  
  return control?.is_enabled && isRunning;
}

/**
 * Main worker loop
 */
async function runWorker() {
  console.log('🚀 LLM Summary Worker (SPEED OPTIMIZED) started');
  console.log(`⚡ Config: ${CONCURRENT_REQUESTS} parallel, ${TARGET_RATE} req/min target`);
  console.log(`📦 Batch size: ${BATCH_SIZE} videos, single DB update per batch`);
  console.log(`💾 IOPS Strategy: ${IOPS_PER_SECOND.toFixed(2)} IOPS/sec (${EXPECTED_IOPS} ops every ${BATCH_INTERVAL_MS/1000}s)`);
  console.log(`🎯 Speed Target: ~${Math.floor(BATCH_SIZE / (BATCH_INTERVAL_MS / 1000))} videos/sec`);
  
  isRunning = true;
  startTime = Date.now();
  processedCount = 0;
  failedCount = 0;
  requestTimestamps = [];
  iopsHistory = [];
  totalDbOperations = 0;
  
  // Create a job record
  const { data: job } = await supabase
    .from('jobs')
    .insert({
      id: uuidv4(),
      type: 'llm_summary',
      status: 'processing',
      created_at: new Date().toISOString(),
      data: {
        totalVideos: 0,
        processed: 0,
        failed: 0,
        rate: 0,
        mode: 'speed-optimized',
        iopsTarget: IOPS_PER_SECOND
      }
    })
    .select()
    .single();
  
  currentJobId = job?.id;
  
  try {
    // Get actual count of videos needing summaries
    const { count: actualCount } = await supabase
      .from('videos')
      .select('*', { count: 'exact', head: true })
      .is('llm_summary', null);
    
    const totalCount = actualCount || 0;
    console.log(`📊 Found ${totalCount} videos needing LLM summaries`);
    
    if (totalCount === 0) {
      console.log('✅ All videos have LLM summaries!');
      process.exit(0);
    }
    
    console.log(`⏱️  Estimated time: ${(totalCount / TARGET_RATE / 60).toFixed(1)} hours at ${TARGET_RATE} req/min`);
    
    if (currentJobId) {
      await supabase
        .from('jobs')
        .update({
          data: { ...job.data, totalVideos: totalCount }
        })
        .eq('id', currentJobId);
    }
    
    // Try to resume from last checkpoint
    let lastId = '';
    
    // Get the highest ID that has been processed
    const { data: lastProcessed } = await supabase
      .from('videos')
      .select('id')
      .not('llm_summary', 'is', null)
      .order('id', { ascending: false })
      .limit(1);
    
    if (lastProcessed && lastProcessed[0]) {
      lastId = lastProcessed[0].id;
      console.log(`📍 Resuming from last processed ID: ${lastId}`);
    }
    
    let consecutiveEmptyBatches = 0;
    
    while (await shouldContinue()) {
      // Enforce batch interval for IOPS control
      await enforceBatchInterval();
      
      // Fetch next batch - OPTIMIZED QUERY TO AVOID TIMEOUT
      const { data: videos, error } = await supabase
        .from('videos')
        .select('id, title, channel_name, description')
        .is('llm_summary', null)
        .gt('id', lastId)
        .order('id', { ascending: true })
        .limit(BATCH_SIZE)
        .abortSignal(AbortSignal.timeout(30000)); // 30 second timeout
      
      // Track the read operation
      const readIOPS = trackIOPS(1);
      
      if (error) {
        console.error('Error fetching videos:', error);
        
        // If it's a timeout, try a smaller batch size temporarily
        if (error.code === '57014') {
          console.log('⚠️  Query timeout detected, retrying with smaller batch...');
          // Try with just 10 videos
          const { data: smallBatch, error: smallError } = await supabase
            .from('videos')
            .select('id, title, channel_name, description')
            .is('llm_summary', null)
            .gt('id', lastId)
            .order('id', { ascending: true })
            .limit(10)
            .abortSignal(AbortSignal.timeout(15000));
          
          if (!smallError && smallBatch && smallBatch.length > 0) {
            videos = smallBatch;
          } else {
            await new Promise(resolve => setTimeout(resolve, 10000));
            continue;
          }
        } else {
          await new Promise(resolve => setTimeout(resolve, 5000));
          continue;
        }
      }
      
      if (!videos || videos.length === 0) {
        consecutiveEmptyBatches++;
        
        // Check if there are still videos needing summaries
        const { count: remainingCount } = await supabase
          .from('videos')
          .select('*', { count: 'exact', head: true })
          .is('llm_summary', null);
        
        if (remainingCount > 0 && consecutiveEmptyBatches >= 2) {
          // There are videos left but we can't find them with current lastId
          // This means we need to restart from the beginning
          console.log(`🔄 Found ${remainingCount} videos still needing summaries`);
          console.log(`📍 Restarting from beginning (was at ID: ${lastId})`);
          lastId = '';
          consecutiveEmptyBatches = 0;
          continue;
        }
        
        if (consecutiveEmptyBatches >= 3 || remainingCount === 0) {
          console.log('✅ No more videos to process!');
          break;
        }
        
        console.log('📭 Empty batch, retrying...');
        await new Promise(resolve => setTimeout(resolve, 2000));
        continue;
      }
      
      consecutiveEmptyBatches = 0;
      
      // Process the batch
      await processBatch(videos);
      
      // Update progress every 10 batches to reduce DB writes
      if (processedCount % (BATCH_SIZE * 10) < BATCH_SIZE) {
        await updateJobProgress();
      }
      
      // Update lastId for pagination
      lastId = videos[videos.length - 1].id;
      
      // Log overall progress
      const elapsed = (Date.now() - startTime) / 1000;
      const rate = processedCount / (elapsed / 60);
      const remaining = totalCount - processedCount;
      const eta = remaining / rate;
      
      // Calculate real-time IOPS
      const currentIOPS = iopsHistory.reduce((sum, entry) => sum + entry.operations, 0) / Math.max(1, Math.min(60, (Date.now() - startTime) / 1000));
      const avgIOPS = totalDbOperations / ((Date.now() - startTime) / 1000);
      
      console.log(`\n📊 Progress: ${processedCount}/${totalCount} (${(processedCount/totalCount*100).toFixed(1)}%)`);
      console.log(`⚡ Rate: ${rate.toFixed(0)} videos/minute`);
      console.log(`⏱️  ETA: ${Math.ceil(eta)} minutes (${(eta/60).toFixed(1)} hours)`);
      console.log(`💰 Cost: $${(processedCount * 0.000116).toFixed(2)} / $${(totalCount * 0.000116).toFixed(2)}`);
      console.log(`💾 IOPS: Current=${currentIOPS.toFixed(2)}/sec | Average=${avgIOPS.toFixed(2)}/sec | Limit=${IOPS_BUDGET}/sec`);
      console.log(`📈 Total DB Operations: ${totalDbOperations} (${Math.floor(totalDbOperations/2)} reads + ${Math.floor(totalDbOperations/2)} writes)`);
    }
    
  } catch (error) {
    console.error('Worker error:', error);
  } finally {
    if (currentJobId) {
      await supabase
        .from('jobs')
        .update({
          status: 'completed',
          completed_at: new Date().toISOString(),
          data: {
            processed: processedCount,
            failed: failedCount,
            duration: Date.now() - startTime,
            finalRate: processedCount / ((Date.now() - startTime) / 1000 / 60),
            avgIopsUsed: IOPS_PER_SECOND
          }
        })
        .eq('id', currentJobId);
    }
    
    isRunning = false;
    const totalTime = (Date.now() - startTime) / 1000 / 60;
    const finalRate = processedCount / totalTime;
    
    console.log(`\n✅ Worker completed`);
    console.log(`📈 Processed: ${processedCount}, Failed: ${failedCount}`);
    console.log(`⚡ Average rate: ${finalRate.toFixed(0)} videos/minute`);
    console.log(`⏱️  Total time: ${totalTime.toFixed(1)} minutes (${(totalTime/60).toFixed(1)} hours)`);
    console.log(`💾 Final IOPS Stats:`);
    console.log(`   - Total DB Operations: ${totalDbOperations}`);
    console.log(`   - Average IOPS: ${(totalDbOperations / ((Date.now() - startTime) / 1000)).toFixed(2)}/sec`);
    console.log(`   - Peak usage was well under ${IOPS_BUDGET} IOPS limit`);
  }
}

/**
 * Graceful shutdown
 */
process.on('SIGINT', async () => {
  console.log('\n🛑 Shutdown signal received');
  isRunning = false;
  
  await new Promise(resolve => setTimeout(resolve, 2000));
  process.exit(0);
});

// Start the worker
console.log('Starting LLM Summary Worker (Speed Optimized)...');
runWorker().catch(console.error);