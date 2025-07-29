import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config({ path: '.env' });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function checkAllNewSnapshots() {
  console.log('📊 COMPLETE VIEW TRACKING DATA SINCE JULY 24\n');
  
  // Get total count first
  const { count: totalCount } = await supabase
    .from('view_snapshots')
    .select('*', { count: 'exact', head: true })
    .gte('created_at', '2025-07-24T00:00:00');
    
  console.log(`Total snapshots since July 24: ${totalCount?.toLocaleString()}\n`);
  
  // Process in batches to avoid 1000 row limit
  const batchSize = 1000;
  let offset = 0;
  const trackingRuns = {};
  const snapshotDates = {};
  
  while (offset < totalCount) {
    const { data: batch } = await supabase
      .from('view_snapshots')
      .select('created_at, snapshot_date, video_id')
      .gte('created_at', '2025-07-24T00:00:00')
      .order('created_at')
      .range(offset, offset + batchSize - 1);
      
    if (!batch || batch.length === 0) break;
    
    // Process batch
    batch.forEach(row => {
      const createdDate = row.created_at.split('T')[0];
      const snapDate = row.snapshot_date;
      
      trackingRuns[createdDate] = (trackingRuns[createdDate] || 0) + 1;
      snapshotDates[snapDate] = (snapshotDates[snapDate] || 0) + 1;
    });
    
    offset += batch.length;
    process.stdout.write(`\rProcessed ${offset} / ${totalCount} snapshots...`);
  }
  
  console.log('\n\nTRACKING RUNS (by created_at date):');
  console.log('-----------------------------------');
  Object.entries(trackingRuns)
    .sort(([a], [b]) => a.localeCompare(b))
    .forEach(([date, count]) => {
      console.log(`${date}: ${count.toLocaleString()} snapshots`);
    });
    
  console.log('\n\nSNAPSHOT DATES:');
  console.log('---------------');
  Object.entries(snapshotDates)
    .sort(([a], [b]) => a.localeCompare(b))
    .forEach(([date, count]) => {
      console.log(`${date}: ${count.toLocaleString()} snapshots`);
    });
}

checkAllNewSnapshots().catch(console.error);