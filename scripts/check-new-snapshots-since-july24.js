import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config({ path: '.env' });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

const supabase = createClient(supabaseUrl, supabaseKey);

async function checkNewSnapshots() {
  console.log('📊 CHECKING VIEW SNAPSHOTS SINCE JULY 24\n');
  
  // Get count by created_at date (when tracking was run)
  const { data, error } = await supabase
    .from('view_snapshots')
    .select('snapshot_date, created_at, video_id')
    .gte('created_at', '2025-07-24T00:00:00');
    
  if (error) {
    console.error('Error:', error);
    return;
  }
  
  // Group by created date
  const byCreatedDate = {};
  const bySnapshotDate = {};
  
  data.forEach(row => {
    const createdDate = row.created_at.split('T')[0];
    const snapDate = row.snapshot_date;
    
    byCreatedDate[createdDate] = (byCreatedDate[createdDate] || 0) + 1;
    bySnapshotDate[snapDate] = (bySnapshotDate[snapDate] || 0) + 1;
  });
  
  console.log('SNAPSHOTS BY CREATED DATE (when tracking ran):');
  console.log('---------------------------------------------');
  Object.entries(byCreatedDate)
    .sort(([a], [b]) => a.localeCompare(b))
    .forEach(([date, count]) => {
      console.log(`${date}: ${count.toLocaleString()} snapshots`);
    });
    
  console.log('\n\nSNAPSHOTS BY SNAPSHOT DATE:');
  console.log('---------------------------');
  Object.entries(bySnapshotDate)
    .sort(([a], [b]) => a.localeCompare(b))
    .forEach(([date, count]) => {
      console.log(`${date}: ${count.toLocaleString()} snapshots`);
    });
    
  console.log(`\n\nTOTAL NEW SNAPSHOTS: ${data.length.toLocaleString()}`);
  console.log(`UNIQUE VIDEOS: ${new Set(data.map(r => r.video_id)).size.toLocaleString()}`);
}

checkNewSnapshots().catch(console.error);