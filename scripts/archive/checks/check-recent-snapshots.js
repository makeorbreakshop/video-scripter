import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config({ path: '.env' });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function checkRecentSnapshots() {
  // Check snapshots created in the last 10 minutes
  const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000).toISOString();
  
  const { count } = await supabase
    .from('view_snapshots')
    .select('*', { count: 'exact', head: true })
    .gte('created_at', tenMinutesAgo);
    
  console.log(`Snapshots created in last 10 minutes: ${count?.toLocaleString()}`);
  
  // Check unique created_at timestamps
  const { data: recentBatches } = await supabase
    .from('view_snapshots')
    .select('created_at')
    .gte('created_at', tenMinutesAgo)
    .order('created_at', { ascending: false })
    .limit(100);
    
  if (recentBatches) {
    const uniqueTimestamps = new Set(recentBatches.map(r => r.created_at));
    console.log(`\nUnique batch timestamps: ${uniqueTimestamps.size}`);
    
    // Show first few
    const timestamps = Array.from(uniqueTimestamps).slice(0, 5);
    console.log('\nMost recent batch times:');
    timestamps.forEach(ts => {
      const time = new Date(ts);
      console.log(`  ${time.toLocaleTimeString()}`);
    });
  }
  
  // Check today's total
  const today = new Date().toISOString().split('T')[0];
  const { count: todayCount } = await supabase
    .from('view_snapshots')
    .select('*', { count: 'exact', head: true })
    .eq('snapshot_date', today);
    
  console.log(`\nTotal snapshots for ${today}: ${todayCount?.toLocaleString()}`);
}

checkRecentSnapshots().catch(console.error);