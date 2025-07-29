import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config({ path: '.env' });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('Missing Supabase URL or key. Please check your .env file.');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function checkAllTrackingRuns() {
  console.log('🔍 CHECKING ALL TRACKING RUNS\n');

  // Get distinct created_at dates to identify tracking runs
  console.log('📅 IDENTIFYING ALL TRACKING RUNS:');
  console.log('=================================\n');
  
  // Get unique created_at timestamps
  const { data: timestamps, error } = await supabase
    .from('view_snapshots')
    .select('created_at')
    .order('created_at', { ascending: false });
  
  if (error) {
    console.error('Error:', error);
    return;
  }

  // Group by unique timestamps
  const uniqueTimestamps = new Set();
  timestamps.forEach(row => {
    uniqueTimestamps.add(row.created_at);
  });
  
  console.log(`Found ${uniqueTimestamps.size} unique timestamps (tracking batches)\n`);

  // Group by date and time
  const runsByDate = {};
  Array.from(uniqueTimestamps).forEach(timestamp => {
    const date = timestamp.split('T')[0];
    const time = timestamp.split('T')[1];
    
    if (!runsByDate[date]) {
      runsByDate[date] = new Set();
    }
    runsByDate[date].add(time);
  });

  // Display runs by date
  console.log('TRACKING RUNS BY DATE:');
  console.log('---------------------');
  
  for (const [date, times] of Object.entries(runsByDate).sort(([a], [b]) => a.localeCompare(b))) {
    console.log(`\n${date}: ${times.size} unique run(s)`);
    
    // For each unique time, count snapshots
    const sortedTimes = Array.from(times).sort();
    for (const time of sortedTimes.slice(0, 10)) { // Show first 10 times
      const fullTimestamp = `${date}T${time}`;
      
      // Count snapshots with this exact timestamp
      const { count } = await supabase
        .from('view_snapshots')
        .select('*', { count: 'exact', head: true })
        .eq('created_at', fullTimestamp);
      
      console.log(`  ${time.split('.')[0]}: ${count?.toLocaleString() || '?'} snapshots`);
    }
    
    if (sortedTimes.length > 10) {
      console.log(`  ... and ${sortedTimes.length - 10} more runs`);
    }
  }

  // Summary of tracking activity
  console.log('\n\n📊 TRACKING ACTIVITY SUMMARY:');
  console.log('=============================\n');
  
  const dates = Object.keys(runsByDate).sort();
  console.log(`Date range: ${dates[0]} to ${dates[dates.length - 1]}`);
  console.log(`Total days with tracking: ${dates.length}`);
  console.log(`Total unique tracking runs: ${uniqueTimestamps.size}`);
  
  // Check for videos with multiple snapshots across different dates
  console.log('\n\n🔄 CHECKING FOR REPEATED TRACKING:');
  console.log('==================================\n');
  
  // Sample a few videos to check their full history
  const { data: sampleVideos } = await supabase
    .from('view_snapshots')
    .select('video_id')
    .limit(10);
  
  if (sampleVideos) {
    for (const { video_id } of sampleVideos.slice(0, 3)) {
      const { data: history, count } = await supabase
        .from('view_snapshots')
        .select('*', { count: 'exact' })
        .eq('video_id', video_id)
        .order('created_at', { ascending: true });
      
      if (history && count > 1) {
        console.log(`\nVideo ${video_id}: ${count} snapshots`);
        history.forEach(snap => {
          console.log(`  ${snap.snapshot_date} | created: ${snap.created_at} | views: ${snap.view_count?.toLocaleString()}`);
        });
      }
    }
  }
}

checkAllTrackingRuns().catch(console.error);