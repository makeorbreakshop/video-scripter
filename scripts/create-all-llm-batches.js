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

async function createAllBatches() {
  console.log('📊 Creating ALL LLM summary batch files...\n');
  
  // Get total count first
  const { count: totalCount } = await supabase
    .from('videos')
    .select('*', { count: 'exact', head: true })
    .is('llm_summary', null)
    .neq('channel_name', 'Make or Break Shop');
  
  console.log(`Total videos needing summaries: ${totalCount}`);
  
  const BATCH_SIZE = 30000;
  const numBatches = Math.ceil(totalCount / BATCH_SIZE);
  
  console.log(`Will create ${numBatches} batch files\n`);
  
  // Create output directory
  const outputDir = path.join(process.cwd(), 'batch-jobs');
  await fs.mkdir(outputDir, { recursive: true });
  
  let totalCost = 0;
  let totalVideosProcessed = 0;
  
  // Process in batches to avoid memory issues
  for (let batchNum = 0; batchNum < numBatches; batchNum++) {
    console.log(`\nCreating batch ${batchNum + 1} of ${numBatches}...`);
    
    const videos = [];
    let lastId = null;
    const targetSize = Math.min(BATCH_SIZE, totalCount - totalVideosProcessed);
    
    // Fetch videos for this batch
    while (videos.length < targetSize) {
      let query = supabase
        .from('videos')
        .select('id, title, channel_name, description')
        .is('llm_summary', null)
        .neq('channel_name', 'Make or Break Shop')
        .order('id')
        .limit(Math.min(1000, targetSize - videos.length));
      
      if (lastId) {
        query = query.gt('id', lastId);
      }
      
      const { data, error } = await query;
      
      if (error) {
        console.error('Error fetching videos:', error);
        break;
      }
      
      if (!data || data.length === 0) break;
      
      videos.push(...data);
      lastId = data[data.length - 1].id;
      
      if (videos.length % 5000 === 0) {
        console.log(`  Fetched ${videos.length} videos for batch ${batchNum + 1}...`);
      }
    }
    
    if (videos.length === 0) {
      console.log('No more videos to process');
      break;
    }
    
    // Create batch file
    const filename = path.join(outputDir, `llm-summaries-batch-${batchNum + 1}.jsonl`);
    
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
    const batchCost = (videos.length * avgInputTokens / 1_000_000 * 0.15) + 
                      (videos.length * avgOutputTokens / 1_000_000 * 0.60);
    const discountedCost = batchCost * 0.5;
    totalCost += discountedCost;
    totalVideosProcessed += videos.length;
    
    console.log(`✅ Batch ${batchNum + 1}: ${videos.length} videos - $${discountedCost.toFixed(2)}`);
    console.log(`   File: ${path.basename(filename)}`);
    console.log(`   First ID: ${videos[0].id}`);
    console.log(`   Last ID: ${videos[videos.length - 1].id}`);
  }
  
  console.log('\n📊 FINAL SUMMARY:');
  console.log('================');
  console.log(`Total videos processed: ${totalVideosProcessed}`);
  console.log(`Number of batch files: ${numBatches}`);
  console.log(`Total estimated cost: $${totalCost.toFixed(2)} (with 50% batch discount)`);
  console.log('\nAll batch files created in: batch-jobs/');
}

createAllBatches().catch(console.error);