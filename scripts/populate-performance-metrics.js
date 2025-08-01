import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config();

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function populatePerformanceMetrics() {
  try {
    console.log('Populating missing performance metrics...\n');
    
    // Get videos without performance metrics
    const { data: videos, error } = await supabase
      .from('videos')
      .select(`
        id,
        title,
        channel_name,
        view_count,
        published_at
      `)
      .not('published_at', 'is', null)
      .not('view_count', 'is', null)
      .limit(100);
    
    if (error) {
      console.error('Error fetching videos:', error);
      return;
    }
    
    console.log(`Found ${videos.length} videos to check\n`);
    
    // Filter out videos that already have metrics
    const videoIds = videos.map(v => v.id);
    const { data: existingMetrics } = await supabase
      .from('video_performance_metrics')
      .select('video_id')
      .in('video_id', videoIds);
    
    const existingVideoIds = new Set(existingMetrics?.map(m => m.video_id) || []);
    const videosToProcess = videos.filter(v => !existingVideoIds.has(v.id));
    
    console.log(`${videosToProcess.length} videos need performance metrics\n`);
    
    if (videosToProcess.length === 0) {
      console.log('All videos already have performance metrics!');
      return;
    }
    
    // Get unique channels
    const channels = [...new Set(videosToProcess.map(v => v.channel_name))];
    const channelBaselines = {};
    
    // Calculate channel baselines
    for (const channel of channels) {
      const { data: channelVideos } = await supabase
        .from('videos')
        .select('view_count, published_at')
        .eq('channel_name', channel)
        .gte('published_at', new Date(Date.now() - 180 * 24 * 60 * 60 * 1000).toISOString())
        .limit(50);
      
      if (channelVideos && channelVideos.length > 5) {
        const vpds = channelVideos.map(v => {
          const age = Math.floor(
            (Date.now() - new Date(v.published_at).getTime()) / (1000 * 60 * 60 * 24)
          );
          return v.view_count / Math.max(age, 1);
        }).sort((a, b) => a - b);
        
        // Use median
        channelBaselines[channel] = vpds[Math.floor(vpds.length / 2)];
      } else {
        channelBaselines[channel] = 1000; // Default
      }
      
      console.log(`Channel ${channel}: baseline VPD = ${Math.round(channelBaselines[channel])}`);
    }
    
    console.log('\nCalculating performance metrics for videos...\n');
    
    // Process each video
    const metrics = [];
    for (const video of videosToProcess) {
      const ageDays = Math.floor(
        (Date.now() - new Date(video.published_at).getTime()) / (1000 * 60 * 60 * 24)
      );
      
      const channelBaselineVpd = channelBaselines[video.channel_name] || 1000;
      const currentVpd = video.view_count / Math.max(ageDays, 1);
      const indexedScore = currentVpd / channelBaselineVpd;
      
      let performanceTier = 'Standard';
      if (indexedScore >= 3) performanceTier = 'Viral';
      else if (indexedScore >= 1.5) performanceTier = 'Outperforming';
      else if (indexedScore >= 0.5) performanceTier = 'On Track';
      else if (indexedScore >= 0.2) performanceTier = 'Underperforming';
      else performanceTier = 'Needs Attention';
      
      metrics.push({
        video_id: video.id,
        channel_name: video.channel_name,
        published_at: video.published_at,
        total_views: video.view_count,
        age_days: ageDays,
        current_vpd: currentVpd,
        initial_vpd: currentVpd, // Simplified
        lifetime_vpd: currentVpd,
        channel_baseline_vpd: channelBaselineVpd,
        indexed_score: indexedScore,
        velocity_trend: 0,
        trend_direction: '→',
        performance_tier: performanceTier,
        last_calculated_at: new Date().toISOString()
      });
      
      console.log(`${video.title.substring(0, 50)}... - ${indexedScore.toFixed(2)}x (${performanceTier})`);
    }
    
    // Insert metrics in batches
    if (metrics.length > 0) {
      console.log(`\nInserting ${metrics.length} performance metrics...`);
      
      const batchSize = 50;
      for (let i = 0; i < metrics.length; i += batchSize) {
        const batch = metrics.slice(i, i + batchSize);
        
        const { error: insertError } = await supabase
          .from('video_performance_metrics')
          .insert(batch);
        
        if (insertError) {
          console.error('Error inserting batch:', insertError);
        } else {
          console.log(`Inserted batch ${Math.floor(i / batchSize) + 1} of ${Math.ceil(metrics.length / batchSize)}`);
        }
      }
      
      console.log('\nDone! Performance metrics populated.');
    } else {
      console.log('No metrics to insert.');
    }
    
  } catch (error) {
    console.error('Error:', error);
  }
}

populatePerformanceMetrics();