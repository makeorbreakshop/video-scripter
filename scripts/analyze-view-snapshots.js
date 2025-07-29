import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config({ path: '.env' });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('Missing Supabase URL or key. Please check your .env.local file.');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function analyzeViewSnapshots() {
  console.log('🔍 Analyzing view_snapshots table...\n');

  // 1. Count of snapshots by snapshot_date
  console.log('📅 1. COUNT OF SNAPSHOTS BY SNAPSHOT DATE:');
  console.log('==========================================');
  
  const { data: snapshotsByDate, error: error1 } = await supabase
    .rpc('execute_sql', {
      query: `
        SELECT 
            snapshot_date::date as snapshot_day,
            COUNT(*) as snapshot_count,
            COUNT(DISTINCT video_id) as unique_videos
        FROM view_snapshots
        GROUP BY snapshot_date::date
        ORDER BY snapshot_date::date DESC
        LIMIT 20
      `
    });

  if (error1) {
    // Try direct query
    const { data, error } = await supabase
      .from('view_snapshots')
      .select('snapshot_date, video_id')
      .order('snapshot_date', { ascending: false });
    
    if (!error && data) {
      // Group by date manually
      const dateGroups = {};
      data.forEach(row => {
        const date = row.snapshot_date.split('T')[0];
        if (!dateGroups[date]) {
          dateGroups[date] = { count: 0, videos: new Set() };
        }
        dateGroups[date].count++;
        dateGroups[date].videos.add(row.video_id);
      });
      
      const sorted = Object.entries(dateGroups)
        .sort(([a], [b]) => b.localeCompare(a))
        .slice(0, 20);
      
      sorted.forEach(([date, info]) => {
        console.log(`${date}: ${info.count} snapshots, ${info.videos.size} unique videos`);
      });
    }
  } else if (snapshotsByDate) {
    snapshotsByDate.forEach(row => {
      console.log(`${row.snapshot_day}: ${row.snapshot_count} snapshots, ${row.unique_videos} unique videos`);
    });
  }

  // 2. Distribution of snapshots across different dates
  console.log('\n📊 2. DISTRIBUTION OF SNAPSHOTS:');
  console.log('=================================');
  
  const { data: distribution, error: error2 } = await supabase
    .from('view_snapshots')
    .select('snapshot_date')
    .order('snapshot_date', { ascending: false })
    .limit(1000);

  if (!error2 && distribution) {
    const hourlyDist = {};
    distribution.forEach(row => {
      const hour = new Date(row.snapshot_date).getHours();
      hourlyDist[hour] = (hourlyDist[hour] || 0) + 1;
    });
    
    console.log('Snapshots by hour of day:');
    Object.entries(hourlyDist)
      .sort(([a], [b]) => parseInt(a) - parseInt(b))
      .forEach(([hour, count]) => {
        console.log(`Hour ${hour.padStart(2, '0')}: ${count} snapshots`);
      });
  }

  // 3. Count unique videos with multiple snapshots
  console.log('\n📹 3. VIDEOS WITH MULTIPLE SNAPSHOTS:');
  console.log('======================================');
  
  const { data: multiSnapVideos, error: error3 } = await supabase
    .from('view_snapshots')
    .select('video_id');

  if (!error3 && multiSnapVideos) {
    const videoCounts = {};
    multiSnapVideos.forEach(row => {
      videoCounts[row.video_id] = (videoCounts[row.video_id] || 0) + 1;
    });
    
    const multipleSnapshots = Object.entries(videoCounts)
      .filter(([_, count]) => count > 1);
    
    console.log(`Total videos with snapshots: ${Object.keys(videoCounts).length}`);
    console.log(`Videos with multiple snapshots: ${multipleSnapshots.length}`);
    
    // Show distribution
    const countDist = {};
    multipleSnapshots.forEach(([_, count]) => {
      countDist[count] = (countDist[count] || 0) + 1;
    });
    
    console.log('\nSnapshot count distribution:');
    Object.entries(countDist)
      .sort(([a], [b]) => parseInt(a) - parseInt(b))
      .forEach(([count, videos]) => {
        console.log(`${count} snapshots: ${videos} videos`);
      });
  }

  // 4. Sample of videos with their snapshot dates
  console.log('\n📺 4. SAMPLE VIDEOS WITH SNAPSHOT DATES:');
  console.log('=========================================');
  
  // Get a few videos with multiple snapshots
  const { data: sampleVideos, error: error4 } = await supabase
    .from('view_snapshots')
    .select('video_id, snapshot_date, view_count, like_count')
    .in('video_id', ['UC6107grRI4m0o2-emgoDnAA', 'UCL_f53ZEJxp8TtlOkHwMV9Q', 'UCjgpFI5dU-D1-kh9H1muoxQ'])
    .order('video_id')
    .order('snapshot_date', { ascending: true })
    .limit(50);

  if (!error4 && sampleVideos) {
    let currentVideo = null;
    sampleVideos.forEach(row => {
      if (row.video_id !== currentVideo) {
        currentVideo = row.video_id;
        console.log(`\nVideo: ${row.video_id}`);
      }
      const date = new Date(row.snapshot_date);
      console.log(`  ${date.toISOString().split('T')[0]} ${date.toTimeString().split(' ')[0]} - Views: ${row.view_count?.toLocaleString() || 'N/A'}, Likes: ${row.like_count?.toLocaleString() || 'N/A'}`);
    });
  }

  // 5. Check for recent tracking runs
  console.log('\n⏰ 5. RECENT TRACKING RUNS:');
  console.log('===========================');
  
  const { data: recentRuns, error: error5 } = await supabase
    .from('view_snapshots')
    .select('snapshot_date')
    .order('snapshot_date', { ascending: false })
    .limit(100);

  if (!error5 && recentRuns) {
    const uniqueDates = new Set();
    recentRuns.forEach(row => {
      uniqueDates.add(new Date(row.snapshot_date).toISOString());
    });
    
    const sortedDates = Array.from(uniqueDates).sort().reverse().slice(0, 10);
    console.log('Last 10 unique snapshot timestamps:');
    sortedDates.forEach(date => {
      console.log(`  ${date}`);
    });
  }

  // 6. Get total counts
  console.log('\n📈 6. TOTAL COUNTS:');
  console.log('===================');
  
  const { count: totalSnapshots } = await supabase
    .from('view_snapshots')
    .select('*', { count: 'exact', head: true });
    
  console.log(`Total snapshots in database: ${totalSnapshots?.toLocaleString() || 'N/A'}`);
}

analyzeViewSnapshots().catch(console.error);