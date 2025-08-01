import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config();

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function checkPerformanceData() {
  try {
    // Check if video_performance_metrics table has data
    const { count: totalCount } = await supabase
      .from('video_performance_metrics')
      .select('*', { count: 'exact', head: true });
    
    console.log('Total video_performance_metrics rows:', totalCount);
    
    // Check for recent entries
    const { data: recentMetrics } = await supabase
      .from('video_performance_metrics')
      .select('*')
      .order('last_calculated_at', { ascending: false })
      .limit(5);
    
    console.log('\nRecent performance metrics:', recentMetrics);
    
    // Check if performance_envelopes table has data
    const { count: envelopeCount } = await supabase
      .from('performance_envelopes')
      .select('*', { count: 'exact', head: true });
    
    console.log('\nTotal performance_envelopes rows:', envelopeCount);
    
    // Check a sample envelope
    const { data: sampleEnvelope } = await supabase
      .from('performance_envelopes')
      .select('*')
      .eq('day_since_published', 30)
      .single();
    
    console.log('\nSample envelope (day 30):', sampleEnvelope);
    
    // Look for specific video
    const { data: videoData } = await supabase
      .from('videos')
      .select('id, title, channel_name, view_count, published_at')
      .ilike('title', '%Kaguya-sama%')
      .limit(3);
    
    console.log('\nVideos matching Kaguya-sama:', videoData);
    
    if (videoData && videoData.length > 0) {
      const videoId = videoData[0].id;
      
      // Check if this video has performance metrics
      const { data: metrics } = await supabase
        .from('video_performance_metrics')
        .select('*')
        .eq('video_id', videoId)
        .single();
      
      console.log('\nPerformance metrics for video:', metrics);
      
      // Check view snapshots
      const { data: snapshots, count } = await supabase
        .from('view_snapshots')
        .select('*', { count: 'exact' })
        .eq('video_id', videoId)
        .order('snapshot_date', { ascending: true });
      
      console.log('\nSnapshots for video:', count, 'total');
      if (snapshots && snapshots.length > 0) {
        console.log('First snapshot:', snapshots[0]);
        console.log('Last snapshot:', snapshots[snapshots.length - 1]);
        
        // Check if all snapshots have same view count
        const uniqueViewCounts = new Set(snapshots.map(s => s.view_count));
        console.log('Unique view counts:', uniqueViewCounts.size);
        if (uniqueViewCounts.size === 1) {
          console.log('WARNING: All snapshots have the same view count!');
        }
      }
    }
    
  } catch (error) {
    console.error('Error:', error);
  }
}

checkPerformanceData();