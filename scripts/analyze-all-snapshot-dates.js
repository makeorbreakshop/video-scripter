import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config({ path: '.env' });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('Missing Supabase URL or key. Please check your .env file.');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function analyzeAllSnapshotDates() {
  console.log('🔍 ANALYZING ALL SNAPSHOT DATES\n');

  // Get ALL unique snapshot dates
  console.log('📅 FETCHING ALL UNIQUE SNAPSHOT DATES:');
  console.log('======================================');
  
  // First, get total count
  const { count: totalCount } = await supabase
    .from('view_snapshots')
    .select('*', { count: 'exact', head: true });
  
  console.log(`Total snapshots in database: ${totalCount?.toLocaleString()}\n`);

  // Fetch in batches to analyze all dates
  const batchSize = 50000;
  const dateCount = {};
  const videosByDate = {};
  let offset = 0;
  let hasMore = true;

  console.log('Processing snapshots in batches...');
  
  while (hasMore) {
    const { data: batch, error } = await supabase
      .from('view_snapshots')
      .select('snapshot_date, video_id')
      .range(offset, offset + batchSize - 1)
      .order('snapshot_date', { ascending: false });
    
    if (error) {
      console.error('Error fetching batch:', error);
      break;
    }
    
    if (!batch || batch.length === 0) {
      hasMore = false;
      break;
    }
    
    // Process this batch
    batch.forEach(row => {
      const date = row.snapshot_date.split('T')[0];
      if (!dateCount[date]) {
        dateCount[date] = 0;
        videosByDate[date] = new Set();
      }
      dateCount[date]++;
      videosByDate[date].add(row.video_id);
    });
    
    console.log(`  Processed ${offset + batch.length} snapshots...`);
    
    if (batch.length < batchSize) {
      hasMore = false;
    }
    offset += batchSize;
  }

  // Display all unique dates
  console.log('\n📊 COMPLETE DATE DISTRIBUTION:');
  console.log('================================');
  
  const sortedDates = Object.entries(dateCount)
    .sort(([a], [b]) => a.localeCompare(b));
  
  sortedDates.forEach(([date, count]) => {
    const uniqueVideos = videosByDate[date].size;
    console.log(`${date}: ${count.toLocaleString().padStart(8)} snapshots, ${uniqueVideos.toLocaleString().padStart(6)} unique videos`);
  });

  // Summary
  console.log('\n📈 SUMMARY:');
  console.log('===========');
  console.log(`Total unique dates: ${sortedDates.length}`);
  console.log(`Date range: ${sortedDates[0][0]} to ${sortedDates[sortedDates.length - 1][0]}`);
  
  // Check for patterns in tracking runs
  console.log('\n🔍 TRACKING RUN PATTERNS:');
  console.log('=========================');
  
  // Group by actual tracking runs (dates with significant snapshots)
  const significantDates = sortedDates.filter(([date, count]) => count > 100);
  
  console.log('\nDates with >100 snapshots (likely tracking runs):');
  significantDates.forEach(([date, count]) => {
    const uniqueVideos = videosByDate[date].size;
    console.log(`${date}: ${count.toLocaleString().padStart(8)} snapshots, ${uniqueVideos.toLocaleString().padStart(6)} unique videos`);
  });

  // Analyze gaps between tracking runs
  if (significantDates.length > 1) {
    console.log('\n⏱️ GAPS BETWEEN TRACKING RUNS:');
    console.log('================================');
    
    for (let i = 1; i < significantDates.length; i++) {
      const prevDate = new Date(significantDates[i-1][0]);
      const currDate = new Date(significantDates[i][0]);
      const diffDays = (currDate - prevDate) / (1000 * 60 * 60 * 24);
      
      console.log(`${significantDates[i-1][0]} → ${significantDates[i][0]}: ${diffDays.toFixed(0)} days`);
    }
  }
}

analyzeAllSnapshotDates().catch(console.error);