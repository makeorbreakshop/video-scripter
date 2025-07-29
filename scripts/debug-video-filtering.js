import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config({ path: '.env' });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function debugVideoFiltering() {
  console.log('🔍 DEBUGGING VIDEO FILTERING LOGIC\n');
  
  // Step 1: Total videos
  const { count: totalVideos } = await supabase
    .from('videos')
    .select('*', { count: 'exact', head: true });
  console.log(`1. Total videos: ${totalVideos?.toLocaleString()}`);
  
  // Step 2: Videos with today's snapshot
  const today = '2025-07-28';
  const { count: todaySnapshots } = await supabase
    .from('view_snapshots')
    .select('video_id', { count: 'exact', head: true })
    .eq('snapshot_date', today);
  console.log(`2. Videos with today's snapshot: ${todaySnapshots?.toLocaleString()}`);
  
  // Step 3: Expected videos to track
  const expectedToTrack = (totalVideos || 0) - (todaySnapshots || 0);
  console.log(`3. Expected videos to track: ${expectedToTrack.toLocaleString()}`);
  
  // Step 4: Check the actual filtering logic by getting recent video IDs
  const { data: recentSnapshots } = await supabase
    .from('view_snapshots')
    .select('video_id')
    .eq('snapshot_date', today);
  
  const recentVideoIds = new Set(recentSnapshots?.map(s => s.video_id) || []);
  console.log(`4. Unique video IDs with today's snapshot: ${recentVideoIds.size.toLocaleString()}`);
  
  // Step 5: Get a sample of videos and check filtering
  const { data: sampleVideos } = await supabase
    .from('videos')
    .select('id')
    .limit(1000);
    
  if (sampleVideos) {
    const filteredSample = sampleVideos.filter(v => !recentVideoIds.has(v.id));
    console.log(`5. In sample of 1000 videos, ${filteredSample.length} need tracking`);
    console.log(`   That's ${(filteredSample.length / 1000 * 100).toFixed(1)}% of videos needing tracking`);
    
    const projectedTotal = Math.round(filteredSample.length / 1000 * totalVideos);
    console.log(`   Projected total needing tracking: ${projectedTotal.toLocaleString()}`);
  }
}

debugVideoFiltering().catch(console.error);