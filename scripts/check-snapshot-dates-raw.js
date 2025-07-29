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

async function checkSnapshotDatesRaw() {
  console.log('🔍 CHECKING RAW SNAPSHOT DATES\n');

  // 1. Get first 10 snapshots
  console.log('First 10 snapshots:');
  const { data: first10, error: error1 } = await supabase
    .from('view_snapshots')
    .select('video_id, snapshot_date, created_at')
    .order('created_at', { ascending: true })
    .limit(10);
  
  if (!error1 && first10) {
    first10.forEach(row => {
      console.log(`Video: ${row.video_id} | Snapshot: ${row.snapshot_date} | Created: ${row.created_at}`);
    });
  }

  // 2. Get last 10 snapshots
  console.log('\nLast 10 snapshots:');
  const { data: last10, error: error2 } = await supabase
    .from('view_snapshots')
    .select('video_id, snapshot_date, created_at')
    .order('created_at', { ascending: false })
    .limit(10);
  
  if (!error2 && last10) {
    last10.forEach(row => {
      console.log(`Video: ${row.video_id} | Snapshot: ${row.snapshot_date} | Created: ${row.created_at}`);
    });
  }

  // 3. Check for snapshots NOT from today
  console.log('\n\nChecking for non-today snapshots:');
  const { data: nonToday, error: error3 } = await supabase
    .from('view_snapshots')
    .select('snapshot_date, video_id, created_at')
    .not('snapshot_date', 'like', '2025-07-28%')
    .limit(20);
  
  if (!error3 && nonToday) {
    console.log(`Found ${nonToday.length} snapshots not from 2025-07-28:`);
    nonToday.forEach(row => {
      console.log(`  ${row.snapshot_date} - Video: ${row.video_id} - Created: ${row.created_at}`);
    });
  }

  // 4. Get distinct snapshot dates
  console.log('\n\nGetting sample of different dates:');
  const { data: sampleData, error: error4 } = await supabase
    .from('view_snapshots')
    .select('snapshot_date')
    .limit(10000);
  
  if (!error4 && sampleData) {
    const uniqueDates = new Set();
    sampleData.forEach(row => {
      uniqueDates.add(row.snapshot_date.split('T')[0]);
    });
    
    console.log(`Found ${uniqueDates.size} unique dates in sample of ${sampleData.length} records:`);
    Array.from(uniqueDates).sort().forEach(date => {
      console.log(`  ${date}`);
    });
  }

  // 5. Check for specific videos with multiple snapshots
  console.log('\n\nChecking video with multiple snapshots (BTPDRVWTDF8):');
  const { data: multiSnaps, error: error5 } = await supabase
    .from('view_snapshots')
    .select('*')
    .eq('video_id', 'BTPDRVWTDF8')
    .order('snapshot_date', { ascending: true });
  
  if (!error5 && multiSnaps) {
    console.log(`Found ${multiSnaps.length} snapshots:`);
    multiSnaps.forEach(snap => {
      console.log(`  Snapshot: ${snap.snapshot_date} | Views: ${snap.view_count} | Created: ${snap.created_at}`);
    });
  }

  // 6. Count total records
  const { count } = await supabase
    .from('view_snapshots')
    .select('*', { count: 'exact', head: true });
  
  console.log(`\n\nTotal records in view_snapshots: ${count}`);
}

checkSnapshotDatesRaw().catch(console.error);