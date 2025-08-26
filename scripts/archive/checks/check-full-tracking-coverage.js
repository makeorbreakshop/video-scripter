import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config({ path: '.env' });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function checkFullTrackingCoverage() {
  console.log('🔍 CHECKING FULL TRACKING COVERAGE\n');
  
  // Get total videos
  const { count: totalVideos } = await supabase
    .from('videos')
    .select('*', { count: 'exact', head: true });
    
  console.log(`Total videos in database: ${totalVideos?.toLocaleString()}`);
  
  // Process unique videos in batches
  const uniqueVideos = new Set();
  const videoSnapCounts = {};
  let offset = 0;
  const batchSize = 1000;
  
  while (true) {
    const { data: batch } = await supabase
      .from('view_snapshots')
      .select('video_id')
      .gte('created_at', '2025-07-24T00:00:00')
      .range(offset, offset + batchSize - 1);
      
    if (!batch || batch.length === 0) break;
    
    batch.forEach(row => {
      uniqueVideos.add(row.video_id);
      videoSnapCounts[row.video_id] = (videoSnapCounts[row.video_id] || 0) + 1;
    });
    
    offset += batch.length;
    process.stdout.write(`\rProcessing... ${offset} snapshots checked`);
  }
  
  console.log('\n\nRESULTS:');
  console.log(`Unique videos tracked: ${uniqueVideos.size.toLocaleString()}`);
  console.log(`Coverage: ${((uniqueVideos.size / totalVideos) * 100).toFixed(1)}% of all videos`);
  
  // Count videos by number of snapshots
  const snapshotDistribution = {};
  Object.values(videoSnapCounts).forEach(count => {
    snapshotDistribution[count] = (snapshotDistribution[count] || 0) + 1;
  });
  
  console.log('\nVideos by snapshot count:');
  Object.entries(snapshotDistribution)
    .sort(([a], [b]) => parseInt(a) - parseInt(b))
    .forEach(([count, videos]) => {
      console.log(`  ${count} snapshots: ${videos.toLocaleString()} videos`);
    });
}

checkFullTrackingCoverage().catch(console.error);