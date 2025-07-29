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

async function fetchAllVideoIds() {
  console.log('📊 Step 1: Fetching all video IDs that need LLM summaries...\n');
  
  const allVideos = [];
  let lastId = null;
  
  while (true) {
    let query = supabase
      .from('videos')
      .select('id')
      .is('llm_summary', null)
      .neq('channel_name', 'Make or Break Shop')
      .order('id')
      .limit(10000);
    
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
    
    if (allVideos.length % 20000 === 0) {
      console.log(`  Fetched ${allVideos.length} video IDs...`);
    }
  }
  
  console.log(`\n✅ Total videos needing summaries: ${allVideos.length}`);
  
  // Save IDs to file
  const outputDir = path.join(process.cwd(), 'batch-jobs');
  await fs.mkdir(outputDir, { recursive: true });
  
  const filename = path.join(outputDir, 'video-ids-for-llm.json');
  await fs.writeFile(filename, JSON.stringify(allVideos, null, 2));
  
  console.log(`\n📁 Saved video IDs to: ${filename}`);
  console.log('\nNext: Run create-llm-batches-step2.js to create batch files');
  
  return allVideos.length;
}

fetchAllVideoIds().catch(console.error);