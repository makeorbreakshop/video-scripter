#!/usr/bin/env node

import { createClient } from '@supabase/supabase-js';
import OpenAI from 'openai';
import dotenv from 'dotenv';
import fs from 'fs/promises';
import path from 'path';

dotenv.config();

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// The refined prompt
const ACTION_FIRST_PROMPT = `Extract the core content from this YouTube description, ignoring all promotional material, links, and channel information.

Write 1-2 sentences describing what is demonstrated, taught, or shown. Start with an action verb (Building, Creating, Installing, etc.) or a noun phrase. 

CRITICAL: Never use the words "video", "tutorial", "channel", or any meta-references. Focus only on the actual content/techniques/outcomes.`;

async function createBatchFiles() {
  console.log('📊 Fetching videos that need LLM summaries...');
  
  // Get all videos without summaries that have descriptions
  // First get count
  const { count } = await supabase
    .from('videos')
    .select('*', { count: 'exact', head: true })
    .is('llm_summary', null);
    
  // Get videos in batches to handle large dataset
  console.log('Fetching all videos without summaries...');
  let allVideos = [];
  let lastId = '';
  const batchSize = 1000; // Supabase limit
  
  while (true) {
    let query = supabase
      .from('videos')
      .select('id, title, channel_name, description, view_count')
      .is('llm_summary', null)
      .order('id', { ascending: true })
      .limit(batchSize);
      
    if (lastId) {
      query = query.gt('id', lastId);
    }
    
    const { data: batch, error } = await query;
      
    if (error) {
      console.error('Error fetching videos:', error);
      return;
    }
    
    if (!batch || batch.length === 0) break;
    
    allVideos = allVideos.concat(batch);
    lastId = batch[batch.length - 1].id;
    
    if (allVideos.length % 10000 === 0) {
      console.log(`Fetched ${allVideos.length} videos...`);
    }
    
    if (batch.length < batchSize) break;
  }
  
  // Sort by view count after fetching all
  console.log('Sorting by view count...');
  allVideos.sort((a, b) => (b.view_count || 0) - (a.view_count || 0));
  
  // Filter for videos with substantial descriptions
  const videos = allVideos.filter(v => v.description && v.description.length >= 50);
  
  console.log(`Found ${count} videos without summaries (total)`);
  console.log(`Found ${videos.length} videos with descriptions >= 50 chars`);
  
  // OpenAI Batch API has a limit of 50,000 requests per file
  // We'll use 30,000 for safety
  const BATCH_SIZE = 30000;
  const batches = [];
  
  for (let i = 0; i < videos.length; i += BATCH_SIZE) {
    const batch = videos.slice(i, i + BATCH_SIZE);
    batches.push(batch);
  }
  
  console.log(`Creating ${batches.length} batch files...`);
  
  // Create output directory
  const outputDir = path.join(process.cwd(), 'batch-jobs');
  await fs.mkdir(outputDir, { recursive: true });
  
  const batchFiles = [];
  
  for (let i = 0; i < batches.length; i++) {
    const batch = batches[i];
    const filename = path.join(outputDir, `llm-summaries-batch-${i + 1}.jsonl`);
    
    // Create JSONL file with requests
    const lines = batch.map(video => {
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
    console.log(`✅ Created ${filename} with ${batch.length} requests`);
    
    batchFiles.push({
      filename,
      videoCount: batch.length
    });
  }
  
  return batchFiles;
}

async function submitBatches(batchFiles) {
  console.log('\n🚀 Submitting batches to OpenAI...');
  
  const submittedBatches = [];
  
  for (const { filename, videoCount } of batchFiles) {
    try {
      // Upload the file
      const file = await openai.files.create({
        file: await fs.readFile(filename),
        purpose: 'batch'
      });
      
      console.log(`📤 Uploaded file: ${file.id}`);
      
      // Create the batch
      const batch = await openai.batches.create({
        input_file_id: file.id,
        endpoint: '/v1/chat/completions',
        completion_window: '24h',
        metadata: {
          description: `LLM summaries for ${videoCount} videos`,
          filename: path.basename(filename)
        }
      });
      
      console.log(`✅ Submitted batch: ${batch.id}`);
      console.log(`   Status: ${batch.status}`);
      console.log(`   Videos: ${videoCount}`);
      
      submittedBatches.push({
        batchId: batch.id,
        fileId: file.id,
        filename,
        videoCount,
        status: batch.status
      });
      
      // Small delay between submissions
      await new Promise(resolve => setTimeout(resolve, 2000));
      
    } catch (error) {
      console.error(`❌ Error submitting ${filename}:`, error);
    }
  }
  
  // Save batch info for later retrieval
  const batchInfo = {
    submittedAt: new Date().toISOString(),
    totalVideos: submittedBatches.reduce((sum, b) => sum + b.videoCount, 0),
    batches: submittedBatches
  };
  
  await fs.writeFile(
    path.join(process.cwd(), 'batch-jobs', 'batch-info.json'),
    JSON.stringify(batchInfo, null, 2)
  );
  
  return batchInfo;
}

async function estimateCost(videoCount) {
  // Rough estimates
  const avgInputTokensPerVideo = 575;
  const avgOutputTokensPerVideo = 50;
  
  const totalInputTokens = videoCount * avgInputTokensPerVideo;
  const totalOutputTokens = videoCount * avgOutputTokensPerVideo;
  
  const inputCost = (totalInputTokens / 1_000_000) * 0.15;
  const outputCost = (totalOutputTokens / 1_000_000) * 0.60;
  const totalCost = inputCost + outputCost;
  
  return {
    regularCost: totalCost,
    batchCost: totalCost * 0.5,
    savings: totalCost * 0.5
  };
}

async function main() {
  console.log('🤖 LLM Summary Batch Submission Tool\n');
  
  // Create batch files
  const batchFiles = await createBatchFiles();
  
  if (!batchFiles || batchFiles.length === 0) {
    console.log('No batches to process');
    return;
  }
  
  // Calculate costs
  const totalVideos = batchFiles.reduce((sum, b) => sum + b.videoCount, 0);
  const costs = await estimateCost(totalVideos);
  
  console.log('\n💰 Cost Estimate:');
  console.log(`   Videos: ${totalVideos.toLocaleString()}`);
  console.log(`   Regular cost: $${costs.regularCost.toFixed(2)}`);
  console.log(`   Batch cost: $${costs.batchCost.toFixed(2)}`);
  console.log(`   Savings: $${costs.savings.toFixed(2)}`);
  
  // Confirm before submitting
  console.log('\n⚠️  Ready to submit batches. This will cost approximately $' + costs.batchCost.toFixed(2));
  console.log('Press Ctrl+C to cancel, or wait 5 seconds to continue...');
  
  await new Promise(resolve => setTimeout(resolve, 5000));
  
  // Submit batches
  const batchInfo = await submitBatches(batchFiles);
  
  console.log('\n✅ All batches submitted successfully!');
  console.log(`Total batches: ${batchInfo.batches.length}`);
  console.log(`Total videos: ${batchInfo.totalVideos}`);
  console.log('\nBatch IDs:');
  batchInfo.batches.forEach(b => {
    console.log(`  ${b.batchId} (${b.videoCount} videos)`);
  });
  
  console.log('\n📝 Batch info saved to: batch-jobs/batch-info.json');
  console.log('Use the check-batch-status.js script to monitor progress');
}

main().catch(console.error);