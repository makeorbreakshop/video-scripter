#!/usr/bin/env node

import OpenAI from 'openai';
import fs from 'fs';
import dotenv from 'dotenv';

dotenv.config({ path: '.env' });

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

async function submitAll() {
  for (let i = 1; i <= 6; i++) {
    const filename = `batch-jobs/llm-summaries-batch-${i}.jsonl`;
    
    console.log(`\nSubmitting batch ${i}...`);
    
    try {
      const file = await openai.files.create({
        file: fs.createReadStream(filename),
        purpose: 'batch'
      });
      
      const batch = await openai.batches.create({
        input_file_id: file.id,
        endpoint: '/v1/chat/completions',
        completion_window: '24h',
        metadata: {
          description: `LLM summaries batch ${i}`
        }
      });
      
      console.log(`✅ Batch ${i}: ${batch.id}`);
      console.log(`   Status: ${batch.status}`);
      
    } catch (error) {
      console.error(`❌ Batch ${i} failed:`, error.message);
    }
    
    // Small delay between submissions
    await new Promise(resolve => setTimeout(resolve, 2000));
  }
  
  console.log('\n✅ Done! All batches submitted.');
}

submitAll().catch(console.error);