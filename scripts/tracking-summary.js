import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config({ path: '.env' });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function trackingSummary() {
  console.log('VIEW TRACKING SUMMARY\n');
  
  // Get snapshots grouped by created_at date
  const { data } = await supabase
    .from('view_snapshots')
    .select('created_at, video_id, snapshot_date, view_count')
    .gte('created_at', '2025-07-24T00:00:00')
    .order('created_at', { ascending: true });
    
  // Group by created date
  const trackingRuns = {};
  
  data?.forEach(row => {
    const createdDate = row.created_at.split('T')[0];
    const createdTime = row.created_at.split('T')[1].substring(0, 8);
    
    if (!trackingRuns[createdDate]) {
      trackingRuns[createdDate] = {};
    }
    
    if (!trackingRuns[createdDate][createdTime]) {
      trackingRuns[createdDate][createdTime] = {
        count: 0,
        videos: new Set(),
        snapshotDates: new Set()
      };
    }
    
    trackingRuns[createdDate][createdTime].count++;
    trackingRuns[createdDate][createdTime].videos.add(row.video_id);
    trackingRuns[createdDate][createdTime].snapshotDates.add(row.snapshot_date);
  });
  
  // Display results
  Object.entries(trackingRuns).forEach(([date, times]) => {
    console.log(`\n${date}:`);
    Object.entries(times).forEach(([time, info]) => {
      console.log(`  ${time} - ${info.count.toLocaleString()} snapshots (${info.videos.size.toLocaleString()} videos)`);
      console.log(`           Snapshot dates: ${Array.from(info.snapshotDates).join(', ')}`);
    });
  });
  
  console.log(`\n\nTOTAL: ${data?.length.toLocaleString()} new snapshots since July 24`);
}

trackingSummary().catch(console.error);