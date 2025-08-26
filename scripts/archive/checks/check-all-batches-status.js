#!/usr/bin/env node

import OpenAI from 'openai';
import dotenv from 'dotenv';

dotenv.config({ path: '.env' });

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const batchIds = [
  'batch_688909d87310819096270132bb262f7b',
  'batch_68890a32a09481909f051d12aa31c3d7',
  'batch_68890abc6b7481908bd3c5822d2ba148',
  'batch_68890b24ef008190938760ed0aeedc20',
  'batch_68890b5f7370819085164d835c003411',
  'batch_68890ba411888190bc104d76ff383938'
];

async function checkAllBatches() {
  console.log('📊 Checking status of all batches...\n');
  
  for (let i = 0; i < batchIds.length; i++) {
    try {
      const batch = await openai.batches.retrieve(batchIds[i]);
      
      console.log(`Batch ${i + 1}:`);
      console.log(`  ID: ${batch.id}`);
      console.log(`  Status: ${batch.status}`);
      console.log(`  Requests: ${batch.request_counts.total || 0}`);
      console.log(`  Completed: ${batch.request_counts.completed || 0}`);
      console.log(`  Failed: ${batch.request_counts.failed || 0}`);
      console.log('');
      
    } catch (error) {
      console.error(`Batch ${i + 1} error:`, error.message);
    }
  }
  
  console.log('\nRun this script again later to check progress.');
  console.log('Results will be available in ~24 hours.');
}

checkAllBatches().catch(console.error);