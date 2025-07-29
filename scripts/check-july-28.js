import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config({ path: '.env' });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function checkJuly28() {
  // Count snapshots created on July 28
  const { count } = await supabase
    .from('view_snapshots')
    .select('*', { count: 'exact', head: true })
    .gte('created_at', '2025-07-28T00:00:00')
    .lt('created_at', '2025-07-29T00:00:00');
    
  console.log(`Snapshots created on July 28: ${count?.toLocaleString()}`);
  
  // Get a sample
  const { data: sample } = await supabase
    .from('view_snapshots')
    .select('video_id, snapshot_date, created_at')
    .gte('created_at', '2025-07-28T00:00:00')
    .limit(10);
    
  console.log('\nSample of July 28 snapshots:');
  sample?.forEach(s => {
    console.log(`Video: ${s.video_id} | Snapshot: ${s.snapshot_date} | Created: ${s.created_at}`);
  });
  
  // Count by hour
  const { data: all } = await supabase
    .from('view_snapshots')
    .select('created_at')
    .gte('created_at', '2025-07-28T00:00:00')
    .lt('created_at', '2025-07-29T00:00:00');
    
  const byHour = {};
  all?.forEach(row => {
    const hour = row.created_at.substring(0, 13);
    byHour[hour] = (byHour[hour] || 0) + 1;
  });
  
  console.log('\nSnapshots by hour on July 28:');
  Object.entries(byHour)
    .sort(([a], [b]) => a.localeCompare(b))
    .forEach(([hour, count]) => {
      console.log(`${hour}: ${count.toLocaleString()}`);
    });
}

checkJuly28().catch(console.error);