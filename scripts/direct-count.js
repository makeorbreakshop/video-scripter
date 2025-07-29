import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config({ path: '.env' });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function directCount() {
  // Get counts for each date
  const dates = ['2025-07-22', '2025-07-23', '2025-07-24', '2025-07-25', '2025-07-26', '2025-07-27', '2025-07-28'];
  
  console.log('SNAPSHOT COUNTS BY DATE:\n');
  
  for (const date of dates) {
    const { count } = await supabase
      .from('view_snapshots')
      .select('*', { count: 'exact', head: true })
      .gte('created_at', `${date}T00:00:00`)
      .lt('created_at', `${date}T23:59:59`);
      
    if (count > 0) {
      console.log(`${date}: ${count.toLocaleString()} snapshots`);
    }
  }
  
  // Total count
  const { count: total } = await supabase
    .from('view_snapshots')
    .select('*', { count: 'exact', head: true });
    
  console.log(`\nTOTAL: ${total.toLocaleString()} snapshots`);
}

directCount().catch(console.error);