#!/usr/bin/env node

import OpenAI from 'openai';
import fs from 'fs';
import dotenv from 'dotenv';

dotenv.config({ path: '.env' });

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// Submit just batch 2 (or change the number)
const batchNumber = 2;
const filename = `batch-jobs/llm-summaries-batch-${batchNumber}.jsonl`;

console.log(`Submitting ${filename}...`);

try {
  const file = await openai.files.create({
    file: fs.createReadStream(filename),
    purpose: 'batch'
  });
  
  console.log(`File uploaded: ${file.id}`);
  
  const batch = await openai.batches.create({
    input_file_id: file.id,
    endpoint: '/v1/chat/completions',
    completion_window: '24h',
    metadata: {
      description: `LLM summaries batch ${batchNumber} - retry`
    }
  });
  
  console.log(`\n✅ SUCCESS!`);
  console.log(`Batch ID: ${batch.id}`);
  console.log(`Status: ${batch.status}`);
  console.log(`Request count: ${batch.request_counts.total}`);
  
} catch (error) {
  console.error(`\n❌ ERROR:`, error.message);
  if (error.response) {
    console.error('Details:', error.response.data);
  }
}