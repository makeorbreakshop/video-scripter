#!/usr/bin/env node

import { config } from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import OpenAI from 'openai';
import { v4 as uuidv4 } from 'uuid';

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
const BATCH_SIZE = 50; // Process 50 videos at a time
const RATE_LIMIT_PER_MINUTE = 400; // Stay under 500 RPM limit
const DELAY_BETWEEN_BATCHES = (60 / (RATE_LIMIT_PER_MINUTE / BATCH_SIZE)) * 1000; // ~7.5 seconds

// Worker state
let isRunning = false;
let currentJobId = null;
let processedCount = 0;
let failedCount = 0;
let startTime = null;

// System prompt for LLM
const SYSTEM_PROMPT = `Extract the core content from this YouTube description, ignoring all promotional material, links, and channel information.

Write 1-2 sentences describing what is demonstrated, taught, or shown. Start with an action verb (Building, Creating, Installing, etc.) or a noun phrase. 

CRITICAL: Never use the words "video", "tutorial", "channel", or any meta-references. Focus only on the actual content/techniques/outcomes.`;

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
    console.error(`Error generating summary for video ${video.id}:`, error.message);
    throw error;
  }
}

/**
 * Process a batch of videos
 */
async function processBatch(videos) {
  const results = [];
  
  for (const video of videos) {
    try {
      console.log(`Processing video ${video.id}: ${video.title}`);
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
      results.push({ videoId: video.id, success: true, summary });
      console.log(`✅ Generated summary for ${video.id}: "${summary.substring(0, 50)}..."`);
      
    } catch (error) {
      failedCount++;
      results.push({ videoId: video.id, success: false, error: error.message });
      console.error(`❌ Failed to process ${video.id}:`, error.message);
    }
  }
  
  return results;
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
  console.log('🚀 LLM Summary Worker started');
  isRunning = true;
  startTime = Date.now();
  processedCount = 0;
  failedCount = 0;
  
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
        rate: 0
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
      const batchResults = await processBatch(videos);
      
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
      console.log(`⏱️  ETA: ${Math.ceil(eta)} minutes`);
      console.log(`💰 Estimated cost: $${(processedCount * 0.000116).toFixed(2)} / $${(totalCount * 0.000116).toFixed(2)}`);
      
      // Rate limiting delay
      await new Promise(resolve => setTimeout(resolve, DELAY_BETWEEN_BATCHES));
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
            duration: Date.now() - startTime
          }
        })
        .eq('id', currentJobId);
    }
    
    isRunning = false;
    console.log(`\n✅ Worker completed. Processed: ${processedCount}, Failed: ${failedCount}`);
  }
}

/**
 * Graceful shutdown
 */
process.on('SIGINT', async () => {
  console.log('\n🛑 Shutdown signal received');
  isRunning = false;
  
  // Wait a bit for current operation to complete
  await new Promise(resolve => setTimeout(resolve, 2000));
  
  process.exit(0);
});

// Start the worker
console.log('Starting LLM Summary Worker...');
runWorker().catch(console.error);