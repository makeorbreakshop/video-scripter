/**
 * Test script to verify PSE channels appear in import tab
 */

const API_URL = 'http://localhost:3000/api/google-pse/search';
const QUEUE_URL = 'http://localhost:3000/api/youtube/discovery/unified-queue';

async function testPSEImport() {
  console.log('Testing Google PSE Import Integration...\n');
  
  try {
    // Test with a new search query
    console.log('1. Searching for "Arduino tutorial beginner"');
    const searchResponse = await fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: 'Arduino tutorial beginner' })
    });
    
    const searchData = await searchResponse.json();
    console.log(`✓ Found ${searchData.channelsFound} channels`);
    console.log(`✓ Added ${searchData.channelsAdded} new channels`);
    console.log(`✓ Duplicates: ${searchData.duplicates}`);
    
    if (searchData.channelsAdded > 0) {
      console.log('\n2. Checking if channels appear in import queue...');
      
      // Wait a moment for database to update
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      // Check the unified queue
      const queueResponse = await fetch(
        `${QUEUE_URL}?sortBy=discovery_date&sortOrder=desc&limit=10&method=search&status=pending`
      );
      
      const queueData = await queueResponse.json();
      console.log(`✓ Found ${queueData.channels?.length || 0} channels in import queue`);
      
      if (queueData.channels && queueData.channels.length > 0) {
        console.log('\nLatest channels in queue:');
        queueData.channels.slice(0, 5).forEach((channel, i) => {
          console.log(`${i + 1}. ${channel.channel_metadata?.name || 'Unknown'}`);
          console.log(`   Method: ${channel.discovery_method}`);
          console.log(`   Status: ${channel.validation_status}`);
          console.log(`   Context: ${JSON.stringify(channel.discovery_context?.search_query || {})}`);
        });
      }
    }
    
    console.log('\n✅ Test completed!');
    
  } catch (error) {
    console.error('❌ Test failed:', error.message);
  }
}

// Run the test
testPSEImport();