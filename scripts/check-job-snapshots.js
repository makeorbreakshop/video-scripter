import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config({ path: '.env' });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function checkJobSnapshots() {
  // Check snapshots created during the last job (3:28-3:33 PM)
  const jobStart = '2025-07-28T19:28:00';
  const jobEnd = '2025-07-28T19:34:00';
  
  const { count } = await supabase
    .from('view_snapshots')
    .select('*', { count: 'exact', head: true })
    .gte('created_at', jobStart)
    .lte('created_at', jobEnd);
    
  console.log(`Snapshots created during job (3:28-3:33 PM): ${count?.toLocaleString() || 0}`);
  
  // Check total for today
  const { count: todayCount } = await supabase
    .from('view_snapshots')
    .select('*', { count: 'exact', head: true })
    .eq('snapshot_date', '2025-07-28');
    
  console.log(`Total snapshots for today: ${todayCount?.toLocaleString() || 0}`);
  
  // Check the most recent snapshot timestamps
  const { data: recent } = await supabase
    .from('view_snapshots')
    .select('created_at, video_id')
    .eq('snapshot_date', '2025-07-28')
    .order('created_at', { ascending: false })
    .limit(5);
    
  console.log('\nMost recent snapshots today:');
  recent?.forEach(snap => {
    const time = new Date(snap.created_at);
    console.log(`  ${time.toLocaleTimeString()}: ${snap.video_id}`);
  });
}

checkJobSnapshots().catch(console.error);