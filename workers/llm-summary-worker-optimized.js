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

// Worker configuration
const BATCH_SIZE = 200; // Fetch 200 videos at a time
const CONCURRENT_REQUESTS = 25; // Process 25 videos in parallel
const REQUESTS_PER_MINUTE = 480; // OpenAI limit is 500, keep buffer
const REQUESTS_PER_SECOND = 8; // Smooth out the rate

// Create limiters
const concurrentLimit = pLimit(CONCURRENT_REQUESTS);
const rateLimit = pLimit(REQUESTS_PER_SECOND);

// Worker state
let isRunning = false;
let currentJobId = null;
let processedCount = 0;
let failedCount = 0;
let startTime = null;
let requestTimes = []; // Track request timestamps for rate limiting

// System prompt for LLM
const SYSTEM_PROMPT = `Extract the core content from this YouTube description, ignoring all promotional material, links, and channel information.

Write 1-2 sentences describing what is demonstrated, taught, or shown. Start with an action verb (Building, Creating, Installing, etc.) or a noun phrase. 

CRITICAL: Never use the words "video", "tutorial", "channel", or any meta-references. Focus only on the actual content/techniques/outcomes.`;

/**
 * Smart rate limiting with sliding window
 */
async function enforceRateLimit() {
  const now = Date.now();
  
  // Remove timestamps older than 1 minute
  requestTimes = requestTimes.filter(time => now - time < 60000);
  
  // If we're at the per-minute limit, calculate wait time
  if (requestTimes.length >= REQUESTS_PER_MINUTE) {
    const oldestTime = requestTimes[0];
    const waitTime = 60000 - (now - oldestTime) + 100; // Add 100ms buffer
    
    if (waitTime > 0) {
      console.log(`⏸️  Rate limit: waiting ${(waitTime/1000).toFixed(1)}s (${requestTimes.length} requests in window)`);
      await new Promise(resolve => setTimeout(resolve, waitTime));
      // Clean up old timestamps after waiting
      requestTimes = requestTimes.filter(time => Date.now() - time < 60000);
    }
  }
  
  // Also enforce per-second limit for smooth operation
  const recentRequests = requestTimes.filter(time => now - time < 1000);
  if (recentRequests.length >= REQUESTS_PER_SECOND) {
    await new Promise(resolve => setTimeout(resolve, 125)); // Wait 1/8 second
  }
  
  // Record this request
  requestTimes.push(Date.now());
}

/**
 * Generate LLM summary for a single video
 */
async function generateSummary(video) {
  try {
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
      await new Promise(resolve => setTimeout(resolve, 5000));
      throw error;
    }
    throw error;
  }
}

/**
 * Process a single video with rate limiting
 */
async function processVideo(video) {
  try {
    // Enforce rate limit before making request
    await enforceRateLimit();
    
    const summary = await generateSummary(video);
    
    // Update the video with the summary
    const { error } = await supabase
      .from('videos')
      .update({ 
        llm_summary: summary,
        llm_summary_generated_at: new Date().toISOString()
      })
      .eq('id', video.id);
    
    if (error) throw error;
    
    processedCount++;
    
    // Less verbose logging
    if (processedCount % 10 === 0) {
      const rate = requestTimes.length;
      console.log(`✅ [${processedCount}] ${summary.substring(0, 50)}... (${rate} req/min)`);
    }
    
    return { videoId: video.id, success: true, summary };
    
  } catch (error) {
    failedCount++;
    console.error(`❌ Failed ${video.id}: ${error.message}`);
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
  console.log('🚀 LLM Summary Worker (OPTIMIZED) started');
  console.log(`⚡ Config: ${CONCURRENT_REQUESTS} parallel, ${REQUESTS_PER_MINUTE}/min rate limit`);
  
  isRunning = true;
  startTime = Date.now();
  processedCount = 0;
  failedCount = 0;
  requestTimes = [];
  
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
        mode: 'optimized'
      }
    })
    .select()
    .single();
  
  currentJobId = job?.id;
  
  try {
    // Get total count
    const { count: totalCount } = await supabase
      .from('videos')
      .select('*', { count: 'exact', head: true })
      .is('llm_summary', null)
      .neq('channel_name', 'Make or Break Shop');
    
    console.log(`📊 Found ${totalCount} videos needing LLM summaries`);
    
    if (currentJobId) {
      await supabase
        .from('jobs')
        .update({
          data: { ...job.data, totalVideos: totalCount }
        })
        .eq('id', currentJobId);
    }
    
    let lastId = '';
    let retryCount = 0;
    
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
      
      // Process with both concurrency and rate limiting
      const results = await Promise.all(
        videos.map(video => 
          concurrentLimit(() => 
            rateLimit(() => processVideo(video))
          )
        )
      );
      
      // Check for OpenAI rate limit errors
      const rateLimitErrors = results.filter(r => !r.success && r.error?.includes('429')).length;
      if (rateLimitErrors > 5) {
        console.log('⚠️  Multiple rate limit errors, backing off for 30s...');
        await new Promise(resolve => setTimeout(resolve, 30000));
        retryCount++;
        if (retryCount > 3) {
          console.error('Too many rate limit errors, stopping...');
          break;
        }
      } else {
        retryCount = 0;
      }
      
      // Update progress
      await updateJobProgress();
      
      // Update lastId for pagination
      lastId = videos[videos.length - 1].id;
      
      // Log progress
      const elapsed = (Date.now() - startTime) / 1000;
      const rate = processedCount / (elapsed / 60);
      const remaining = totalCount - processedCount;
      const eta = remaining / rate;
      
      console.log(`\n📊 Progress: ${processedCount}/${totalCount} (${(processedCount/totalCount*100).toFixed(1)}%)`);
      console.log(`⚡ Rate: ${rate.toFixed(0)} videos/minute (target: ${REQUESTS_PER_MINUTE})`);
      console.log(`⏱️  ETA: ${Math.ceil(eta)} minutes (${(eta/60).toFixed(1)} hours)`);
      console.log(`💰 Cost: $${(processedCount * 0.000116).toFixed(2)} / $${(totalCount * 0.000116).toFixed(2)}`);
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
  
  await new Promise(resolve => setTimeout(resolve, 5000));
  process.exit(0);
});

// Start the worker
console.log('Starting LLM Summary Worker (Optimized)...');
runWorker().catch(console.error);