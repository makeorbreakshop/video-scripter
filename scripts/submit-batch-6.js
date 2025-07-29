#!/usr/bin/env node

import OpenAI from 'openai';
import fs from 'fs';
import dotenv from 'dotenv';

dotenv.config({ path: '.env' });

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const filename = 'batch-jobs/llm-summaries-batch-6.jsonl';

console.log('📤 Submitting batch 6...');

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
      description: 'LLM summaries batch 6 of 6'
    }
  });
  
  console.log(`✅ SUCCESS!`);
  console.log(`Batch ID: ${batch.id}`);
  console.log(`Status: ${batch.status}`);
  
} catch (error) {
  console.error('❌ ERROR:', error.message);
}