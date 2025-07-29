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

async function analyzeTrackingHistory() {
  console.log('🔍 ANALYZING VIEW TRACKING HISTORY\n');

  // 1. Get all unique snapshot dates and created dates
  console.log('📅 ANALYZING TRACKING RUNS BY CREATED_AT:');
  console.log('=========================================\n');
  
  // Get a large sample to analyze
  const { data: snapshots, error } = await supabase
    .from('view_snapshots')
    .select('video_id, snapshot_date, created_at, view_count')
    .order('created_at', { ascending: true })
    .limit(100000);
  
  if (error) {
    console.error('Error fetching snapshots:', error);
    return;
  }

  // Group by created_at date (when the tracking actually ran)
  const runsByCreatedDate = {};
  const snapshotDatesByRun = {};
  
  snapshots.forEach(row => {
    const createdDate = row.created_at.split('T')[0];
    const snapshotDate = row.snapshot_date;
    
    if (!runsByCreatedDate[createdDate]) {
      runsByCreatedDate[createdDate] = {
        count: 0,
        videos: new Set(),
        snapshotDates: new Set()
      };
    }
    
    runsByCreatedDate[createdDate].count++;
    runsByCreatedDate[createdDate].videos.add(row.video_id);
    runsByCreatedDate[createdDate].snapshotDates.add(snapshotDate);
  });

  console.log('TRACKING RUNS (by when they were executed):');
  console.log('-------------------------------------------');
  Object.entries(runsByCreatedDate)
    .sort(([a], [b]) => a.localeCompare(b))
    .forEach(([date, info]) => {
      console.log(`\n${date}:`);
      console.log(`  - Snapshots created: ${info.count.toLocaleString()}`);
      console.log(`  - Unique videos: ${info.videos.size.toLocaleString()}`);
      console.log(`  - Snapshot dates used: ${Array.from(info.snapshotDates).sort().join(', ')}`);
    });

  // 2. Analyze the pattern of snapshot_date vs created_at
  console.log('\n\n📊 SNAPSHOT DATE PATTERNS:');
  console.log('==========================\n');
  
  // Sample some videos to see their tracking history
  const sampleVideos = ['BTPDRVWTDF8', 'c6mJJvaE0WY', 'ZxxPwsKDJRc'];
  
  for (const videoId of sampleVideos) {
    const { data: videoHistory, error: videoError } = await supabase
      .from('view_snapshots')
      .select('*')
      .eq('video_id', videoId)
      .order('created_at', { ascending: true });
    
    if (!videoError && videoHistory && videoHistory.length > 0) {
      console.log(`\nVideo ${videoId} tracking history:`);
      console.log('snapshot_date -> created_at (views)');
      console.log('-----------------------------------');
      
      videoHistory.forEach(snap => {
        const snapDate = snap.snapshot_date;
        const createdDate = new Date(snap.created_at).toISOString().split('T')[0];
        const createdTime = new Date(snap.created_at).toISOString().split('T')[1].split('.')[0];
        console.log(`${snapDate} -> ${createdDate} ${createdTime} (${snap.view_count?.toLocaleString() || 'N/A'} views)`);
      });
    }
  }

  // 3. Understand the different snapshot dates
  console.log('\n\n🔍 UNIQUE SNAPSHOT DATES IN DATABASE:');
  console.log('=====================================\n');
  
  // Get all unique snapshot dates
  const { data: allDates, error: datesError } = await supabase
    .from('view_snapshots')
    .select('snapshot_date')
    .limit(50000);
  
  if (!datesError && allDates) {
    const uniqueDates = new Set();
    allDates.forEach(row => {
      uniqueDates.add(row.snapshot_date);
    });
    
    const sortedDates = Array.from(uniqueDates).sort();
    console.log(`Total unique snapshot dates: ${sortedDates.length}`);
    console.log('\nAll unique snapshot dates:');
    sortedDates.forEach(date => {
      // Count how many snapshots have this date
      const count = allDates.filter(row => row.snapshot_date === date).length;
      console.log(`  ${date}: ${count.toLocaleString()} snapshots`);
    });
  }

  // 4. Summary
  console.log('\n\n📈 SUMMARY:');
  console.log('===========\n');
  
  const { count: totalCount } = await supabase
    .from('view_snapshots')
    .select('*', { count: 'exact', head: true });
  
  console.log(`Total snapshots: ${totalCount?.toLocaleString()}`);
  console.log(`Tracking runs identified: ${Object.keys(runsByCreatedDate).length}`);
  
  // Calculate videos with multiple snapshots
  const videoSnapshotCounts = {};
  snapshots.forEach(row => {
    videoSnapshotCounts[row.video_id] = (videoSnapshotCounts[row.video_id] || 0) + 1;
  });
  
  const videosWithMultiple = Object.entries(videoSnapshotCounts)
    .filter(([_, count]) => count > 1).length;
  
  console.log(`Videos with multiple snapshots: ${videosWithMultiple.toLocaleString()} out of ${Object.keys(videoSnapshotCounts).length.toLocaleString()}`);
}

analyzeTrackingHistory().catch(console.error);