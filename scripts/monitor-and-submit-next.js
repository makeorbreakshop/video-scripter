#!/usr/bin/env node

import OpenAI from 'openai';
import fs from 'fs';
import dotenv from 'dotenv';

dotenv.config({ path: '.env' });

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

async function waitForProgress(batchId) {
  console.log(`⏳ Waiting for batch ${batchId} to move to in_progress...`);
  
  while (true) {
    const batch = await openai.batches.retrieve(batchId);
    console.log(`   Status: ${batch.status} (${new Date().toLocaleTimeString()})`);
    
    if (batch.status === 'in_progress') {
      console.log(`✅ Batch is now in progress!`);
      return true;
    }
    
    if (batch.status === 'failed' || batch.status === 'cancelled') {
      console.log(`❌ Batch ${batch.status}!`);
      if (batch.errors) {
        console.log('Errors:', JSON.stringify(batch.errors, null, 2));
      }
      return false;
    }
    
    // Wait 30 seconds before checking again
    await new Promise(resolve => setTimeout(resolve, 30000));
  }
}

async function submitNextBatch(batchNumber) {
  const filename = `batch-jobs/llm-summaries-batch-${batchNumber}.jsonl`;
  
  console.log(`\n📤 Submitting batch ${batchNumber}...`);
  
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
        description: `LLM summaries batch ${batchNumber} of 6`
      }
    });
    
    console.log(`✅ Batch ${batchNumber} submitted!`);
    console.log(`   Batch ID: ${batch.id}`);
    console.log(`   Status: ${batch.status}`);
    
    return batch.id;
  } catch (error) {
    console.error(`❌ Failed to submit batch ${batchNumber}:`, error.message);
    return null;
  }
}

// Start monitoring
const batch1Id = 'batch_688909d87310819096270132bb262f7b';

waitForProgress(batch1Id).then(async (success) => {
  if (success) {
    // Submit batch 2
    const batch2Id = await submitNextBatch(2);
    if (batch2Id) {
      console.log('\n🎉 Batch 2 submitted! Continue with remaining batches...');
    }
  }
});