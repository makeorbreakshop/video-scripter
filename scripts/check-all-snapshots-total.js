import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config({ path: '.env' });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function checkAllSnapshots() {
  console.log('📊 CHECKING ALL SNAPSHOTS IN DATABASE\n');
  
  // Get total count
  const { count: totalSnapshots } = await supabase
    .from('view_snapshots')
    .select('*', { count: 'exact', head: true });
    
  console.log(`Total snapshots: ${totalSnapshots?.toLocaleString()}`);
  
  // Get date range
  const { data: oldest } = await supabase
    .from('view_snapshots')
    .select('created_at, snapshot_date')
    .order('created_at', { ascending: true })
    .limit(1);
    
  const { data: newest } = await supabase
    .from('view_snapshots')
    .select('created_at, snapshot_date')
    .order('created_at', { ascending: false })
    .limit(1);
    
  console.log(`\nOldest snapshot: ${oldest?.[0]?.snapshot_date} (created: ${oldest?.[0]?.created_at})`);
  console.log(`Newest snapshot: ${newest?.[0]?.snapshot_date} (created: ${newest?.[0]?.created_at})`);
  
  // Count unique videos
  let uniqueVideos = new Set();
  let offset = 0;
  
  while (offset < totalSnapshots) {
    const { data: batch } = await supabase
      .from('view_snapshots')
      .select('video_id')
      .range(offset, offset + 999);
      
    if (!batch || batch.length === 0) break;
    
    batch.forEach(row => uniqueVideos.add(row.video_id));
    offset += batch.length;
    
    process.stdout.write(`\rProcessing... ${offset} / ${totalSnapshots}`);
  }
  
  console.log(`\n\nUnique videos with snapshots: ${uniqueVideos.size.toLocaleString()}`);
  console.log(`Average snapshots per video: ${(totalSnapshots / uniqueVideos.size).toFixed(1)}`);
}

checkAllSnapshots().catch(console.error);