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

// Worker configuration - OPTIMIZED FOR LOW I/O
const BATCH_SIZE = 100; // Smaller batches to reduce memory and I/O
const CONCURRENT_REQUESTS = 10; // Lower concurrency to reduce load
const TARGET_RATE = 400; // Slightly under 450 to be safe
const DB_UPDATE_BATCH_SIZE = 50; // Update 50 at once in a single query

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
 * Batch update database - SINGLE QUERY instead of parallel
 */
async function batchUpdateDatabase(updates) {
  if (updates.length === 0) return;
  
  try {
    // Build the data for batch update
    const updateData = updates.map(({ videoId, summary }) => ({
      id: videoId,
      llm_summary: summary,
      llm_summary_generated_at: new Date().toISOString()
    }));
    
    // Use upsert for batch update - this is a SINGLE database operation
    const { error } = await supabase
      .from('videos')
      .upsert(updateData, { 
        onConflict: 'id',
        ignoreDuplicates: false 
      });
    
    if (error) {
      console.error('Batch update error:', error);
      throw error;
    }
    
    console.log(`💾 Batch updated ${updates.length} videos in database`);
  } catch (error) {
    console.error('Database batch update failed:', error);
    throw error;
  }
}

/**
 * Generate LLM summary for a single video
 */
async function generateSummary(video) {
  try {
    await enforceRateLimit();
    
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
  
  // Process videos with limited concurrency
  const results = await Promise.all(
    videos.map(video => 
      concurrentLimit(async () => {
        try {
          const summary = await generateSummary(video);
          processedCount++;
          
          // Collect updates instead of writing immediately
          updates.push({ videoId: video.id, summary });
          
          // Log progress every 10 videos
          if (processedCount % 10 === 0) {
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
  
  // Batch update database with ALL updates at once
  if (updates.length > 0) {
    await batchUpdateDatabase(updates);
  }
  
  const batchTime = (Date.now() - batchStartTime) / 1000;
  console.log(`⏱️  Batch completed in ${batchTime.toFixed(1)}s`);
  
  // Add delay between batches to reduce I/O pressure
  await new Promise(resolve => setTimeout(resolve, 1000));
  
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
  console.log('🚀 LLM Summary Worker (I/O OPTIMIZED) started');
  console.log(`⚡ Config: ${CONCURRENT_REQUESTS} parallel, ${TARGET_RATE} req/min target`);
  console.log(`📦 Batch size: ${BATCH_SIZE} videos, single DB update per batch`);
  console.log(`💾 Database I/O: Optimized with batch upserts and delays`);
  
  isRunning = true;
  startTime = Date.now();
  processedCount = 0;
  failedCount = 0;
  requestTimestamps = [];
  
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
        mode: 'io-optimized'
      }
    })
    .select()
    .single();
  
  currentJobId = job?.id;
  
  try {
    // Get total count with a simple query
    const { count: totalCount } = await supabase
      .from('videos')
      .select('*', { count: 'exact', head: true })
      .is('llm_summary', null)
      .neq('channel_name', 'Make or Break Shop');
    
    console.log(`📊 Found ${totalCount} videos needing LLM summaries`);
    console.log(`⏱️  Estimated time: ${(totalCount / TARGET_RATE / 60).toFixed(1)} hours at ${TARGET_RATE} req/min`);
    
    if (currentJobId) {
      await supabase
        .from('jobs')
        .update({
          data: { ...job.data, totalVideos: totalCount }
        })
        .eq('id', currentJobId);
    }
    
    let lastId = '';
    let consecutiveEmptyBatches = 0;
    
    while (await shouldContinue()) {
      // Fetch next batch - SINGLE READ OPERATION
      const { data: videos, error } = await supabase
        .from('videos')
        .select('id, title, channel_name, description')
        .is('llm_summary', null)
        .neq('channel_name', 'Make or Break Shop')
        .gt('id', lastId)
        .order('id')
        .limit(BATCH_SIZE);
      
      if (error) {
        console.error('Error fetching videos:', error);
        await new Promise(resolve => setTimeout(resolve, 5000));
        continue;
      }
      
      if (!videos || videos.length === 0) {
        consecutiveEmptyBatches++;
        if (consecutiveEmptyBatches >= 3) {
          console.log('✅ No more videos to process');
          break;
        }
        console.log('📭 Empty batch, retrying...');
        await new Promise(resolve => setTimeout(resolve, 2000));
        continue;
      }
      
      consecutiveEmptyBatches = 0;
      console.log(`\n📦 Processing batch of ${videos.length} videos...`);
      
      // Process the batch
      await processBatch(videos);
      
      // Update progress every 5 batches to reduce DB writes
      if (processedCount % (BATCH_SIZE * 5) < BATCH_SIZE) {
        await updateJobProgress();
      }
      
      // Update lastId for pagination
      lastId = videos[videos.length - 1].id;
      
      // Log overall progress
      const elapsed = (Date.now() - startTime) / 1000;
      const rate = processedCount / (elapsed / 60);
      const remaining = totalCount - processedCount;
      const eta = remaining / rate;
      
      console.log(`\n📊 Progress: ${processedCount}/${totalCount} (${(processedCount/totalCount*100).toFixed(1)}%)`);
      console.log(`⚡ Rate: ${rate.toFixed(0)} videos/minute`);
      console.log(`⏱️  ETA: ${Math.ceil(eta)} minutes (${(eta/60).toFixed(1)} hours)`);
      console.log(`💰 Cost: $${(processedCount * 0.000116).toFixed(2)} / $${(totalCount * 0.000116).toFixed(2)}`);\n    }\n    \n  } catch (error) {\n    console.error('Worker error:', error);\n  } finally {\n    if (currentJobId) {\n      await supabase\n        .from('jobs')\n        .update({\n          status: 'completed',\n          completed_at: new Date().toISOString(),\n          data: {\n            processed: processedCount,\n            failed: failedCount,\n            duration: Date.now() - startTime,\n            finalRate: processedCount / ((Date.now() - startTime) / 1000 / 60)\n          }\n        })\n        .eq('id', currentJobId);\n    }\n    \n    isRunning = false;\n    const totalTime = (Date.now() - startTime) / 1000 / 60;\n    const finalRate = processedCount / totalTime;\n    \n    console.log(`\n✅ Worker completed`);\n    console.log(`📈 Processed: ${processedCount}, Failed: ${failedCount}`);\n    console.log(`⚡ Average rate: ${finalRate.toFixed(0)} videos/minute`);\n    console.log(`⏱️  Total time: ${totalTime.toFixed(1)} minutes (${(totalTime/60).toFixed(1)} hours)`);\n  }\n}\n\n/**\n * Graceful shutdown\n */\nprocess.on('SIGINT', async () => {\n  console.log('\\n🛑 Shutdown signal received');\n  isRunning = false;\n  \n  await new Promise(resolve => setTimeout(resolve, 2000));\n  process.exit(0);\n});\n\n// Start the worker\nconsole.log('Starting LLM Summary Worker (I/O Optimized)...');\nrunWorker().catch(console.error);