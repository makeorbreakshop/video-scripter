/**
 * Quick test script to verify Google PSE endpoint functionality
 */

const API_URL = 'http://localhost:3000/api/google-pse/search';

async function testPSEEndpoint() {
  console.log('Testing Google PSE Search Endpoint...\n');
  
  try {
    // Test 1: Valid search query
    console.log('Test 1: Valid search query');
    const response1 = await fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: 'Circuit design tutorials' })
    });
    
    const data1 = await response1.json();
    console.log('Response:', data1);
    console.log(`✓ Status: ${response1.status}`);
    console.log(`✓ Channels found: ${data1.channelsFound || 0}`);
    console.log(`✓ Channels added: ${data1.channelsAdded || 0}`);
    console.log(`✓ Duplicates: ${data1.duplicates || 0}`);
    
    if (data1.channels && data1.channels.length > 0) {
      console.log('\nDiscovered channels:');
      data1.channels.forEach((channel, i) => {
        console.log(`${i + 1}. ${channel.name} (${channel.confidence} confidence)`);
        console.log(`   URL: ${channel.url}`);
        console.log(`   New: ${channel.isNew ? 'Yes' : 'No'}`);
      });
    }
    
    // Test 2: Empty query (should fail)
    console.log('\n\nTest 2: Empty query (should return error)');
    const response2 = await fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: '' })
    });
    
    const data2 = await response2.json();
    console.log(`✓ Status: ${response2.status}`);
    console.log(`✓ Error: ${data2.error || 'None'}`);
    
    // Test 3: Check quota
    console.log('\n\nTest 3: Check quota status');
    const quotaResponse = await fetch('http://localhost:3000/api/google-pse/quota');
    const quotaData = await quotaResponse.json();
    console.log('Quota status:', quotaData.quota);
    
    console.log('\n✅ All tests completed!');
    
  } catch (error) {
    console.error('❌ Test failed:', error.message);
    console.error(error);
  }
}

// Run the test
testPSEEndpoint();