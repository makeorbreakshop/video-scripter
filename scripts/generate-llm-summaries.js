#!/usr/bin/env node

import { LLMSummaryBatchProcessor } from '../lib/llm-summary-batch-processor.js';
import readline from 'readline';

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

async function main() {
  console.log('🚀 LLM Summary Generation Tool\n');
  
  const processor = new LLMSummaryBatchProcessor();
  
  // Check for command line arguments
  const args = process.argv.slice(2);
  const command = args[0];
  
  if (command === 'prepare') {
    // Prepare batches
    const limit = args[1] ? parseInt(args[1]) : undefined;
    const result = await processor.prepareBatches(limit);
    
    if (!result) return;
    
    console.log('\n📊 Batch Preparation Complete:');
    console.log(`  Files created: ${result.batchFiles.length}`);
    console.log(`  Total videos: ${result.videoCount}`);
    console.log(`  Estimated cost: $${result.estimatedCost.toFixed(2)}`);
    
    // Ask for confirmation
    const answer = await new Promise(resolve => {
      rl.question('\nDo you want to submit these batches? (yes/no): ', resolve);
    });
    
    if (answer.toLowerCase() === 'yes' || answer.toLowerCase() === 'y') {
      const batchIds = await processor.submitBatches(result.batchFiles);
      console.log('\n✅ Batches submitted successfully!');
      console.log('Batch IDs:', batchIds);
      console.log('\nUse "node generate-llm-summaries.js status <batch-id>" to check progress');
    }
    
  } else if (command === 'status' && args[1]) {
    // Check batch status
    const batchId = args[1];
    const status = await processor.checkBatchStatus(batchId);
    
    console.log('\n📊 Batch Status:');
    console.log(`  ID: ${status.id}`);
    console.log(`  Status: ${status.status}`);
    console.log(`  Progress: ${status.progress}`);
    console.log(`  Errors: ${status.errors}`);
    
  } else if (command === 'process' && args[1]) {
    // Process completed batch
    const batchId = args[1];
    const result = await processor.processBatchResults(batchId);
    
    console.log('\n✅ Processing complete!');
    
  } else if (command === 'cleanup') {
    // Clean up batch files
    await processor.cleanupBatchFiles();
    
  } else {
    // Show usage
    console.log('Usage:');
    console.log('  node generate-llm-summaries.js prepare [limit]   - Prepare batch files');
    console.log('  node generate-llm-summaries.js status <batch-id> - Check batch status');
    console.log('  node generate-llm-summaries.js process <batch-id> - Process results');
    console.log('  node generate-llm-summaries.js cleanup           - Clean up batch files');
    console.log('\nExample workflow:');
    console.log('  1. node generate-llm-summaries.js prepare 1000');
    console.log('  2. node generate-llm-summaries.js status batch_xxxxx');
    console.log('  3. node generate-llm-summaries.js process batch_xxxxx');
  }
  
  rl.close();
}

main().catch(console.error);