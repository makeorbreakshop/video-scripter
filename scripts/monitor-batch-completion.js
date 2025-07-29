#!/usr/bin/env node

import OpenAI from 'openai';
import fs from 'fs';
import dotenv from 'dotenv';

dotenv.config({ path: '.env' });

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const batch1Id = 'batch_688909d87310819096270132bb262f7b';

async function monitorBatch() {
  console.log('📊 Monitoring Batch 1 Progress...\n');
  console.log('This script will check every 5 minutes and alert when complete.\n');
  
  while (true) {
    try {
      const batch = await openai.batches.retrieve(batch1Id);
      
      const now = new Date().toLocaleString();
      const completed = batch.request_counts.completed || 0;
      const total = batch.request_counts.total || 0;
      const failed = batch.request_counts.failed || 0;
      const progress = total > 0 ? ((completed / total) * 100).toFixed(1) : 0;
      
      console.log(`[${now}]`);
      console.log(`Status: ${batch.status}`);
      console.log(`Progress: ${completed}/${total} (${progress}%) - ${failed} failed`);
      
      if (batch.status === 'completed') {
        console.log('\n✅ BATCH COMPLETE!');
        console.log(`Output file: ${batch.output_file_id}`);
        
        // Save completion info
        fs.writeFileSync(
          'batch-jobs/batch-1-complete.json',
          JSON.stringify({
            completedAt: new Date().toISOString(),
            outputFileId: batch.output_file_id,
            stats: batch.request_counts
          }, null, 2)
        );
        
        console.log('\nYou can now submit the remaining batches!');
        console.log('Run: node scripts/submit-remaining-batches.js');
        break;
      }
      
      if (batch.status === 'failed' || batch.status === 'cancelled') {
        console.log(`\n❌ Batch ${batch.status}!`);
        break;
      }
      
      console.log('---');
      
    } catch (error) {
      console.error('Error checking batch:', error.message);
    }
    
    // Wait 5 minutes
    await new Promise(resolve => setTimeout(resolve, 5 * 60 * 1000));
  }
}

monitorBatch().catch(console.error);