#!/usr/bin/env node

import { createClient } from '@supabase/supabase-js';
import OpenAI from 'openai';
import dotenv from 'dotenv';
import fs from 'fs/promises';
import path from 'path';

dotenv.config({ path: '.env' });

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

async function createAndSubmitBatches() {
  console.log('📊 Creating and submitting LLM summary batches...\n');
  
  // First, get all video IDs that need summaries
  console.log('Step 1: Fetching all video IDs that need summaries...');
  
  const allVideos = [];
  let lastId = null;
  
  while (true) {
    let query = supabase
      .from('videos')
      .select('id')
      .is('llm_summary', null)
      .neq('channel_name', 'Make or Break Shop')
      .order('id')
      .limit(10000); // Larger batches for just IDs
    
    if (lastId) {
      query = query.gt('id', lastId);
    }
    
    const { data, error } = await query;
    
    if (error) {
      console.error('Error fetching IDs:', error);
      break;
    }
    
    if (!data || data.length === 0) break;
    
    allVideos.push(...data.map(v => v.id));
    lastId = data[data.length - 1].id;
    
    console.log(`  Fetched ${allVideos.length} video IDs...`);
  }
  
  console.log(`\nTotal videos needing summaries: ${allVideos.length}`);
  
  // Now fetch details in chunks and create batch files
  const BATCH_SIZE = 30000;
  const numBatches = Math.ceil(allVideos.length / BATCH_SIZE);
  
  console.log(`\nStep 2: Creating ${numBatches} batch files...\n`);
  
  const outputDir = path.join(process.cwd(), 'batch-jobs');
  await fs.mkdir(outputDir, { recursive: true });
  
  let totalCost = 0;
  const submittedBatches = [];
  
  for (let i = 0; i < numBatches; i++) {
    const start = i * BATCH_SIZE;
    const end = Math.min(start + BATCH_SIZE, allVideos.length);
    const batchIds = allVideos.slice(start, end);
    
    console.log(`Processing batch ${i + 1} of ${numBatches} (${batchIds.length} videos)...`);
    
    // Fetch video details for this batch
    const batchVideos = [];
    
    // Process in chunks of 1000 to avoid query limits
    for (let j = 0; j < batchIds.length; j += 1000) {
      const chunkIds = batchIds.slice(j, j + 1000);
      
      const { data, error } = await supabase
        .from('videos')
        .select('id, title, channel_name, description')
        .in('id', chunkIds);
      
      if (error) {
        console.error('Error fetching video details:', error);
        continue;
      }
      
      batchVideos.push(...data);
    }
    
    // Create batch file
    const filename = path.join(outputDir, `llm-summaries-batch-${i + 1}.jsonl`);
    
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
              content: `Title: ${video.title}\nChannel: ${video.channel_name}\nDescription: ${video.description || 'No description'}`
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
    
    console.log(`  ✅ Created ${path.basename(filename)} - ${batchVideos.length} videos - $${discountedCost.toFixed(2)}`);
    
    // Submit to OpenAI immediately
    console.log(`  📤 Submitting batch ${i + 1} to OpenAI...`);
    
    try {
      const fileStream = await fs.readFile(filename);
      const file = await openai.files.create({
        file: fileStream,
        purpose: 'batch'
      });
      
      const batch = await openai.batches.create({
        input_file_id: file.id,
        endpoint: '/v1/chat/completions',
        completion_window: '24h',
        metadata: {
          description: `LLM summaries batch ${i + 1} - ${batchVideos.length} videos`
        }
      });
      
      console.log(`  ✅ Submitted! Batch ID: ${batch.id}\n`);
      
      submittedBatches.push({
        batchNumber: i + 1,
        batchId: batch.id,
        videoCount: batchVideos.length,
        cost: discountedCost
      });
      
    } catch (error) {
      console.error(`  ❌ Error submitting batch ${i + 1}:`, error.message);
    }
  }
  
  console.log('\n📊 FINAL SUMMARY:');
  console.log('================');
  console.log(`Total videos processed: ${allVideos.length}`);
  console.log(`Batches submitted: ${submittedBatches.length}`);
  console.log(`Total estimated cost: $${totalCost.toFixed(2)} (with 50% batch discount)`);
  
  console.log('\n📋 Submitted Batches:');
  submittedBatches.forEach(b => {
    console.log(`  Batch ${b.batchNumber}: ${b.batchId} (${b.videoCount} videos - $${b.cost.toFixed(2)})`);
  });
  
  // Save batch metadata
  await fs.writeFile(
    path.join(outputDir, 'submitted-batches.json'),
    JSON.stringify({
      totalVideos: allVideos.length,
      totalCost: totalCost,
      submittedAt: new Date().toISOString(),
      batches: submittedBatches
    }, null, 2)
  );
}

createAndSubmitBatches().catch(console.error);