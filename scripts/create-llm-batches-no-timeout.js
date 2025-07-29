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

async function createBatchesNoTimeout() {
  console.log('📊 Creating LLM summary batch files...\n');
  
  const outputDir = path.join(process.cwd(), 'batch-jobs');
  await fs.mkdir(outputDir, { recursive: true });
  
  let batchNum = 1;
  let lastId = '';
  let totalVideos = 0;
  let totalCost = 0;
  
  while (true) {
    console.log(`\nCreating batch ${batchNum}...`);
    
    const batchVideos = [];
    const BATCH_SIZE = 30000;
    
    // Fetch videos in small chunks to avoid timeout
    while (batchVideos.length < BATCH_SIZE) {
      const query = supabase
        .from('videos')
        .select('id, title, channel_name, description')
        .is('llm_summary', null)
        .neq('channel_name', 'Make or Break Shop')
        .order('id')
        .limit(500) // Small chunks
        .gt('id', lastId);
      
      const { data, error } = await query;
      
      if (error) {
        console.error('Error:', error);
        break;
      }
      
      if (!data || data.length === 0) break;
      
      batchVideos.push(...data);
      lastId = data[data.length - 1].id;
      
      if (batchVideos.length >= BATCH_SIZE) {
        batchVideos.length = BATCH_SIZE; // Trim to exact size
        break;
      }
    }
    
    if (batchVideos.length === 0) {
      console.log('No more videos to process');
      break;
    }
    
    // Create batch file
    const filename = path.join(outputDir, `llm-summaries-batch-${batchNum}.jsonl`);
    
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
    
    totalVideos += batchVideos.length;
    totalCost += discountedCost;
    
    console.log(`✅ Batch ${batchNum}: ${batchVideos.length} videos - $${discountedCost.toFixed(2)}`);
    console.log(`   First ID: ${batchVideos[0].id}`);
    console.log(`   Last ID: ${batchVideos[batchVideos.length - 1].id}`);
    
    batchNum++;
    
    // Stop if we've processed less than a full batch (means we're done)
    if (batchVideos.length < BATCH_SIZE) {
      break;
    }
  }
  
  console.log('\n📊 SUMMARY:');
  console.log('===========');
  console.log(`Total videos: ${totalVideos}`);
  console.log(`Total batches: ${batchNum - 1}`);
  console.log(`Total cost: $${totalCost.toFixed(2)} (with 50% batch discount)`);
  console.log('\nBatch files created in: batch-jobs/');
  console.log('\nTo submit to OpenAI, run: node scripts/submit-llm-batches.js');
}

createBatchesNoTimeout().catch(console.error);