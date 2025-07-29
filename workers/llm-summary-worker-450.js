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

// Worker configuration optimized for 450 req/min
const BATCH_SIZE = 450; // Fetch more videos at once
const CONCURRENT_REQUESTS = 50; // Higher concurrency
const TARGET_RATE = 450; // Target requests per minute
const DB_UPDATE_BATCH_SIZE = 25; // Batch database updates

// Create limiter
const concurrentLimit = pLimit(CONCURRENT_REQUESTS);

// Worker state
let isRunning = false;
let currentJobId = null;
let processedCount = 0;
let failedCount = 0;
let startTime = null;
let minuteStartTime = null;
let requestsThisMinute = 0;
let pendingDbUpdates = [];

// System prompt for LLM
const SYSTEM_PROMPT = `Extract the core content from this YouTube description, ignoring all promotional material, links, and channel information.

Write 1-2 sentences describing what is demonstrated, taught, or shown. Start with an action verb (Building, Creating, Installing, etc.) or a noun phrase. 

CRITICAL: Never use the words "video", "tutorial", "channel", or any meta-references. Focus only on the actual content/techniques/outcomes.`;

/**
 * Calculate dynamic delay to maintain target rate
 */
function calculateDelay() {
  const now = Date.now();
  
  // Reset minute counter if needed
  if (!minuteStartTime || now - minuteStartTime >= 60000) {
    minuteStartTime = now;
    requestsThisMinute = 0;
  }
  
  // Calculate how long this minute has been running
  const minuteElapsed = now - minuteStartTime;
  const minuteProgress = minuteElapsed / 60000; // 0 to 1
  
  // How many requests should we have made by now?
  const expectedRequests = Math.floor(TARGET_RATE * minuteProgress);
  
  // Are we ahead or behind?
  if (requestsThisMinute >= expectedRequests) {
    // We're ahead, calculate delay to get back on track
    const requestsAhead = requestsThisMinute - expectedRequests;
    const delayMs = (requestsAhead / TARGET_RATE) * 60000;
    return Math.min(delayMs, 1000); // Cap at 1 second
  }
  
  return 0; // No delay needed, we're behind target
}

/**
 * Batch update database
 */
async function flushDatabaseUpdates() {
  if (pendingDbUpdates.length === 0) return;
  
  const updates = pendingDbUpdates.splice(0, DB_UPDATE_BATCH_SIZE);
  
  try {
    // Use Promise.all for parallel updates
    await Promise.all(
      updates.map(({ videoId, summary }) =>
        supabase
          .from('videos')
          .update({
            llm_summary: summary,
            llm_summary_generated_at: new Date().toISOString()
          })
          .eq('id', videoId)
      )
    );
  } catch (error) {
    console.error('Database update error:', error);
    // Re-add failed updates to queue
    pendingDbUpdates.unshift(...updates);
  }
}

/**
 * Generate LLM summary for a single video
 */
async function generateSummary(video) {
  try {
    requestsThisMinute++;
    
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
      requestsThisMinute--; // Don't count failed request
      throw error;
    }
    throw error;
  }
}

/**
 * Process a single video
 */
async function processVideo(video) {
  try {
    // Apply dynamic delay to maintain rate
    const delay = calculateDelay();
    if (delay > 0) {
      await new Promise(resolve => setTimeout(resolve, delay));
    }
    
    const summary = await generateSummary(video);
    
    // Queue the database update instead of doing it immediately
    pendingDbUpdates.push({ videoId: video.id, summary });
    
    processedCount++;
    
    // Less verbose logging
    if (processedCount % 25 === 0) {
      const currentRate = requestsThisMinute / ((Date.now() - minuteStartTime) / 60000);
      console.log(`✅ [${processedCount}] ${summary.substring(0, 45)}... (${Math.round(currentRate)} req/min)`);
      
      // Flush database updates
      await flushDatabaseUpdates();
    }
    
    return { videoId: video.id, success: true, summary };
    
  } catch (error) {
    failedCount++;
    if (processedCount % 100 === 0) {
      console.error(`❌ Failed count: ${failedCount}`);
    }
    return { videoId: video.id, success: false, error: error.message };
  }
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
  console.log('🚀 LLM Summary Worker (450 RPM OPTIMIZED) started');
  console.log(`⚡ Config: ${CONCURRENT_REQUESTS} parallel, ${TARGET_RATE} req/min target`);
  console.log(`📦 Batch size: ${BATCH_SIZE} videos, ${DB_UPDATE_BATCH_SIZE} DB updates`);
  
  isRunning = true;
  startTime = Date.now();
  minuteStartTime = Date.now();
  processedCount = 0;
  failedCount = 0;
  requestsThisMinute = 0;
  pendingDbUpdates = [];
  
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
        mode: '450rpm'
      }
    })
    .select()
    .single();
  
  currentJobId = job?.id;
  
  // Start a background task to flush DB updates
  const dbFlushInterval = setInterval(async () => {
    await flushDatabaseUpdates();
  }, 5000); // Every 5 seconds
  
  try {
    // Get total count
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
    
    while (await shouldContinue()) {
      // Fetch next batch
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
        break;
      }
      
      if (!videos || videos.length === 0) {
        console.log('✅ No more videos to process');
        break;
      }
      
      console.log(`\n📦 Processing batch of ${videos.length} videos...`);
      const batchStartTime = Date.now();
      
      // Process with high concurrency
      const results = await Promise.all(
        videos.map(video => 
          concurrentLimit(() => processVideo(video))
        )
      );
      
      // Flush any remaining DB updates
      await flushDatabaseUpdates();
      
      // Update progress
      await updateJobProgress();
      
      // Update lastId for pagination
      lastId = videos[videos.length - 1].id;
      
      // Log progress
      const elapsed = (Date.now() - startTime) / 1000;
      const rate = processedCount / (elapsed / 60);
      const remaining = totalCount - processedCount;
      const eta = remaining / rate;
      const batchTime = (Date.now() - batchStartTime) / 1000;
      
      console.log(`\n📊 Progress: ${processedCount}/${totalCount} (${(processedCount/totalCount*100).toFixed(1)}%)`);
      console.log(`⚡ Rate: ${rate.toFixed(0)} videos/minute (target: ${TARGET_RATE})`);
      console.log(`⏱️  ETA: ${Math.ceil(eta)} minutes (${(eta/60).toFixed(1)} hours)`);
      console.log(`💰 Cost: $${(processedCount * 0.000116).toFixed(2)} / $${(totalCount * 0.000116).toFixed(2)}`);
      console.log(`⚙️  Batch processed in ${batchTime.toFixed(1)}s`);
      
      // If we're significantly below target rate, increase concurrency
      if (rate < TARGET_RATE * 0.8 && CONCURRENT_REQUESTS < 75) {
        console.log(`📈 Rate below target, could increase concurrency`);
      }
    }
    
  } catch (error) {
    console.error('Worker error:', error);
  } finally {
    // Clean up
    clearInterval(dbFlushInterval);
    await flushDatabaseUpdates(); // Final flush
    
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
            finalRate: processedCount / ((Date.now() - startTime) / 1000 / 60)
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
  }
}

/**
 * Graceful shutdown
 */
process.on('SIGINT', async () => {
  console.log('\n🛑 Shutdown signal received');
  isRunning = false;
  
  // Final DB flush
  await flushDatabaseUpdates();
  
  await new Promise(resolve => setTimeout(resolve, 2000));
  process.exit(0);
});

// Start the worker
console.log('Starting LLM Summary Worker (450 RPM Target)...');
runWorker().catch(console.error);