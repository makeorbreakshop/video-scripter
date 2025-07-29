const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function checkSnapshots() {
  // Get snapshot counts by date
  const { data: counts, error } = await supabase
    .from('view_snapshots')
    .select('snapshot_date')
    .gte('snapshot_date', '2025-07-24');
    
  if (error) {
    console.error('Error:', error);
    return;
  }
  
  // Count by date
  const dateCounts = {};
  counts.forEach(row => {
    dateCounts[row.snapshot_date] = (dateCounts[row.snapshot_date] || 0) + 1;
  });
  
  console.log('\nSnapshots by date since July 24:');
  Object.entries(dateCounts)
    .sort(([a], [b]) => a.localeCompare(b))
    .forEach(([date, count]) => {
      console.log(`${date}: ${count.toLocaleString()} snapshots`);
    });
    
  console.log(`\nTotal snapshots since July 24: ${counts.length.toLocaleString()}`);
  
  // Get unique videos with multiple snapshots
  const { data: multiSnapVideos, error: error2 } = await supabase.rpc('execute_sql', {
    query: `
      SELECT video_id, COUNT(*) as snapshot_count
      FROM view_snapshots
      WHERE snapshot_date >= '2025-07-24'
      GROUP BY video_id
      HAVING COUNT(*) > 1
      LIMIT 10
    `
  });
  
  if (!error2 && multiSnapVideos) {
    console.log(`\nVideos with multiple snapshots: ${multiSnapVideos.length}`);
  }
}

checkSnapshots();