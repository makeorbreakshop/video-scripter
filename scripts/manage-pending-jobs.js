import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config();

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function managePendingJobs() {
  console.log('Checking for pending view tracking jobs...\n');
  
  // Get all pending or failed view tracking jobs from today
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  
  const { data: pendingJobs, error } = await supabase
    .from('jobs')
    .select('*')
    .eq('type', 'view_tracking')
    .in('status', ['pending', 'failed'])
    .gte('created_at', today.toISOString())
    .order('created_at', { ascending: false });
  
  if (error) {
    console.error('Error fetching jobs:', error);
    return;
  }
  
  if (!pendingJobs || pendingJobs.length === 0) {
    console.log('No pending jobs found.');
    return;
  }
  
  console.log(`Found ${pendingJobs.length} pending job(s):\n`);
  
  pendingJobs.forEach((job, index) => {
    console.log(`${index + 1}. Job ID: ${job.id}`);
    console.log(`   Created: ${new Date(job.created_at).toLocaleString()}`);
    console.log(`   API Calls: ${job.data?.maxApiCalls || 'unknown'}`);
    console.log(`   Note: ${job.data?.note || 'No note'}\n`);
  });
  
  // For now, let's cancel all pending jobs
  console.log('Cancelling all pending jobs...');
  
  for (const job of pendingJobs) {
    const { error: updateError } = await supabase
      .from('jobs')
      .update({
        status: 'failed',
        updated_at: new Date().toISOString(),
        error: 'Cancelled - no worker available to process'
      })
      .eq('id', job.id);
    
    if (updateError) {
      console.error(`Error cancelling job ${job.id}:`, updateError);
    } else {
      console.log(`✅ Cancelled job ${job.id}`);
    }
  }
  
  console.log('\nDone! All pending jobs have been cancelled.');
  console.log('You can now run a new tracking job that will execute immediately.');
}

// Run the script
managePendingJobs().catch(console.error);