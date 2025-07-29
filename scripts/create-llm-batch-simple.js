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

async function createBatchFiles() {
  console.log('📊 Creating LLM summary batch files...\n');
  
  // Fetch ALL videos without summaries
  console.log('Fetching all videos without summaries...');
  
  const allVideos = [];
  let lastId = null;
  
  while (true) {
    let query = supabase
      .from('videos')
      .select('id, title, channel_name, description')
      .is('llm_summary', null)
      .neq('channel_name', 'Make or Break Shop')
      .order('id')
      .limit(1000);
    
    if (lastId) {
      query = query.gt('id', lastId);
    }
    
    const { data, error } = await query;
    
    if (error) {
      console.error('Error:', error);
      break;
    }
    
    if (!data || data.length === 0) break;
    
    allVideos.push(...data);
    lastId = data[data.length - 1].id;
    
    if (allVideos.length % 10000 === 0) {
      console.log(`  Fetched ${allVideos.length} videos...`);
    }
  }
  
  console.log(`Total videos fetched: ${allVideos.length}`);
  
  // Create output directory
  const outputDir = path.join(process.cwd(), 'batch-jobs');
  await fs.mkdir(outputDir, { recursive: true });
  
  // Split into batches of 30,000
  const BATCH_SIZE = 30000;
  const numBatches = Math.ceil(allVideos.length / BATCH_SIZE);
  
  console.log(`\nCreating ${numBatches} batch files...`);
  
  let totalCost = 0;
  
  for (let i = 0; i < numBatches; i++) {
    const start = i * BATCH_SIZE;
    const end = Math.min(start + BATCH_SIZE, allVideos.length);
    const batchVideos = allVideos.slice(start, end);
    
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
    
    // Calculate cost (rough estimate)
    const avgInputTokens = 575;
    const avgOutputTokens = 50;
    const batchCost = (batchVideos.length * avgInputTokens / 1_000_000 * 0.15) + 
                      (batchVideos.length * avgOutputTokens / 1_000_000 * 0.60);
    const discountedCost = batchCost * 0.5; // 50% batch discount
    totalCost += discountedCost;
    
    console.log(`✅ Batch ${i + 1}: ${batchVideos.length} videos - $${discountedCost.toFixed(2)}`);
  }
  
  console.log('\n📊 SUMMARY:');
  console.log('===========');
  console.log(`Total videos: ${allVideos.length}`);
  console.log(`Number of batches: ${numBatches}`);
  console.log(`Total estimated cost: $${totalCost.toFixed(2)} (with 50% batch discount)`);
  console.log('\nBatch files created in: batch-jobs/');
}

createBatchFiles().catch(console.error);