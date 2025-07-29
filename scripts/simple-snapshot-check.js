import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config({ path: '.env' });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function simpleCheck() {
  // Count snapshots created on or after July 24
  const { count: newCount } = await supabase
    .from('view_snapshots')
    .select('*', { count: 'exact', head: true })
    .gte('created_at', '2025-07-24T00:00:00');
    
  console.log(`Snapshots created since July 24: ${newCount?.toLocaleString()}`);
  
  // Get all snapshots to see dates
  const { data: sample } = await supabase
    .from('view_snapshots')
    .select('created_at')
    .order('created_at', { ascending: false })
    .limit(10);
    
  console.log('\nMost recent snapshots created at:');
  sample?.forEach(s => console.log(s.created_at));
  
  // Count distinct created_at dates
  const { data: dates } = await supabase
    .from('view_snapshots')
    .select('created_at')
    .gte('created_at', '2025-07-24T00:00:00');
    
  const uniqueDates = new Set(dates?.map(d => d.created_at.split('T')[0]));
  console.log(`\nUnique dates with tracking: ${Array.from(uniqueDates).sort().join(', ')}`);
}

simpleCheck().catch(console.error);