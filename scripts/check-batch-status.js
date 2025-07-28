#!/usr/bin/env node

import OpenAI from 'openai';
import dotenv from 'dotenv';
import fs from 'fs/promises';
import path from 'path';

dotenv.config();

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

async function checkBatchStatus() {
  // Read batch info
  const batchInfoPath = path.join(process.cwd(), 'batch-jobs', 'batch-info.json');
  
  try {
    const batchInfo = JSON.parse(await fs.readFile(batchInfoPath, 'utf-8'));
    
    console.log('📊 Batch Status Check\n');
    console.log(`Submitted: ${new Date(batchInfo.submittedAt).toLocaleString()}`);
    console.log(`Total videos: ${batchInfo.totalVideos.toLocaleString()}\n`);
    
    for (const batch of batchInfo.batches) {
      try {
        const status = await openai.batches.retrieve(batch.batchId);
        
        console.log(`Batch ${batch.batchId}:`);
        console.log(`  Status: ${status.status}`);
        console.log(`  Videos: ${batch.videoCount}`);
        
        if (status.request_counts) {
          console.log(`  Progress: ${status.request_counts.completed}/${status.request_counts.total}`);
          if (status.request_counts.failed > 0) {
            console.log(`  ⚠️  Failed: ${status.request_counts.failed}`);
          }
        }
        
        if (status.status === 'completed' && status.output_file_id) {
          console.log(`  ✅ Output file: ${status.output_file_id}`);
        }
        
        console.log('');
      } catch (error) {
        console.error(`Error checking batch ${batch.batchId}:`, error.message);
      }
    }
    
    // Check if all batches are complete
    const allComplete = await Promise.all(
      batchInfo.batches.map(async b => {
        const status = await openai.batches.retrieve(b.batchId);
        return status.status === 'completed';
      })
    );
    
    if (allComplete.every(c => c)) {
      console.log('✅ All batches are complete! Run process-batch-results.js to update the database.');
    }
    
  } catch (error) {
    console.error('Error reading batch info:', error);
    console.log('Make sure you run submit-llm-summary-batches.js first');
  }
}

checkBatchStatus().catch(console.error);