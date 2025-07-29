#!/usr/bin/env node

import OpenAI from 'openai';
import fs from 'fs';
import dotenv from 'dotenv';

dotenv.config({ path: '.env' });

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

async function submitFinalBatches() {
  console.log('🚀 Submitting final batches (4-6)...\n');
  
  for (let i = 4; i <= 6; i++) {
    const filename = `batch-jobs/llm-summaries-batch-${i}.jsonl`;
    
    console.log(`📤 Submitting batch ${i}...`);
    
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
          description: `LLM summaries batch ${i} of 6`
        }
      });
      
      console.log(`✅ Batch ${i}: ${batch.id} (${batch.status})`);
      
      await new Promise(resolve => setTimeout(resolve, 2000));
      
    } catch (error) {
      console.error(`❌ Batch ${i} failed:`, error.message);
      break;
    }
  }
  
  console.log('\n✅ Done!');
}

submitFinalBatches().catch(console.error);