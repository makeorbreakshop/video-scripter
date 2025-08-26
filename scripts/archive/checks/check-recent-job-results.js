import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config({ path: '.env' });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function checkRecentJobResults() {
  // Job time from screenshot: 7/28/2025, 3:28:48 PM (PST)
  // Convert to UTC (PST is UTC-8)
  const jobStart = new Date('2025-07-28T15:28:48-08:00').toISOString();
  const jobEnd = new Date('2025-07-28T15:35:00-08:00').toISOString(); // Approximate end time
  
  console.log('🔍 CHECKING RECENT JOB RESULTS\n');
  console.log(`Job start: ${jobStart}`);
  console.log(`Job end (estimated): ${jobEnd}\n`);
  
  // Check snapshots created during this job
  const { data: snapshots, count } = await supabase
    .from('view_snapshots')
    .select('video_id, view_count, created_at', { count: 'exact' })
    .gte('created_at', jobStart)
    .lte('created_at', jobEnd)
    .order('created_at', { ascending: false })
    .limit(10);
    
  console.log(`📊 SNAPSHOTS CREATED DURING JOB: ${count?.toLocaleString() || 0}\n`);
  
  if (count && count > 0) {
    // Check if these snapshots have actual view data
    const snapshotsWithViews = snapshots?.filter(s => s.view_count > 0) || [];
    console.log(`✅ Snapshots with view data: ${snapshotsWithViews.length}`);
    console.log(`❌ Snapshots without views: ${(count - snapshotsWithViews.length)}`);
    
    // Show sample of snapshots
    console.log('\nSample snapshots:');
    snapshots?.slice(0, 5).forEach(snap => {
      const time = new Date(snap.created_at).toLocaleTimeString();
      console.log(`  ${time}: ${snap.video_id} - ${snap.view_count?.toLocaleString()} views`);
    });
    
    // Check unique videos
    const uniqueVideos = new Set(snapshots?.map(s => s.video_id));
    console.log(`\n📹 Unique videos tracked: ${uniqueVideos.size}`);
  }
  
  // Also check total snapshots for today
  const today = '2025-07-28';
  const { count: todayTotal } = await supabase
    .from('view_snapshots')
    .select('*', { count: 'exact', head: true })
    .eq('snapshot_date', today);
    
  console.log(`\n📅 Total snapshots for ${today}: ${todayTotal?.toLocaleString() || 0}`);
  
  // Check if quota was actually used
  const { data: quotaCalls } = await supabase
    .from('youtube_quota_calls')
    .select('*')
    .gte('timestamp', jobStart)
    .lte('timestamp', jobEnd)
    .order('timestamp', { ascending: false })
    .limit(5);
    
  console.log(`\n💰 YouTube API calls during job: ${quotaCalls?.length || 0}`);
  if (quotaCalls && quotaCalls.length > 0) {
    const totalCost = quotaCalls.reduce((sum, call) => sum + call.cost, 0);
    console.log(`Total quota consumed: ${totalCost} units`);
  }
}

checkRecentJobResults().catch(console.error);