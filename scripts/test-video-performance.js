import fetch from 'node-fetch';
import dotenv from 'dotenv';

dotenv.config();

const BASE_URL = 'http://localhost:3000';

async function testVideoPerformance() {
  try {
    // Test with the Kaguya-sama video
    const videoId = 'IxFmWHjcdYM';
    
    console.log(`Testing video performance for: ${videoId}\n`);
    
    // Fetch video details
    const response = await fetch(`${BASE_URL}/api/videos/${videoId}`);
    const video = await response.json();
    
    console.log('Video Title:', video.title);
    console.log('Channel:', video.channel_name);
    console.log('Views:', video.view_count?.toLocaleString());
    console.log('Published:', video.published_at);
    console.log('');
    
    // Check performance metrics
    if (video.video_performance_metrics) {
      console.log('Performance Metrics:');
      console.log('- Age (days):', video.video_performance_metrics.age_days);
      console.log('- Current VPD:', video.video_performance_metrics.current_vpd?.toFixed(0));
      console.log('- Channel Baseline VPD:', video.video_performance_metrics.channel_baseline_vpd?.toFixed(0));
      console.log('- Indexed Score:', video.video_performance_metrics.indexed_score?.toFixed(2) + 'x');
      console.log('- Performance Tier:', video.video_performance_metrics.performance_tier);
      console.log('- Trend:', video.video_performance_metrics.trend_direction);
    } else {
      console.log('No performance metrics found!');
    }
    console.log('');
    
    // Check performance envelope
    if (video.performance_envelope && video.performance_envelope.length > 0) {
      console.log('Performance Envelope Data:');
      console.log(`- Total data points: ${video.performance_envelope.length}`);
      
      // Show sample points
      const samples = [0, 30, 90, 180, 365].filter(day => 
        video.performance_envelope.some(e => e.day_since_published === day)
      );
      
      samples.forEach(day => {
        const env = video.performance_envelope.find(e => e.day_since_published === day);
        if (env) {
          console.log(`  Day ${day}: P10=${env.p10_views.toLocaleString()}, P50=${env.p50_views.toLocaleString()}, P90=${env.p90_views.toLocaleString()}`);
        }
      });
    } else {
      console.log('No performance envelope data!');
    }
    console.log('');
    
    // Fetch snapshots
    const snapshotsResponse = await fetch(`${BASE_URL}/api/videos/${videoId}/snapshots`);
    const snapshotsData = await snapshotsResponse.json();
    
    if (snapshotsData.snapshots && snapshotsData.snapshots.length > 0) {
      console.log('View Snapshots:');
      console.log(`- Total snapshots: ${snapshotsData.count}`);
      
      const snapshots = snapshotsData.snapshots;
      console.log(`- First: ${snapshots[0].view_count.toLocaleString()} views on ${snapshots[0].snapshot_date}`);
      console.log(`- Last: ${snapshots[snapshots.length - 1].view_count.toLocaleString()} views on ${snapshots[snapshots.length - 1].snapshot_date}`);
      
      // Check if views are changing
      const uniqueViews = new Set(snapshots.map(s => s.view_count));
      if (uniqueViews.size === 1) {
        console.log('⚠️  WARNING: All snapshots have the same view count!');
      } else {
        console.log('✅ Views are changing over time');
      }
    } else {
      console.log('No snapshots found!');
    }
    
  } catch (error) {
    console.error('Error:', error);
  }
}

// Run the test
console.log('Testing Video Performance API...\n');
testVideoPerformance();