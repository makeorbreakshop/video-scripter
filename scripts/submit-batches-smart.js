#!/usr/bin/env node

import OpenAI from 'openai';
import fs from 'fs';
import dotenv from 'dotenv';

dotenv.config({ path: '.env' });

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

async function waitForBatchToProcess(batchId, maxWaitMinutes = 120) {
  console.log(`⏳ Waiting for batch ${batchId} to start processing...`);
  
  const startTime = Date.now();
  const maxWaitMs = maxWaitMinutes * 60 * 1000;
  
  while (Date.now() - startTime < maxWaitMs) {
    const batch = await openai.batches.retrieve(batchId);
    
    if (batch.status === 'in_progress' || batch.status === 'completed' || batch.status === 'failed') {
      console.log(`✅ Batch status: ${batch.status}`);
      return batch.status;
    }
    
    const elapsed = Math.floor((Date.now() - startTime) / 1000 / 60);
    console.log(`   Still ${batch.status}... (${elapsed} minutes elapsed)`);
    
    // Wait 1 minute before checking again
    await new Promise(resolve => setTimeout(resolve, 60000));
  }
  
  return 'timeout';
}

async function submitBatchesSequentially() {
  console.log('🚀 Starting sequential batch submission...\n');
  console.log('This will submit each batch and wait for it to start processing');
  console.log('before submitting the next one.\n');
  
  const results = [];
  
  for (let i = 1; i <= 6; i++) {
    const filename = `batch-jobs/llm-summaries-batch-${i}.jsonl`;
    
    console.log(`\n📤 Submitting batch ${i} of 6...`);
    
    try {
      // Upload file
      const file = await openai.files.create({
        file: fs.createReadStream(filename),
        purpose: 'batch'
      });
      
      // Create batch
      const batch = await openai.batches.create({
        input_file_id: file.id,
        endpoint: '/v1/chat/completions',
        completion_window: '24h',
        metadata: {
          description: `LLM summaries batch ${i} of 6`
        }
      });
      
      console.log(`✅ Batch ${i} submitted!`);
      console.log(`   ID: ${batch.id}`);
      console.log(`   Initial status: ${batch.status}`);
      
      results.push({
        batchNumber: i,
        batchId: batch.id,
        status: batch.status
      });
      
      // If not the last batch, wait for it to start processing
      if (i < 6) {
        const finalStatus = await waitForBatchToProcess(batch.id);
        
        if (finalStatus === 'failed') {
          console.error(`❌ Batch ${i} failed! Stopping submission.`);
          break;
        } else if (finalStatus === 'timeout') {
          console.error(`⏱️ Batch ${i} took too long to start. Continuing anyway...`);
        }
      }
      
    } catch (error) {
      console.error(`❌ Batch ${i} submission failed:`, error.message);
      
      if (error.message.includes('token limit')) {
        console.log('\n⚠️  Token limit reached. Waiting 30 minutes before retrying...');
        await new Promise(resolve => setTimeout(resolve, 30 * 60 * 1000));
        i--; // Retry this batch
      } else {
        break; // Stop on other errors
      }
    }
  }
  
  // Save results
  console.log('\n📊 FINAL RESULTS:');
  console.log('================');
  results.forEach(r => {
    console.log(`Batch ${r.batchNumber}: ${r.batchId}`);
  });
  
  fs.writeFileSync(
    'batch-jobs/submission-results.json',
    JSON.stringify({
      submittedAt: new Date().toISOString(),
      batches: results
    }, null, 2)
  );
  
  console.log('\nResults saved to: batch-jobs/submission-results.json');
  console.log('Monitor progress with: node scripts/check-openai-batch-status.js');
}

submitBatchesSequentially().catch(console.error);