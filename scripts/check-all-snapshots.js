import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config({ path: '.env' });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

const supabase = createClient(supabaseUrl, supabaseKey);

async function checkAllSnapshots() {
  // Get total count
  const { count: totalCount } = await supabase
    .from('view_snapshots')
    .select('*', { count: 'exact', head: true });
    
  console.log(`Total snapshots in database: ${totalCount?.toLocaleString()}`);
  
  // Get date range
  const { data: dateRange } = await supabase
    .rpc('execute_sql', {
      query: `
        SELECT 
          MIN(created_at) as earliest,
          MAX(created_at) as latest,
          COUNT(DISTINCT DATE(created_at)) as tracking_days,
          COUNT(DISTINCT video_id) as unique_videos
        FROM view_snapshots
      `
    });
    
  if (dateRange && dateRange[0]) {
    console.log(`\nDate range: ${dateRange[0].earliest} to ${dateRange[0].latest}`);
    console.log(`Tracking days: ${dateRange[0].tracking_days}`);
    console.log(`Unique videos tracked: ${dateRange[0].unique_videos?.toLocaleString()}`);
  }
  
  // Check recent tracking runs
  const { data: recentRuns } = await supabase
    .rpc('execute_sql', {
      query: `
        SELECT 
          DATE(created_at) as run_date,
          COUNT(*) as snapshots,
          COUNT(DISTINCT video_id) as videos
        FROM view_snapshots
        WHERE created_at >= '2025-07-20'
        GROUP BY DATE(created_at)
        ORDER BY run_date DESC
      `
    });
    
  console.log('\nRecent tracking runs:');
  if (recentRuns) {
    recentRuns.forEach(run => {
      console.log(`${run.run_date}: ${run.snapshots.toLocaleString()} snapshots (${run.videos.toLocaleString()} videos)`);
    });
  }
}

checkAllSnapshots().catch(console.error);