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

const ACTION_FIRST_PROMPT = `Extract the core content from this YouTube description, ignoring all promotional material, links, and channel information.

Write 1-2 sentences describing what is demonstrated, taught, or shown. Start with an action verb (Building, Creating, Installing, etc.) or a noun phrase. 

CRITICAL: Never use the words "video", "tutorial", "channel", or any meta-references. Focus only on the actual content/techniques/outcomes.`;

async function createAndSubmitBatch(limit = 30000) {
  console.log('📊 Creating batch for up to', limit, 'videos...\n');
  
  // Get videos that need summaries
  console.log('Fetching videos...');
  let videos = [];
  let lastId = '';
  const fetchBatchSize = 1000;
  
  while (videos.length < limit) {
    let query = supabase
      .from('videos')
      .select('id, title, channel_name, description, view_count')
      .is('llm_summary', null)
      .order('view_count', { ascending: false })
      .limit(fetchBatchSize);
      
    if (lastId) {
      query = query.gt('id', lastId);
    }
    
    const { data: batch, error } = await query;
    
    if (error) {
      console.error('Error:', error);
      break;
    }
    
    if (!batch || batch.length === 0) break;
    
    // Filter for substantial descriptions
    const validVideos = batch.filter(v => v.description && v.description.length >= 50);
    videos = videos.concat(validVideos);
    
    lastId = batch[batch.length - 1].id;
    
    if (videos.length % 5000 === 0) {
      console.log(`Found ${videos.length} valid videos...`);
    }
    
    if (batch.length < fetchBatchSize) break;
  }
  
  // Limit to batch size
  videos = videos.slice(0, limit);
  console.log(`\nProcessing ${videos.length} videos`);
  
  if (videos.length === 0) {
    console.log('No videos to process');
    return;
  }
  
  // Create output directory
  const outputDir = path.join(process.cwd(), 'batch-jobs');
  await fs.mkdir(outputDir, { recursive: true });
  
  // Create JSONL file
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const filename = path.join(outputDir, `llm-summaries-${timestamp}.jsonl`);
  
  const lines = videos.map(video => {
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
  console.log(`✅ Created batch file with ${videos.length} requests`);
  
  // Calculate cost
  const avgInputTokens = 575;
  const avgOutputTokens = 50;
  const totalCost = (videos.length * avgInputTokens / 1_000_000 * 0.15) + 
                    (videos.length * avgOutputTokens / 1_000_000 * 0.60);
  const batchCost = totalCost * 0.5;
  
  console.log(`\n💰 Cost estimate: $${batchCost.toFixed(2)} (with batch discount)`);
  
  // Submit to OpenAI
  console.log('\n🚀 Submitting to OpenAI...');
  
  try {
    // Upload file
    const file = await openai.files.create({
      file: await fs.readFile(filename),
      purpose: 'batch'
    });
    
    console.log(`📤 Uploaded file: ${file.id}`);
    
    // Create batch
    const batch = await openai.batches.create({
      input_file_id: file.id,
      endpoint: '/v1/chat/completions',
      completion_window: '24h',
      metadata: {
        description: `LLM summaries for ${videos.length} videos`,
        filename: path.basename(filename),
        timestamp
      }
    });
    
    console.log(`\n✅ Batch submitted successfully!`);
    console.log(`Batch ID: ${batch.id}`);
    console.log(`Status: ${batch.status}`);
    
    // Save batch info
    const batchInfo = {
      batchId: batch.id,
      fileId: file.id,
      filename,
      videoCount: videos.length,
      submittedAt: new Date().toISOString(),
      estimatedCost: batchCost
    };
    
    await fs.writeFile(
      path.join(outputDir, `batch-${batch.id}-info.json`),
      JSON.stringify(batchInfo, null, 2)
    );
    
    console.log(`\n📝 Batch info saved to: batch-${batch.id}-info.json`);
    console.log('\nUse check-batch-status.js to monitor progress');
    
  } catch (error) {
    console.error('❌ Error submitting batch:', error);
  }
}

// Run with optional limit parameter
const limit = parseInt(process.argv[2]) || 30000;
createAndSubmitBatch(limit).catch(console.error);