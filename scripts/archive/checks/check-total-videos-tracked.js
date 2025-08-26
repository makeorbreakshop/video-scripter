import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config({ path: '.env' });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function checkTotalVideosTracked() {
  console.log('📊 TOTAL VIDEO TRACKING ANALYSIS\n');
  
  // Count total videos in database
  const { count: totalVideos } = await supabase
    .from('videos')
    .select('*', { count: 'exact', head: true });
    
  console.log(`Total videos in database: ${totalVideos?.toLocaleString()}\n`);
  
  // Count unique videos tracked since July 24
  const { data: uniqueVideos } = await supabase
    .from('view_snapshots')
    .select('video_id')
    .gte('created_at', '2025-07-24T00:00:00');
    
  const uniqueVideoSet = new Set(uniqueVideos?.map(v => v.video_id));
  console.log(`Unique videos tracked since July 24: ${uniqueVideoSet.size.toLocaleString()}`);
  
  // Check tracking coverage
  const coverage = (uniqueVideoSet.size / totalVideos) * 100;
  console.log(`Coverage: ${coverage.toFixed(1)}% of all videos\n`);
  
  // Count videos with multiple snapshots
  const videoSnapCounts = {};
  uniqueVideos?.forEach(v => {
    videoSnapCounts[v.video_id] = (videoSnapCounts[v.video_id] || 0) + 1;
  });
  
  let multiSnapVideos = 0;
  Object.values(videoSnapCounts).forEach(count => {
    if (count > 1) multiSnapVideos++;
  });
  
  console.log(`Videos with multiple snapshots: ${multiSnapVideos.toLocaleString()}`);
  console.log(`Average snapshots per video: ${(154289 / uniqueVideoSet.size).toFixed(1)}`);
}

checkTotalVideosTracked().catch(console.error);