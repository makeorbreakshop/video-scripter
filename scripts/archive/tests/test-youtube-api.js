import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

const API_KEY = process.env.YOUTUBE_API_KEY;

if (!API_KEY) {
  console.error('❌ No YOUTUBE_API_KEY found in environment');
  process.exit(1);
}

console.log(`🔑 Using API key: ${API_KEY.substring(0, 10)}...`);

// Test 1: Simple API call to get a popular channel (MrBeast)
async function testAPI() {
  console.log('\n📡 Test 1: Fetching MrBeast channel info...');
  
  const url = `https://www.googleapis.com/youtube/v3/channels?part=snippet,statistics&id=UCX6OQ3DkcsbYNE6H8uQQuVA&key=${API_KEY}`;
  
  try {
    const response = await fetch(url);
    const data = await response.json();
    
    if (response.ok) {
      console.log('✅ API call successful!');
      console.log(`   Channel: ${data.items[0].snippet.title}`);
      console.log(`   Subscribers: ${parseInt(data.items[0].statistics.subscriberCount).toLocaleString()}`);
    } else {
      console.error('❌ API call failed:', response.status);
      console.error('   Error:', JSON.stringify(data.error, null, 2));
    }
  } catch (error) {
    console.error('❌ Network error:', error.message);
  }

  // Test 2: Try the failing channel
  console.log('\n📡 Test 2: Fetching HASfit channel (the one that failed)...');
  
  const url2 = `https://www.googleapis.com/youtube/v3/channels?part=contentDetails&id=UCXIJ2-RSIGn53HA-x9RDevA&key=${API_KEY}`;
  
  try {
    const response = await fetch(url2);
    const data = await response.json();
    
    if (response.ok) {
      console.log('✅ API call successful!');
      console.log('   Uploads playlist:', data.items[0]?.contentDetails?.relatedPlaylists?.uploads);
    } else {
      console.error('❌ API call failed:', response.status);
      console.error('   Error:', JSON.stringify(data.error, null, 2));
    }
  } catch (error) {
    console.error('❌ Network error:', error.message);
  }

  // Test 3: Check quota
  console.log('\n📡 Test 3: Making a search API call (100 quota units)...');
  
  const url3 = `https://www.googleapis.com/youtube/v3/search?part=snippet&q=test&maxResults=1&key=${API_KEY}`;
  
  try {
    const response = await fetch(url3);
    const data = await response.json();
    
    if (response.ok) {
      console.log('✅ Search API call successful!');
      console.log('   Found:', data.items[0]?.snippet?.title || 'No results');
    } else {
      console.error('❌ Search API call failed:', response.status);
      console.error('   Error:', JSON.stringify(data.error, null, 2));
      
      if (data.error?.errors?.[0]?.reason === 'quotaExceeded') {
        console.error('\n🚨 QUOTA EXCEEDED - You have actually hit the YouTube API quota limit!');
      }
    }
  } catch (error) {
    console.error('❌ Network error:', error.message);
  }
}

testAPI();