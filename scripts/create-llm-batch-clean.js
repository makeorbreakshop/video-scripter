#!/usr/bin/env node

import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import fs from 'fs/promises';
import path from 'path';

dotenv.config({ path: '.env' });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const ACTION_FIRST_PROMPT = `Extract the core content from this YouTube description, ignoring all promotional material, links, and channel information.

Write 1-2 sentences describing what is demonstrated, taught, or shown. Start with an action verb (Building, Creating, Installing, etc.) or a noun phrase. 

CRITICAL: Never use the words "video", "tutorial", "channel", or any meta-references. Focus only on the actual content/techniques/outcomes.`;

async function createImprovedBatchFiles() {
  console.log('📊 Creating improved batch files for LLM summaries...\n');
  
  // First, get ALL eligible videos
  console.log('Fetching all videos without summaries...');
  
  let allVideos = [];
  let lastId = '';
  const batchSize = 1000; // Supabase limit
  let iteration = 0;
  
  // Use cursor-based pagination to avoid timeouts and ensure no duplicates
  while (true) {
    iteration++;
    let query = supabase
      .from('videos')
      .select('id, title, channel_name, description')
      .is('llm_summary', null)
      .neq('channel_name', 'Make or Break Shop')
      .not('description', 'is', null)
      .neq('description', '')
      .order('id')
      .limit(batchSize);
    
    // Use cursor for pagination after first batch
    if (lastId) {
      query = query.gt('id', lastId);
    }
    
    const { data: batch, error } = await query;
    
    if (error) {
      console.error('Error fetching videos:', error);
      break;
    }
    
    if (!batch || batch.length === 0) break;
    
    allVideos = allVideos.concat(batch);
    lastId = batch[batch.length - 1].id;
    
    if (allVideos.length % 10000 === 0 || batch.length < batchSize) {
      console.log(`  Fetched ${allVideos.length} videos... (iteration ${iteration})`);
    }
    
    if (batch.length < batchSize) break; // Last batch
  }
  
  console.log(`\nTotal videos fetched: ${allVideos.length}`);
  
  // Filter for substantial descriptions
  const validVideos = allVideos.filter(v => v.description && v.description.length >= 50);
  console.log(`Videos with valid descriptions (50+ chars): ${validVideos.length}`);
  
  // Remove any duplicates (shouldn't be any, but just in case)
  const uniqueVideos = [];
  const seenIds = new Set();
  
  for (const video of validVideos) {
    if (!seenIds.has(video.id)) {
      seenIds.add(video.id);
      uniqueVideos.push(video);
    }
  }
  
  console.log(`Unique videos after deduplication: ${uniqueVideos.length}`);
  
  if (uniqueVideos.length === 0) {
    console.log('No videos to process');
    return;
  }
  
  // Create output directory
  const outputDir = path.join(process.cwd(), 'batch-jobs');
  await fs.mkdir(outputDir, { recursive: true });
  
  // Split into batches of 30,000
  const VIDEOS_PER_BATCH = 30000;
  const numBatches = Math.ceil(uniqueVideos.length / VIDEOS_PER_BATCH);
  
  console.log(`\nCreating ${numBatches} batch files...`);
  
  let totalCost = 0;
  const batchMetadata = [];
  
  for (let i = 0; i < numBatches; i++) {
    const start = i * VIDEOS_PER_BATCH;
    const end = Math.min(start + VIDEOS_PER_BATCH, uniqueVideos.length);
    const batchVideos = uniqueVideos.slice(start, end);
    
    const filename = path.join(outputDir, `llm-summaries-batch-${i + 1}-clean.jsonl`);
    
    const lines = batchVideos.map(video => {
      const request = {
        custom_id: video.id,
        method: "POST",
        url: "/v1/chat/completions",
        body: {
          model: "gpt-4o-mini",
          messages: [
            {
              role: "system",
              content: ACTION_FIRST_PROMPT
            },
            {
              role: "user",
              content: `Title: ${video.title}\nChannel: ${video.channel_name}\nDescription: ${video.description?.substring(0, 2000) || 'No description'}`
            }
          ],
          temperature: 0.3,
          max_tokens: 100
        }
      };
      
      return JSON.stringify(request);
    });
    
    await fs.writeFile(filename, lines.join('\n'));
    
    // Calculate cost
    const avgInputTokens = 575;
    const avgOutputTokens = 50;
    const batchCost = (batchVideos.length * avgInputTokens / 1_000_000 * 0.15) + 
                      (batchVideos.length * avgOutputTokens / 1_000_000 * 0.60);
    const discountedCost = batchCost * 0.5;
    totalCost += discountedCost;
    
    const metadata = {
      batchNumber: i + 1,
      startIndex: start,
      endIndex: end,
      videoCount: batchVideos.length,
      filename: path.basename(filename),
      createdAt: new Date().toISOString(),
      estimatedCost: discountedCost,
      firstVideoId: batchVideos[0].id,
      lastVideoId: batchVideos[batchVideos.length - 1].id
    };
    
    batchMetadata.push(metadata);
    
    console.log(`✅ Batch ${i + 1}: ${batchVideos.length} videos - $${discountedCost.toFixed(2)}`);
  }
  
  // Save overall metadata
  const overallMetadata = {
    totalVideos: uniqueVideos.length,
    numBatches,
    batches: batchMetadata,
    totalEstimatedCost: totalCost,
    createdAt: new Date().toISOString()
  };
  
  await fs.writeFile(
    path.join(outputDir, 'llm-summaries-metadata.json'),
    JSON.stringify(overallMetadata, null, 2)
  );
  
  console.log('\n📊 SUMMARY:');
  console.log('===========');
  console.log(`Total unique videos: ${uniqueVideos.length}`);
  console.log(`Number of batches: ${numBatches}`);
  console.log(`Total estimated cost: $${totalCost.toFixed(2)} (with 50% batch discount)`);
  console.log('\nBatch files created in: batch-jobs/');
  console.log('\nNext step: Submit these files to OpenAI Batch API');
}

createImprovedBatchFiles().catch(console.error);