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

async function analyzeViewSnapshotsDetailed() {
  console.log('🔍 DETAILED ANALYSIS OF VIEW_SNAPSHOTS TABLE\n');

  // 1. Get complete date distribution
  console.log('📅 COMPLETE DATE DISTRIBUTION:');
  console.log('==============================');
  
  const { data: allDates, error: dateError } = await supabase
    .from('view_snapshots')
    .select('snapshot_date, video_id, view_count, created_at')
    .order('snapshot_date', { ascending: false })
    .limit(10000);

  if (!dateError && allDates) {
    // Group by date
    const dateGroups = {};
    const videosByDate = {};
    
    allDates.forEach(row => {
      const date = row.snapshot_date.split('T')[0];
      if (!dateGroups[date]) {
        dateGroups[date] = 0;
        videosByDate[date] = new Set();
      }
      dateGroups[date]++;
      videosByDate[date].add(row.video_id);
    });
    
    console.log('Snapshots by date (showing all dates):');
    Object.entries(dateGroups)
      .sort(([a], [b]) => b.localeCompare(a))
      .forEach(([date, count]) => {
        console.log(`${date}: ${count.toLocaleString()} snapshots, ${videosByDate[date].size.toLocaleString()} unique videos`);
      });
  }

  // 2. Check for videos with multiple snapshots
  console.log('\n🔄 CHECKING FOR MULTIPLE SNAPSHOTS PER VIDEO:');
  console.log('==============================================');
  
  // Get all snapshots for a sample of videos
  const { data: videoSample, error: sampleError } = await supabase
    .from('view_snapshots')
    .select('video_id')
    .limit(100);

  if (!sampleError && videoSample && videoSample.length > 0) {
    const sampleVideoIds = [...new Set(videoSample.map(v => v.video_id))].slice(0, 5);
    
    for (const videoId of sampleVideoIds) {
      const { data: videoSnapshots, error: videoError } = await supabase
        .from('view_snapshots')
        .select('video_id, snapshot_date, view_count, like_count, created_at')
        .eq('video_id', videoId)
        .order('snapshot_date', { ascending: true });
      
      if (!videoError && videoSnapshots) {
        console.log(`\nVideo ${videoId}:`);
        console.log(`  Total snapshots: ${videoSnapshots.length}`);
        videoSnapshots.forEach(snap => {
          const snapDate = new Date(snap.snapshot_date);
          const createdDate = new Date(snap.created_at);
          console.log(`  - Snapshot: ${snapDate.toISOString()} | Views: ${snap.view_count?.toLocaleString() || 'N/A'} | Created: ${createdDate.toISOString()}`);
        });
      }
    }
  }

  // 3. Check oldest and newest snapshots
  console.log('\n⏱️ SNAPSHOT DATE RANGE:');
  console.log('========================');
  
  const { data: oldest } = await supabase
    .from('view_snapshots')
    .select('snapshot_date, created_at, video_id')
    .order('snapshot_date', { ascending: true })
    .limit(5);
    
  const { data: newest } = await supabase
    .from('view_snapshots')
    .select('snapshot_date, created_at, video_id')
    .order('snapshot_date', { ascending: false })
    .limit(5);
  
  console.log('\nOldest snapshots:');
  oldest?.forEach(snap => {
    console.log(`  ${snap.snapshot_date} (created: ${snap.created_at}) - Video: ${snap.video_id}`);
  });
  
  console.log('\nNewest snapshots:');
  newest?.forEach(snap => {
    console.log(`  ${snap.snapshot_date} (created: ${snap.created_at}) - Video: ${snap.video_id}`);
  });

  // 4. Check for tracking patterns
  console.log('\n📊 TRACKING PATTERNS:');
  console.log('======================');
  
  // Get a video that should have multiple snapshots
  const { data: trackedVideo } = await supabase
    .from('view_snapshots')
    .select('video_id')
    .limit(1);
  
  if (trackedVideo && trackedVideo[0]) {
    const videoId = trackedVideo[0].video_id;
    
    // Get all snapshots for this video
    const { data: allSnapshots, count } = await supabase
      .from('view_snapshots')
      .select('*', { count: 'exact' })
      .eq('video_id', videoId)
      .order('snapshot_date', { ascending: true });
    
    console.log(`\nDetailed tracking for video ${videoId}:`);
    console.log(`Total snapshots: ${count}`);
    
    if (allSnapshots && allSnapshots.length > 0) {
      // Calculate time differences
      for (let i = 1; i < allSnapshots.length; i++) {
        const prev = new Date(allSnapshots[i-1].snapshot_date);
        const curr = new Date(allSnapshots[i].snapshot_date);
        const diffHours = (curr - prev) / (1000 * 60 * 60);
        const diffDays = diffHours / 24;
        
        console.log(`  ${prev.toISOString()} → ${curr.toISOString()} (${diffDays.toFixed(1)} days)`);
      }
    }
  }

  // 5. Summary statistics
  console.log('\n📈 SUMMARY STATISTICS:');
  console.log('======================');
  
  const { count: totalCount } = await supabase
    .from('view_snapshots')
    .select('*', { count: 'exact', head: true });
    
  const { data: uniqueVideos } = await supabase
    .from('view_snapshots')
    .select('video_id');
    
  const uniqueVideoCount = new Set(uniqueVideos?.map(v => v.video_id) || []).size;
  
  console.log(`Total snapshots: ${totalCount?.toLocaleString()}`);
  console.log(`Unique videos tracked: ${uniqueVideoCount.toLocaleString()}`);
  console.log(`Average snapshots per video: ${(totalCount / uniqueVideoCount).toFixed(2)}`);
}

analyzeViewSnapshotsDetailed().catch(console.error);