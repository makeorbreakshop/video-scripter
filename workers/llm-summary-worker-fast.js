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
const CONCURRENT_REQUESTS = 20; // Process 20 videos in parallel
const RATE_LIMIT_PER_MINUTE = 480; // Stay under 500 RPM limit with buffer

// Create a rate limiter
const limit = pLimit(CONCURRENT_REQUESTS);

// Worker state
let isRunning = false;
let currentJobId = null;
let processedCount = 0;
let failedCount = 0;
let startTime = null;
let lastRateCheckTime = null;
let requestsInCurrentMinute = 0;

// System prompt for LLM
const SYSTEM_PROMPT = `Extract the core content from this YouTube description, ignoring all promotional material, links, and channel information.

Write 1-2 sentences describing what is demonstrated, taught, or shown. Start with an action verb (Building, Creating, Installing, etc.) or a noun phrase. 

CRITICAL: Never use the words "video", "tutorial", "channel", or any meta-references. Focus only on the actual content/techniques/outcomes.`;

/**
 * Rate limiting check
 */
async function checkRateLimit() {
  const now = Date.now();
  
  // Reset counter every minute
  if (!lastRateCheckTime || now - lastRateCheckTime > 60000) {
    lastRateCheckTime = now;
    requestsInCurrentMinute = 0;
  }
  
  // If we're approaching the limit, wait
  if (requestsInCurrentMinute >= RATE_LIMIT_PER_MINUTE - 20) {
    const waitTime = 60000 - (now - lastRateCheckTime);
    if (waitTime > 0) {
      console.log(`⏸️  Rate limit pause: ${(waitTime/1000).toFixed(1)}s`);
      await new Promise(resolve => setTimeout(resolve, waitTime));
      lastRateCheckTime = Date.now();
      requestsInCurrentMinute = 0;
    }
  }
  
  requestsInCurrentMinute++;
}

/**
 * Generate LLM summary for a single video
 */
async function generateSummary(video) {
  await checkRateLimit();
  
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
    console.error(`Error generating summary for video ${video.id}:`, error.message);
    throw error;
  }
}

/**
 * Process a single video with summary generation and database update
 */
async function processVideo(video) {
  try {
    const summary = await generateSummary(video);
    
    // Update the video with the summary
    const { error } = await supabase
      .from('videos')
      .update({ 
        llm_summary: summary,
        llm_summary_generated_at: new Date().toISOString()
      })
      .eq('id', video.id);
    
    if (error) {
      throw error;
    }
    
    processedCount++;
    
    // Less verbose logging for speed
    if (processedCount % 10 === 0) {
      console.log(`✅ [${processedCount}] Latest: "${summary.substring(0, 60)}..."`);
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
  const rate = processedCount / (elapsed / 1000 / 60); // videos per minute
  
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
  // Check if worker is still enabled
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
  console.log('🚀 LLM Summary Worker (FAST MODE) started');
  console.log(`⚡ Configuration: ${CONCURRENT_REQUESTS} parallel requests, ${BATCH_SIZE} batch size`);
  
  isRunning = true;
  startTime = Date.now();
  lastRateCheckTime = Date.now();
  processedCount = 0;
  failedCount = 0;
  requestsInCurrentMinute = 0;
  
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
        mode: 'fast'
      }
    })
    .select()
    .single();
  
  currentJobId = job?.id;
  
  try {
    // Get total count of videos needing summaries
    const { count: totalCount } = await supabase
      .from('videos')
      .select('*', { count: 'exact', head: true })
      .is('llm_summary', null)
      .neq('channel_name', 'Make or Break Shop');
    
    console.log(`📊 Found ${totalCount} videos needing LLM summaries`);
    
    // Update job with total count
    if (currentJobId) {
      await supabase
        .from('jobs')
        .update({
          data: { 
            ...job.data, 
            totalVideos: totalCount 
          }
        })
        .eq('id', currentJobId);
    }
    
    // Process videos in batches
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
      
      // Process all videos in parallel with concurrency limit
      const results = await Promise.all(
        videos.map(video => limit(() => processVideo(video)))
      );
      
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
      console.log(`⚡ Rate: ${rate.toFixed(0)} videos/minute`);
      console.log(`⏱️  ETA: ${Math.ceil(eta)} minutes (${(eta/60).toFixed(1)} hours)`);
      console.log(`💰 Cost: $${(processedCount * 0.000116).toFixed(2)} / $${(totalCount * 0.000116).toFixed(2)}`);
      console.log(`🔄 Current minute requests: ${requestsInCurrentMinute}/${RATE_LIMIT_PER_MINUTE}`);
    }
    
  } catch (error) {
    console.error('Worker error:', error);
  } finally {
    // Update job status
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
    console.log(`\n✅ Worker completed. Processed: ${processedCount}, Failed: ${failedCount}`);
    
    const totalTime = (Date.now() - startTime) / 1000 / 60;
    const finalRate = processedCount / totalTime;
    console.log(`📈 Final rate: ${finalRate.toFixed(0)} videos/minute`);
    console.log(`⏱️  Total time: ${totalTime.toFixed(1)} minutes (${(totalTime/60).toFixed(1)} hours)`);
  }
}

/**
 * Graceful shutdown
 */
process.on('SIGINT', async () => {
  console.log('\n🛑 Shutdown signal received');
  isRunning = false;
  
  // Wait a bit for current operations to complete
  await new Promise(resolve => setTimeout(resolve, 5000));
  
  process.exit(0);
});

// Start the worker
console.log('Starting LLM Summary Worker (Fast Mode)...');
runWorker().catch(console.error);