/**
 * Test Performance API Endpoints
 */

async function testAPIs() {
  const baseURL = 'http://localhost:3000/api/performance';
  
  console.log('🧪 Testing Performance API Endpoints...\n');
  
  try {
    // 1. Test envelope status
    console.log('1️⃣ Testing GET /calculate-envelope (status check)...');
    const envelopeStatus = await fetch(`${baseURL}/calculate-envelope`);
    const envelopeData = await envelopeStatus.json();
    console.log('Envelope Status:', {
      status: envelopeData.status,
      total_days: envelopeData.total_days,
      last_updated: envelopeData.last_updated
    });
    console.log('Sample curves:', envelopeData.sample_curves?.slice(0, 3));
    
    // 2. Test channel baseline (using a known channel)
    console.log('\n2️⃣ Testing GET /channel-baseline...');
    // First, let's find a channel with data
    const { createClient } = require('@supabase/supabase-js');
    require('dotenv').config();
    
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY
    );
    
    // Get a channel that has view snapshots
    const { data: channelWithData } = await supabase
      .from('view_snapshots')
      .select('channel_id')
      .lte('days_since_published', 7)
      .not('channel_id', 'is', null)
      .limit(1);
    
    if (channelWithData && channelWithData[0]) {
      const channelId = channelWithData[0].channel_id;
      console.log(`Testing with channel: ${channelId}`);
      
      const baselineResponse = await fetch(`${baseURL}/channel-baseline?channel_id=${channelId}`);
      const baselineData = await baselineResponse.json();
      console.log('Channel Baseline:', baselineData);
    } else {
      console.log('No channels found with first-week data');
    }
    
    // 3. Test video classification
    console.log('\n3️⃣ Testing GET /classify-video...');
    // Get a video to test with
    const { data: videoToTest } = await supabase
      .from('videos')
      .select('id, title')
      .not('view_count', 'is', null)
      .limit(1);
    
    if (videoToTest && videoToTest[0]) {
      const videoId = videoToTest[0].id;
      console.log(`Testing with video: ${videoToTest[0].title}`);
      
      const classifyResponse = await fetch(`${baseURL}/classify-video?video_id=${videoId}`);
      const classifyData = await classifyResponse.json();
      console.log('Video Classification:', {
        video_id: classifyData.video_id,
        actual_views: classifyData.actual_views,
        expected_views: classifyData.expected_views,
        performance_ratio: classifyData.performance_ratio?.toFixed(2),
        category: classifyData.performance_category,
        description: classifyData.description
      });
    }
    
    // 4. Test batch classification
    console.log('\n4️⃣ Testing POST /classify-video (batch)...');
    const { data: videoBatch } = await supabase
      .from('videos')
      .select('id')
      .not('view_count', 'is', null)
      .limit(5);
    
    if (videoBatch && videoBatch.length > 0) {
      const videoIds = videoBatch.map(v => v.id);
      
      const batchResponse = await fetch(`${baseURL}/classify-video`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          video_ids: videoIds,
          update_database: false 
        })
      });
      
      const batchData = await batchResponse.json();
      console.log('Batch Classification Summary:', batchData.categories_summary);
      console.log('Sample results:', batchData.classifications?.slice(0, 2));
    }
    
    console.log('\n✅ API testing complete!');
    
  } catch (error) {
    console.error('❌ Error testing APIs:', error.message);
  }
}

// Run the tests
testAPIs().catch(console.error);