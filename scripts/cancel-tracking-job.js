import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config({ path: '.env' });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function cancelTrackingJob() {
  // Find active tracking job
  const { data: activeJobs } = await supabase
    .from('jobs')
    .select('*')
    .eq('type', 'view_tracking')
    .eq('status', 'processing')
    .order('created_at', { ascending: false })
    .limit(1);
    
  if (!activeJobs || activeJobs.length === 0) {
    console.log('No active tracking job found');
    return;
  }
  
  const job = activeJobs[0];
  console.log(`Found active job: ${job.id}`);
  console.log(`Started: ${job.created_at}`);
  console.log(`Progress: ${job.data?.progress || 0}%`);
  console.log(`Videos processed: ${job.data?.videosProcessed || 0}`);
  
  // Cancel it by setting status to failed
  const { error } = await supabase
    .from('jobs')
    .update({
      status: 'failed',
      error: 'Cancelled by user',
      updated_at: new Date().toISOString()
    })
    .eq('id', job.id);
    
  if (error) {
    console.error('Error cancelling job:', error);
  } else {
    console.log('\n✅ Job cancelled successfully!');
  }
}

cancelTrackingJob().catch(console.error);