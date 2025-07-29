#!/usr/bin/env node

import OpenAI from 'openai';
import fs from 'fs';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: '.env' });

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

async function submitBatches() {
  console.log('📤 Submitting LLM summary batches to OpenAI...\n');
  
  const batchFiles = [
    'llm-summaries-batch-1.jsonl',
    'llm-summaries-batch-2.jsonl',
    'llm-summaries-batch-3.jsonl',
    'llm-summaries-batch-4.jsonl',
    'llm-summaries-batch-5.jsonl',
    'llm-summaries-batch-6.jsonl'
  ];
  
  const submittedBatches = [];
  
  for (let i = 0; i < batchFiles.length; i++) {
    const filename = path.join('batch-jobs', batchFiles[i]);
    
    console.log(`Submitting ${batchFiles[i]}...`);
    
    try {
      // Count lines in file
      const content = fs.readFileSync(filename, 'utf-8');
      const lineCount = content.split('\n').filter(line => line.trim()).length;
      
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
          description: `LLM summaries batch ${i + 1} - ${lineCount} videos`
        }
      });
      
      console.log(`✅ Submitted batch ${i + 1}`);
      console.log(`   Batch ID: ${batch.id}`);
      console.log(`   Status: ${batch.status}`);
      console.log(`   Videos: ${lineCount}\n`);
      
      submittedBatches.push({
        batchNumber: i + 1,
        batchId: batch.id,
        fileId: file.id,
        videoCount: lineCount,
        status: batch.status
      });
      
    } catch (error) {
      console.error(`❌ Error submitting batch ${i + 1}:`, error.message);
    }
  }
  
  // Save submission metadata
  const metadata = {
    submittedAt: new Date().toISOString(),
    totalBatches: submittedBatches.length,
    batches: submittedBatches
  };
  
  fs.writeFileSync(
    path.join('batch-jobs', 'submission-metadata.json'),
    JSON.stringify(metadata, null, 2)
  );
  
  console.log('\n📊 SUBMISSION SUMMARY:');
  console.log('====================');
  console.log(`Total batches submitted: ${submittedBatches.length}`);
  console.log(`Total videos: ${submittedBatches.reduce((sum, b) => sum + b.videoCount, 0)}`);
  console.log('\nBatch IDs for tracking:');
  submittedBatches.forEach(b => {
    console.log(`  Batch ${b.batchNumber}: ${b.batchId}`);
  });
  console.log('\nBatches will complete within 24 hours.');
  console.log('Check status with: node scripts/check-batch-status.js');
}

submitBatches().catch(console.error);