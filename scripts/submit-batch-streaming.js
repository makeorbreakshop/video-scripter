#!/usr/bin/env node

import OpenAI from 'openai';
import dotenv from 'dotenv';
import fs from 'fs';
import { promises as fsPromises } from 'fs';
import path from 'path';
import { createReadStream } from 'fs';

dotenv.config();

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

async function countLines(filename) {
  const stream = createReadStream(filename, { encoding: 'utf8' });
  let count = 0;
  
  for await (const chunk of stream) {
    count += chunk.split('\n').filter(line => line.trim()).length;
  }
  
  return count;
}

async function submitBatch(filename) {
  console.log(`📤 Submitting ${filename} to OpenAI...`);
  
  try {
    // Count lines using streaming
    console.log('Counting lines...');
    const lineCount = await countLines(filename);
    console.log(`Videos in batch: ${lineCount}`);
    
    // Upload file using streaming
    console.log('Uploading file...');
    const fileStream = createReadStream(filename);
    const file = await openai.files.create({
      file: fileStream,
      purpose: 'batch'
    });
    
    console.log(`✅ File uploaded: ${file.id}`);
    
    // Create batch
    console.log('Creating batch job...');
    const batch = await openai.batches.create({
      input_file_id: file.id,
      endpoint: '/v1/chat/completions',
      completion_window: '24h',
      metadata: {
        description: `LLM summaries for ${lineCount} videos`,
        filename: path.basename(filename)
      }
    });
    
    console.log(`\n✅ Batch submitted successfully!`);
    console.log(`Batch ID: ${batch.id}`);
    console.log(`Status: ${batch.status}`);
    console.log(`\nThe batch will process within 24 hours.`);
    console.log(`Use 'node scripts/check-batch-status.js' to monitor progress.`);
    
    // Save batch info
    const batchInfo = {
      batchId: batch.id,
      fileId: file.id,
      filename: path.basename(filename),
      videoCount: lineCount,
      submittedAt: new Date().toISOString()
    };
    
    const infoPath = path.join(path.dirname(filename), 'batch-info.json');
    
    // Append to existing info if it exists
    let allBatches = { batches: [] };
    try {
      const existing = await fsPromises.readFile(infoPath, 'utf-8');
      allBatches = JSON.parse(existing);
    } catch (e) {
      // File doesn't exist yet
    }
    
    allBatches.batches.push(batchInfo);
    allBatches.totalVideos = allBatches.batches.reduce((sum, b) => sum + b.videoCount, 0);
    allBatches.lastUpdated = new Date().toISOString();
    
    await fsPromises.writeFile(infoPath, JSON.stringify(allBatches, null, 2));
    
    console.log(`\n📝 Batch info saved to: ${infoPath}`);
    
  } catch (error) {
    console.error('❌ Error:', error);
    if (error.response) {
      console.error('Response:', error.response.data);
    }
  }
}

// Get filename from command line
const filename = process.argv[2];
if (!filename) {
  console.log('Usage: node submit-batch-streaming.js <filename>');
  console.log('Example: node submit-batch-streaming.js batch-jobs/llm-summaries-batch-1.jsonl');
  process.exit(1);
}

submitBatch(filename).catch(console.error);