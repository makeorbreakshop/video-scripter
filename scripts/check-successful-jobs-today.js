import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config({ path: '.env' });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function checkSuccessfulJobsToday() {
  console.log('🔍 CHECKING ALL JOBS TODAY (7/28/2025)\n');
  
  // Get all view tracking jobs from today
  const { data: jobs } = await supabase
    .from('jobs')
    .select('*')
    .eq('type', 'view_tracking')
    .gte('created_at', '2025-07-28T00:00:00')
    .lte('created_at', '2025-07-28T23:59:59')
    .order('created_at', { ascending: true });
    
  console.log(`Found ${jobs?.length || 0} view tracking jobs today\n`);
  
  for (const job of jobs || []) {
    const startTime = new Date(job.created_at);
    const endTime = new Date(job.updated_at);
    
    // Check snapshots created during this job
    const { count: snapshotCount } = await supabase
      .from('view_snapshots')
      .select('*', { count: 'exact', head: true })
      .gte('created_at', job.created_at)
      .lte('created_at', job.updated_at);
      
    // Check API calls during this job
    const { data: quotaCalls } = await supabase
      .from('youtube_quota_calls')
      .select('cost')
      .gte('timestamp', job.created_at)
      .lte('timestamp', job.updated_at);
      
    const totalQuota = quotaCalls?.reduce((sum, call) => sum + call.cost, 0) || 0;
    
    console.log(`Job ${job.id.slice(0, 8)}...`);
    console.log(`  Status: ${job.status}`);
    console.log(`  Time: ${startTime.toLocaleTimeString()} - ${endTime.toLocaleTimeString()}`);
    console.log(`  Duration: ${Math.round((endTime - startTime) / 1000 / 60)} minutes`);
    console.log(`  Snapshots created: ${snapshotCount?.toLocaleString() || 0}`);
    console.log(`  API calls: ${quotaCalls?.length || 0} (${totalQuota} quota units)`);
    console.log(`  Data: ${JSON.stringify(job.data)}`);
    console.log('');
  }
  
  // Show timeline of snapshot creation
  console.log('📊 SNAPSHOT CREATION TIMELINE:');
  const { data: timeline } = await supabase
    .from('view_snapshots')
    .select('created_at')
    .eq('snapshot_date', '2025-07-28')
    .order('created_at', { ascending: false })
    .limit(1000);
    
  if (timeline && timeline.length > 0) {
    // Group by hour
    const hourCounts = {};
    timeline.forEach(snap => {
      const hour = new Date(snap.created_at).getHours();
      const hourKey = `${hour}:00`;
      hourCounts[hourKey] = (hourCounts[hourKey] || 0) + 1;
    });
    
    Object.entries(hourCounts)
      .sort(([a], [b]) => parseInt(a) - parseInt(b))
      .forEach(([hour, count]) => {
        console.log(`  ${hour.padStart(5)}: ${count} snapshots`);
      });
  }
}

checkSuccessfulJobsToday().catch(console.error);