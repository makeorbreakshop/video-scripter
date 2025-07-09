#!/usr/bin/env node
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function resetStuckJobs() {
  // Find all stuck processing jobs
  const { data: stuckJobs, error: fetchError } = await supabase
    .from('video_processing_jobs')
    .select('*')
    .eq('status', 'processing');
  
  if (fetchError) {
    console.error('Error fetching stuck jobs:', fetchError);
    return;
  }

  if (!stuckJobs || stuckJobs.length === 0) {
    console.log('No stuck jobs found');
    return;
  }

  console.log(`Found ${stuckJobs.length} stuck job(s)`);

  // Reset each stuck job
  for (const job of stuckJobs) {
    const { error } = await supabase
      .from('video_processing_jobs')
      .update({
        status: 'pending',
        worker_id: null,
        started_at: null
      })
      .eq('id', job.id);
    
    if (error) {
      console.error(`Error resetting job ${job.id}:`, error);
    } else {
      console.log(`✅ Reset job ${job.id} (video: ${job.video_id}) to pending`);
    }
  }
}

resetStuckJobs().catch(console.error);