#!/usr/bin/env node

import OpenAI from 'openai';
import fs from 'fs';
import dotenv from 'dotenv';

dotenv.config({ path: '.env' });

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const filename = 'batch-jobs/llm-summaries-batch-2.jsonl';

console.log('📤 Submitting batch 2...\n');

try {
  // Upload file
  const file = await openai.files.create({
    file: fs.createReadStream(filename),
    purpose: 'batch'
  });
  
  console.log(`✅ File uploaded: ${file.id}`);
  
  // Create batch
  const batch = await openai.batches.create({
    input_file_id: file.id,
    endpoint: '/v1/chat/completions',
    completion_window: '24h',
    metadata: {
      description: 'LLM summaries batch 2 of 6'
    }
  });
  
  console.log(`\n✅ BATCH 2 SUBMITTED!`);
  console.log(`Batch ID: ${batch.id}`);
  console.log(`Status: ${batch.status}`);
  console.log(`Created at: ${new Date().toLocaleString()}`);
  
  // Save result
  fs.writeFileSync(
    'batch-jobs/batch-2-submission.json',
    JSON.stringify({
      batchNumber: 2,
      batchId: batch.id,
      fileId: file.id,
      status: batch.status,
      submittedAt: new Date().toISOString()
    }, null, 2)
  );
  
} catch (error) {
  console.error('❌ ERROR:', error.message);
  if (error.response) {
    console.error('Details:', JSON.stringify(error.response.data, null, 2));
  }
}