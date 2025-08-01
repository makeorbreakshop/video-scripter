import fetch from 'node-fetch';
import dotenv from 'dotenv';

dotenv.config();

async function testVideoAPI() {
  try {
    // Test the specific video
    const videoId = 'FTxxg7diMBw'; // Correct video ID
    const url = `http://localhost:3000/api/videos/${videoId}`;
    
    console.log(`Testing API: ${url}\n`);
    
    const response = await fetch(url);
    const data = await response.json();
    
    console.log('Video Title:', data.title);
    console.log('Channel:', data.channel_name);
    console.log('Views:', data.view_count);
    console.log('Published:', data.published_at);
    
    console.log('\nPerformance Metrics:');
    console.log(data.video_performance_metrics);
    
    console.log('\nPerformance Envelope:');
    console.log('Has envelope data:', !!data.performance_envelope);
    console.log('Envelope length:', data.performance_envelope?.length);
    
    if (data.performance_envelope && data.performance_envelope.length > 0) {
      console.log('\nFirst 3 envelope points:');
      data.performance_envelope.slice(0, 3).forEach(env => {
        console.log(`Day ${env.day_since_published}: P10=${env.p10_views}, P50=${env.p50_views}, P90=${env.p90_views}`);
      });
    }
    
  } catch (error) {
    console.error('Error:', error);
  }
}

testVideoAPI();