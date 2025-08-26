import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config({ path: '.env' });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function checkJobDetails() {
  // Get the most recent completed job
  const { data: jobs } = await supabase
    .from('jobs')
    .select('*')
    .eq('type', 'view_tracking')
    .eq('status', 'completed')
    .order('created_at', { ascending: false })
    .limit(1);
    
  if (!jobs || jobs.length === 0) {
    console.log('No completed jobs found');
    return;
  }
  
  const job = jobs[0];
  console.log('📊 MOST RECENT COMPLETED JOB:\n');
  console.log(`Job ID: ${job.id}`);
  console.log(`Started: ${new Date(job.created_at).toLocaleString()}`);
  console.log(`Completed: ${new Date(job.updated_at).toLocaleString()}`);
  console.log(`Duration: ${Math.round((new Date(job.updated_at) - new Date(job.created_at)) / 1000 / 60)} minutes`);
  console.log(`\nJob Data:`, JSON.stringify(job.data, null, 2));
  console.log(`Error: ${job.error || 'None'}`);
  
  // Check if there were any quota issues around that time
  const startTime = new Date(job.created_at);
  const endTime = new Date(job.updated_at);
  
  const { data: quotaCalls } = await supabase
    .from('youtube_quota_calls')
    .select('*')
    .gte('timestamp', startTime.toISOString())  
    .lte('timestamp', endTime.toISOString())
    .order('timestamp', { ascending: false });
    
  console.log(`\n📞 QUOTA CALLS DURING JOB: ${quotaCalls?.length || 0}`);
  if (quotaCalls && quotaCalls.length > 0) {
    const totalCost = quotaCalls.reduce((sum, call) => sum + call.cost, 0);
    console.log(`Total quota used: ${totalCost}`);
    console.log(`Last few calls:`);
    quotaCalls.slice(0, 5).forEach(call => {
      console.log(`  ${new Date(call.timestamp).toLocaleTimeString()}: ${call.method} (${call.cost} units)`);
    });
  }
}

checkJobDetails().catch(console.error);