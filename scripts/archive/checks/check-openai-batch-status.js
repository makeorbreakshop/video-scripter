import OpenAI from 'openai';
import dotenv from 'dotenv';

dotenv.config({ path: '.env' });

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

async function checkBatchStatus() {
  console.log('🔍 Checking OpenAI Batch Job Status...\n');
  
  try {
    // List recent batch jobs
    const batches = await openai.batches.list({ limit: 10 });
    
    console.log(`Found ${batches.data.length} recent batch jobs:\n`);
    
    for (const batch of batches.data) {
      const createdDate = new Date(batch.created_at * 1000);
      const completedDate = batch.completed_at ? new Date(batch.completed_at * 1000) : null;
      
      console.log(`Batch ID: ${batch.id}`);
      console.log(`Status: ${batch.status}`);
      console.log(`Created: ${createdDate.toLocaleString()}`);
      
      if (completedDate) {
        console.log(`Completed: ${completedDate.toLocaleString()}`);
        const duration = (batch.completed_at - batch.created_at) / 3600;
        console.log(`Duration: ${duration.toFixed(1)} hours`);
      }
      
      console.log(`Request counts:`);
      console.log(`  - Total: ${batch.request_counts.total}`);
      console.log(`  - Completed: ${batch.request_counts.completed}`);
      console.log(`  - Failed: ${batch.request_counts.failed}`);
      
      if (batch.metadata && batch.metadata.description) {
        console.log(`Description: ${batch.metadata.description}`);
      }
      
      // If completed, we can download the results
      if (batch.status === 'completed' && batch.output_file_id) {
        console.log(`✅ Output file ready: ${batch.output_file_id}`);
      } else if (batch.status === 'in_progress') {
        const progress = (batch.request_counts.completed / batch.request_counts.total * 100).toFixed(1);
        console.log(`⏳ Progress: ${progress}%`);
      } else if (batch.status === 'failed') {
        console.log(`❌ Batch failed`);
        if (batch.errors) {
          console.log(`Errors:`, batch.errors);
        }
      }
      
      console.log('---\n');
    }
    
    // Check if any are still in progress
    const inProgress = batches.data.filter(b => b.status === 'in_progress');
    if (inProgress.length > 0) {
      console.log(`\n⏳ ${inProgress.length} batch(es) still in progress`);
      
      // Estimate completion time (OpenAI typically processes within 24 hours)
      const oldestInProgress = inProgress[0];
      const hoursElapsed = (Date.now() / 1000 - oldestInProgress.created_at) / 3600;
      console.log(`Oldest batch has been running for ${hoursElapsed.toFixed(1)} hours`);
      console.log(`Typical completion time: 24 hours`);
    }
    
    // Check completed batches
    const completed = batches.data.filter(b => b.status === 'completed');
    if (completed.length > 0) {
      console.log(`\n✅ ${completed.length} batch(es) completed and ready for processing`);
    }
    
  } catch (error) {
    console.error('Error checking batch status:', error);
  }
}

checkBatchStatus().catch(console.error);