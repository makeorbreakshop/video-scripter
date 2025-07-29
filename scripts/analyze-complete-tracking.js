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

async function analyzeCompleteTracking() {
  console.log('🔍 COMPLETE VIEW TRACKING ANALYSIS\n');

  // Get total count first
  const { count: totalCount } = await supabase
    .from('view_snapshots')
    .select('*', { count: 'exact', head: true });
  
  console.log(`Total snapshots in database: ${totalCount?.toLocaleString()}\n`);

  // Process in larger batches to get complete picture
  const batchSize = 100000;
  let offset = 0;
  let hasMore = true;
  
  const trackingRuns = {}; // Group by created_at timestamp
  const snapshotDates = {}; // Count by snapshot_date
  const videoSnapshots = {}; // Track snapshots per video
  
  console.log('Processing all snapshots...\n');
  
  while (hasMore && offset < totalCount) {
    const { data: batch, error } = await supabase
      .from('view_snapshots')
      .select('video_id, snapshot_date, created_at, view_count')
      .order('created_at', { ascending: true })
      .range(offset, offset + batchSize - 1);
    
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
      // Track by created_at (when tracking ran)
      const createdTime = row.created_at;
      if (!trackingRuns[createdTime]) {
        trackingRuns[createdTime] = {
          videos: new Set(),
          snapshotDate: row.snapshot_date
        };
      }
      trackingRuns[createdTime].videos.add(row.video_id);
      
      // Track by snapshot_date
      const snapDate = row.snapshot_date;
      snapshotDates[snapDate] = (snapshotDates[snapDate] || 0) + 1;
      
      // Track snapshots per video
      if (!videoSnapshots[row.video_id]) {
        videoSnapshots[row.video_id] = [];
      }
      videoSnapshots[row.video_id].push({
        snapshot_date: row.snapshot_date,
        created_at: row.created_at,
        view_count: row.view_count
      });
    });
    
    console.log(`Processed ${Math.min(offset + batch.length, totalCount)} / ${totalCount} snapshots...`);
    
    if (batch.length < batchSize) {
      hasMore = false;
    }
    offset += batchSize;
  }

  // Analyze tracking runs
  console.log('\n\n📅 TRACKING RUNS ANALYSIS:');
  console.log('==========================\n');
  
  // Group runs by date
  const runsByDate = {};
  Object.entries(trackingRuns).forEach(([timestamp, data]) => {
    const date = timestamp.split('T')[0];
    const time = timestamp.split('T')[1].split('.')[0];
    
    if (!runsByDate[date]) {
      runsByDate[date] = [];
    }
    
    runsByDate[date].push({
      time: time,
      timestamp: timestamp,
      videoCount: data.videos.size,
      snapshotDate: data.snapshotDate
    });
  });
  
  // Display runs by date
  Object.entries(runsByDate)
    .sort(([a], [b]) => a.localeCompare(b))
    .forEach(([date, runs]) => {
      console.log(`\n${date}: ${runs.length} tracking run(s)`);
      
      // Group runs by identical timestamps
      const uniqueRuns = {};
      runs.forEach(run => {
        if (!uniqueRuns[run.timestamp]) {
          uniqueRuns[run.timestamp] = {
            time: run.time,
            videos: 0,
            snapshotDate: run.snapshotDate
          };
        }
        uniqueRuns[run.timestamp].videos += run.videoCount;
      });
      
      Object.entries(uniqueRuns)
        .sort(([a], [b]) => a.localeCompare(b))
        .forEach(([timestamp, info]) => {
          console.log(`  ${info.time}: ${info.videos.toLocaleString()} videos (snapshot_date: ${info.snapshotDate})`);
        });
    });

  // Display snapshot dates distribution
  console.log('\n\n📊 SNAPSHOT DATES DISTRIBUTION:');
  console.log('================================\n');
  
  Object.entries(snapshotDates)
    .sort(([a], [b]) => a.localeCompare(b))
    .forEach(([date, count]) => {
      console.log(`${date}: ${count.toLocaleString()} snapshots`);
    });

  // Analyze videos with multiple snapshots
  console.log('\n\n📹 VIDEOS WITH MULTIPLE SNAPSHOTS:');
  console.log('===================================\n');
  
  let videosWithMultiple = 0;
  const snapshotCounts = {};
  
  Object.entries(videoSnapshots).forEach(([videoId, snapshots]) => {
    const count = snapshots.length;
    snapshotCounts[count] = (snapshotCounts[count] || 0) + 1;
    
    if (count > 1) {
      videosWithMultiple++;
    }
  });
  
  console.log(`Total unique videos: ${Object.keys(videoSnapshots).length.toLocaleString()}`);
  console.log(`Videos with multiple snapshots: ${videosWithMultiple.toLocaleString()}`);
  
  console.log('\nSnapshot count distribution:');
  Object.entries(snapshotCounts)
    .sort(([a], [b]) => parseInt(a) - parseInt(b))
    .forEach(([count, videos]) => {
      console.log(`  ${count} snapshot(s): ${videos.toLocaleString()} videos`);
    });

  // Show sample of videos with most snapshots
  console.log('\n\n🏆 VIDEOS WITH MOST SNAPSHOTS:');
  console.log('===============================\n');
  
  const sortedVideos = Object.entries(videoSnapshots)
    .sort(([, a], [, b]) => b.length - a.length)
    .slice(0, 5);
  
  sortedVideos.forEach(([videoId, snapshots]) => {
    console.log(`\nVideo ${videoId}: ${snapshots.length} snapshots`);
    snapshots.forEach(snap => {
      console.log(`  ${snap.snapshot_date} (created: ${snap.created_at.split('T')[0]} ${snap.created_at.split('T')[1].split('.')[0]}) - ${snap.view_count?.toLocaleString() || 'N/A'} views`);
    });
  });
}

analyzeCompleteTracking().catch(console.error);