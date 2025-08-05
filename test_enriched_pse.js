/**
 * Test Google PSE with YouTube channel enrichment
 */

const API_URL = 'http://localhost:3000/api/google-pse/search';

async function testEnrichedPSE() {
  console.log('Testing Google PSE with YouTube enrichment...\n');
  
  try {
    // Use a unique query to avoid duplicates
    const uniqueQuery = `Soldering tutorial ${Date.now() % 1000}`;
    console.log(`Searching for: "${uniqueQuery}"`);
    
    const response = await fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: uniqueQuery })
    });
    
    const data = await response.json();
    
    if (!data.success) {
      console.error('Search failed:', data.error);
      return;
    }
    
    console.log(`\n✅ Search Results:`);
    console.log(`Found: ${data.channelsFound} channels`);
    console.log(`New: ${data.channelsAdded}`);
    console.log(`Duplicates: ${data.duplicates}`);
    
    // Check database for enriched data
    console.log('\n📊 Checking database for enriched channel data...');
    
    // Wait a moment for database to update
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    // Query the discovery queue
    const queueResponse = await fetch(
      'http://localhost:3000/api/youtube/discovery/unified-queue?sortBy=discovery_date&sortOrder=desc&limit=5&method=search'
    );
    
    const queueData = await queueResponse.json();
    
    if (queueData.channels && queueData.channels.length > 0) {
      console.log('\n🎯 Latest channels in import queue:');
      queueData.channels.forEach((channel, i) => {
        const meta = channel.channel_metadata;
        console.log(`\n${i + 1}. ${meta?.title || meta?.name || 'Unknown'}`);
        console.log(`   Channel ID: ${channel.discovered_channel_id}`);
        console.log(`   Subscribers: ${channel.subscriber_count.toLocaleString()}`);
        console.log(`   Videos: ${channel.video_count}`);
        console.log(`   URL: ${meta?.url || 'N/A'}`);
      });
    }
    
  } catch (error) {
    console.error('❌ Test failed:', error.message);
  }
}

testEnrichedPSE();