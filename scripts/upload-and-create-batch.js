#!/usr/bin/env node

import OpenAI from 'openai';
import fs from 'fs';
import dotenv from 'dotenv';

dotenv.config({ path: '.env' });

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

async function uploadAndCreateBatch(batchNumber = 1) {
  const filename = `batch-jobs/llm-summaries-batch-${batchNumber}.jsonl`;
  
  console.log(`📤 Uploading ${filename}...`);
  
  try {
    // Step 1: Upload the file
    const file = await openai.files.create({
      file: fs.createReadStream(filename),
      purpose: 'batch'
    });
    
    console.log(`✅ File uploaded successfully!`);
    console.log(`   File ID: ${file.id}`);
    console.log(`   Size: ${file.bytes} bytes`);
    
    // Step 2: Create the batch
    console.log(`\n📦 Creating batch...`);
    
    const batch = await openai.batches.create({
      input_file_id: file.id,
      endpoint: '/v1/chat/completions',
      completion_window: '24h',
      metadata: {
        description: `LLM summaries batch ${batchNumber} of 6`
      }
    });
    
    console.log(`\n✅ Batch created successfully!`);
    console.log(`   Batch ID: ${batch.id}`);
    console.log(`   Status: ${batch.status}`);
    console.log(`   Request count: ${batch.request_counts.total}`);
    
    // Save the result
    const result = {
      batchNumber,
      fileId: file.id,
      batchId: batch.id,
      status: batch.status,
      createdAt: new Date().toISOString()
    };
    
    fs.writeFileSync(
      `batch-jobs/batch-${batchNumber}-result.json`,
      JSON.stringify(result, null, 2)
    );
    
    console.log(`\n📁 Result saved to: batch-jobs/batch-${batchNumber}-result.json`);
    
  } catch (error) {
    console.error(`\n❌ ERROR:`, error.message);
    if (error.response) {
      console.error('Details:', JSON.stringify(error.response.data, null, 2));
    }
  }
}

// Run for batch 1
uploadAndCreateBatch(1).catch(console.error);