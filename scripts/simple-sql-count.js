import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config({ path: '.env' });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function simpleCount() {
  const { data, error } = await supabase.rpc('execute_sql', {
    query: `
      SELECT 
        DATE(created_at) as tracking_date,
        COUNT(*) as snapshots_count,
        COUNT(DISTINCT video_id) as unique_videos
      FROM view_snapshots
      GROUP BY DATE(created_at)
      ORDER BY tracking_date DESC
    `
  });
  
  if (error) {
    console.error('Error:', error);
    return;
  }
  
  console.log('TRACKING RUNS BY DATE:\n');
  data.forEach(row => {
    console.log(`${row.tracking_date}: ${row.snapshots_count.toLocaleString()} snapshots (${row.unique_videos.toLocaleString()} videos)`);
  });
}

simpleCount().catch(console.error);