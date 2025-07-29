#!/usr/bin/env node

import OpenAI from 'openai';
import dotenv from 'dotenv';

dotenv.config({ path: '.env' });

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

async function checkBatchErrors(batchId, batchNum) {
  try {
    const batch = await openai.batches.retrieve(batchId);
    
    console.log(`\nBatch ${batchNum}: ${batch.status}`);
    
    if (batch.errors) {
      console.log('Errors:', JSON.stringify(batch.errors, null, 2));
    }
    
    if (batch.error) {
      console.log('Error:', JSON.stringify(batch.error, null, 2));
    }
    
  } catch (error) {
    console.error(`Error checking batch ${batchNum}:`, error.message);
  }
}

// Check failed batches
checkBatchErrors('batch_68890a32a09481909f051d12aa31c3d7', 2);
checkBatchErrors('batch_68890abc6b7481908bd3c5822d2ba148', 3);
checkBatchErrors('batch_68890b24ef008190938760ed0aeedc20', 4);
checkBatchErrors('batch_68890b5f7370819085164d835c003411', 5);