#!/usr/bin/env node

import OpenAI from 'openai';
import fs from 'fs';
import dotenv from 'dotenv';

dotenv.config({ path: '.env' });

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// Batches we need to submit (3-6)
const remainingBatches = [3, 4, 5, 6];

// Current active batches
const activeBatches = [
  { num: 1, id: 'batch_688909d87310819096270132bb262f7b' },
  { num: 2, id: 'batch_68890d0a84f88190b84a267075b7c95a' }
];

async function submitBatch(batchNum) {
  const filename = `batch-jobs/llm-summaries-batch-${batchNum}.jsonl`;
  
  console.log(`\n📤 Submitting batch ${batchNum}...`);
  
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
        description: `LLM summaries batch ${batchNum} of 6`
      }
    });
    
    console.log(`✅ Batch ${batchNum} submitted: ${batch.id}`);
    return batch.id;
    
  } catch (error) {
    console.error(`❌ Failed to submit batch ${batchNum}:`, error.message);
    return null;
  }
}

async function checkAndSubmit() {
  console.log('🤖 Auto-submission script running...');
  console.log('Will check every 10 minutes for completed batches.\n');
  
  while (remainingBatches.length > 0) {
    // Check status of active batches
    for (const activeBatch of activeBatches) {
      try {
        const batch = await openai.batches.retrieve(activeBatch.id);
        
        if (batch.status === 'completed' || batch.status === 'failed' || batch.status === 'cancelled') {
          console.log(`\n✅ Batch ${activeBatch.num} ${batch.status}!`);
          
          // Remove from active list
          const index = activeBatches.findIndex(b => b.id === activeBatch.id);
          activeBatches.splice(index, 1);
          
          // If we have more to submit and room in queue
          if (remainingBatches.length > 0) {
            const nextNum = remainingBatches.shift();
            const newId = await submitBatch(nextNum);
            
            if (newId) {
              activeBatches.push({ num: nextNum, id: newId });
            }
          }
        }
      } catch (error) {
        console.error(`Error checking batch ${activeBatch.num}:`, error.message);
      }
    }
    
    // Status update
    const now = new Date().toLocaleTimeString();
    console.log(`\n[${now}] Active batches: ${activeBatches.map(b => b.num).join(', ')}`);
    console.log(`Remaining to submit: ${remainingBatches.join(', ') || 'none'}`);
    
    if (activeBatches.length === 0 && remainingBatches.length === 0) {
      console.log('\n🎉 All batches submitted and processed!');
      break;
    }
    
    // Wait 10 minutes
    await new Promise(resolve => setTimeout(resolve, 10 * 60 * 1000));
  }
}

checkAndSubmit().catch(console.error);