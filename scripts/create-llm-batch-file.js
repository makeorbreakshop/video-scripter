#!/usr/bin/env node

import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import fs from 'fs/promises';
import path from 'path';

dotenv.config();

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const ACTION_FIRST_PROMPT = `Extract the core content from this YouTube description, ignoring all promotional material, links, and channel information.

Write 1-2 sentences describing what is demonstrated, taught, or shown. Start with an action verb (Building, Creating, Installing, etc.) or a noun phrase. 

CRITICAL: Never use the words "video", "tutorial", "channel", or any meta-references. Focus only on the actual content/techniques/outcomes.`;

async function createBatchFile(offset = 0, limit = 30000) {
  console.log(`📊 Creating batch file for videos ${offset} to ${offset + limit}...\n`);
  
  // Get count first (excluding only Make or Break Shop)
  const { count } = await supabase
    .from('videos')
    .select('*', { count: 'exact', head: true })
    .is('llm_summary', null)
    .neq('channel_name', 'Make or Break Shop');
    
  console.log(`Total videos without summaries (excluding Make or Break Shop): ${count}`);
  
  // Get videos in batches due to Supabase's 1000 row limit
  let allVideos = [];
  let currentOffset = offset;
  const batchSize = 1000;
  
  console.log('Fetching videos in batches...');
  
  while (allVideos.length < limit && currentOffset < offset + limit) {
    const { data: batch, error } = await supabase
      .from('videos')
      .select('id, title, channel_name, description')
      .is('llm_summary', null)
      .neq('channel_name', 'Make or Break Shop')
      .range(currentOffset, currentOffset + batchSize - 1);
    
    if (error) {
      console.error('Error:', error);
      break;
    }
    
    if (!batch || batch.length === 0) break;
    
    allVideos = allVideos.concat(batch);
    currentOffset += batchSize;
    
    if (allVideos.length % 10000 === 0) {
      console.log(`  Fetched ${allVideos.length} videos...`);
    }
  }
  
  const videos = allVideos.slice(0, limit);
  
  // Filter for substantial descriptions
  const validVideos = videos.filter(v => v.description && v.description.length >= 50);
  console.log(`Found ${validVideos.length} videos with valid descriptions`);
  
  if (validVideos.length === 0) {
    console.log('No videos to process');
    return;
  }
  
  // Create output directory
  const outputDir = path.join(process.cwd(), 'batch-jobs');
  await fs.mkdir(outputDir, { recursive: true });
  
  // Create JSONL file
  const batchNumber = Math.floor(offset / limit) + 1;
  const filename = path.join(outputDir, `llm-summaries-batch-${batchNumber}.jsonl`);
  
  const lines = validVideos.map(video => {
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
  console.log(`✅ Created ${filename}`);
  
  // Calculate cost
  const avgInputTokens = 575;
  const avgOutputTokens = 50;
  const totalCost = (validVideos.length * avgInputTokens / 1_000_000 * 0.15) + 
                    (validVideos.length * avgOutputTokens / 1_000_000 * 0.60);
  const batchCost = totalCost * 0.5;
  
  console.log(`Videos in batch: ${validVideos.length}`);
  console.log(`Estimated cost: $${batchCost.toFixed(2)} (with batch discount)`);
  
  // Save metadata
  const metadata = {
    batchNumber,
    offset,
    limit,
    videoCount: validVideos.length,
    filename: path.basename(filename),
    createdAt: new Date().toISOString(),
    estimatedCost: batchCost
  };
  
  await fs.writeFile(
    path.join(outputDir, `batch-${batchNumber}-metadata.json`),
    JSON.stringify(metadata, null, 2)
  );
  
  return metadata;
}

// Run with optional parameters
const offset = parseInt(process.argv[2]) || 0;
const limit = parseInt(process.argv[3]) || 30000;

createBatchFile(offset, limit).catch(console.error);