#!/usr/bin/env node

import { config } from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import OpenAI from 'openai';
import { Pinecone } from '@pinecone-database/pinecone';
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

const pinecone = new Pinecone({
  apiKey: process.env.PINECONE_API_KEY,
});

// Worker configuration
const BATCH_SIZE = 200; // Fetch 200 videos at a time
const CONCURRENT_REQUESTS = 20; // Process 20 embeddings in parallel
const EMBEDDING_BATCH_SIZE = 50; // OpenAI embedding batch size
const PINECONE_BATCH_SIZE = 100; // Pinecone upsert batch size
const NAMESPACE = 'llm-summaries'; // Different namespace for summaries

// Create limiters
const limit = pLimit(CONCURRENT_REQUESTS);

// Worker state
let isRunning = false;
let currentJobId = null;
let processedCount = 0;
let failedCount = 0;
let startTime = null;

/**
 * Generate embeddings for multiple summaries
 */
async function generateBatchEmbeddings(summaries) {
  try {
    const response = await openai.embeddings.create({
      model: 'text-embedding-3-small',
      input: summaries,
      dimensions: 512 // Match title embeddings dimension
    });
    
    return response.data.map(item => item.embedding);
  } catch (error) {
    console.error('Error generating embeddings:', error);
    throw error;
  }
}

/**
 * Check if worker should continue
 */
async function shouldContinue() {
  const { data: control } = await supabase
    .from('worker_control')
    .select('is_enabled')
    .eq('worker_type', 'llm_summary_vectorization')
    .single();
  
  return control?.is_enabled && isRunning;
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
 * Main worker loop
 */
async function runWorker() {
  console.log('🚀 LLM Summary Vectorization Worker started');
  console.log(`📍 Using namespace: ${NAMESPACE} in index: ${process.env.PINECONE_INDEX_NAME}`);
  console.log(`⚡ Config: ${CONCURRENT_REQUESTS} parallel, batch size ${BATCH_SIZE}`);
  
  isRunning = true;
  startTime = Date.now();
  processedCount = 0;
  failedCount = 0;
  
  // Create a job record
  const { data: job } = await supabase
    .from('jobs')
    .insert({
      id: uuidv4(),
      type: 'llm_summary_vectorization',
      status: 'processing',
      created_at: new Date().toISOString(),
      data: {
        totalVideos: 0,
        processed: 0,
        failed: 0,
        rate: 0,
        namespace: NAMESPACE
      }
    })
    .select()
    .single();
  
  currentJobId = job?.id;
  
  try {
    // Initialize Pinecone index
    const index = pinecone.index(process.env.PINECONE_INDEX_NAME);
    const namespaceIndex = index.namespace(NAMESPACE);
    
    // Get total count of videos with summaries but no embeddings
    const { count: totalCount } = await supabase
      .from('videos')
      .select('*', { count: 'exact', head: true })
      .not('llm_summary', 'is', null)
      .or('llm_summary_embedding_synced.is.null,llm_summary_embedding_synced.eq.false');
    
    console.log(`📊 Found ${totalCount} summaries needing embeddings`);
    
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
      // Fetch next batch of videos with summaries
      const { data: videos, error } = await supabase
        .from('videos')
        .select('id, title, channel_name, llm_summary, view_count, published_at')
        .not('llm_summary', 'is', null)
        .or('llm_summary_embedding_synced.is.null,llm_summary_embedding_synced.eq.false')
        .gt('id', lastId)
        .order('id')
        .limit(BATCH_SIZE);
      
      if (error) {
        console.error('Error fetching videos:', error);
        break;
      }
      
      if (!videos || videos.length === 0) {
        console.log('✅ No more summaries to process');
        break;
      }
      
      console.log(`\n📦 Processing batch of ${videos.length} summaries...`);
      
      // Process in smaller batches for embeddings
      for (let i = 0; i < videos.length; i += EMBEDDING_BATCH_SIZE) {
        const batch = videos.slice(i, i + EMBEDDING_BATCH_SIZE);
        
        try {
          // Generate embeddings for this batch
          const summaries = batch.map(v => v.llm_summary);
          const embeddings = await generateBatchEmbeddings(summaries);
          
          // Prepare vectors for Pinecone
          const vectors = batch.map((video, idx) => ({
            id: video.id,
            values: embeddings[idx],
            metadata: {
              title: video.title,
              channel_name: video.channel_name,
              summary: video.llm_summary.substring(0, 360), // Truncate for metadata
              view_count: video.view_count || 0,
              published_at: video.published_at,
              embedding_type: 'llm_summary',
              embedding_version: 'v1'
            }
          }));
          
          // Upsert to Pinecone in the llm-summaries namespace
          await namespaceIndex.upsert(vectors);
          
          // Update database to mark summaries as embedded
          const videoIds = batch.map(v => v.id);
          const { error: updateError } = await supabase
            .from('videos')
            .update({ 
              llm_summary_embedding_synced: true 
            })
            .in('id', videoIds);
          
          if (updateError) {
            console.error('Error updating database:', updateError);
            failedCount += batch.length;
          } else {
            processedCount += batch.length;
            console.log(`✅ Embedded ${batch.length} summaries (${processedCount} total)`);
          }
          
        } catch (error) {
          console.error(`❌ Failed to process batch:`, error);
          failedCount += batch.length;
        }
        
        // Brief pause between embedding batches
        await new Promise(resolve => setTimeout(resolve, 100));
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
      console.log(`⚡ Rate: ${rate.toFixed(0)} summaries/minute`);
      console.log(`⏱️  ETA: ${Math.ceil(eta)} minutes (${(eta/60).toFixed(1)} hours)`);
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
    console.log(`⚡ Average rate: ${finalRate.toFixed(0)} summaries/minute`);
    console.log(`⏱️  Total time: ${totalTime.toFixed(1)} minutes`);
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
console.log('Starting LLM Summary Vectorization Worker...');
runWorker().catch(console.error);