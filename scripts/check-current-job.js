import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config({ path: '.env' });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function checkCurrentJob() {
  // Find the most recent tracking job
  const { data: jobs } = await supabase
    .from('jobs')
    .select('*')
    .eq('type', 'view_tracking')
    .order('created_at', { ascending: false })
    .limit(2);
    
  if (!jobs || jobs.length === 0) {
    console.log('No tracking jobs found');
    return;
  }
  
  console.log('📊 MOST RECENT TRACKING JOBS:\n');
  
  jobs.forEach((job, index) => {
    console.log(`${index === 0 ? '🟢 LATEST' : '⚪ Previous'} Job: ${job.id}`);
    console.log(`Status: ${job.status}`);
    console.log(`Started: ${new Date(job.created_at).toLocaleString()}`);
    console.log(`Progress: ${job.data?.progress || 0}%`);
    console.log(`Videos to process: ${job.data?.totalVideos || job.data?.videosToUpdate || '?'}`);
    console.log(`Videos processed: ${job.data?.videosProcessed || 0}`);
    
    if (job.status === 'processing') {
      const startTime = new Date(job.created_at).getTime();
      const elapsed = Date.now() - startTime;
      const elapsedMinutes = Math.floor(elapsed / 60000);
      console.log(`Running for: ${elapsedMinutes} minutes`);
      
      if (job.data?.videosProcessed > 0) {
        const rate = job.data.videosProcessed / (elapsed / 1000); // videos per second
        console.log(`Rate: ${rate.toFixed(1)} videos/second`);
        
        const remaining = (job.data?.totalVideos || job.data?.videosToUpdate || 0) - job.data.videosProcessed;
        const eta = remaining / rate / 60; // minutes
        console.log(`ETA: ${Math.ceil(eta)} minutes`);
      }
    }
    
    console.log('---\n');
  });
}

checkCurrentJob().catch(console.error);