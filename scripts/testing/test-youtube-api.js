import 'dotenv/config';

async function testYouTubeAPI() {
  console.log('🔍 Testing YouTube API...\n');
  
  const channelId = 'UCsBjURrPoezykLs9EqgamOA'; // Fireship
  
  try {
    // Test 1: Get channel info
    console.log('1️⃣ Getting channel info...');
    const channelResponse = await fetch(
      `https://www.googleapis.com/youtube/v3/channels?` +
      `part=snippet,statistics,contentDetails&id=${channelId}&key=${process.env.YOUTUBE_API_KEY}`
    );
    
    if (!channelResponse.ok) {
      throw new Error(`API error: ${channelResponse.status}`);
    }
    
    const channelData = await channelResponse.json();
    const channel = channelData.items?.[0];
    
    if (channel) {
      console.log(`✅ Channel: ${channel.snippet.title}`);
      console.log(`   Subscribers: ${parseInt(channel.statistics.subscriberCount).toLocaleString()}`);
      console.log(`   Videos: ${channel.statistics.videoCount}`);
      console.log(`   Custom URL: ${channel.snippet.customUrl}\n`);
    }
    
    // Test 2: Search for related channels
    console.log('2️⃣ Searching for related channels...');
    const searchResponse = await fetch(
      `https://www.googleapis.com/youtube/v3/search?` +
      `part=snippet&q="web development" "programming"&type=channel&maxResults=5&key=${process.env.YOUTUBE_API_KEY}`
    );
    
    if (!searchResponse.ok) {
      throw new Error(`Search API error: ${searchResponse.status}`);
    }
    
    const searchData = await searchResponse.json();
    console.log(`✅ Found ${searchData.items?.length || 0} related channels:\n`);
    
    searchData.items?.forEach((item, idx) => {
      console.log(`${idx + 1}. ${item.snippet.channelTitle}`);
      console.log(`   ID: ${item.snippet.channelId}`);
      console.log(`   Description: ${item.snippet.description.substring(0, 100)}...\n`);
    });
    
    // Calculate API usage
    console.log('📊 API Usage:');
    console.log('   Channel info: 3 units');
    console.log('   Search: 100 units');
    console.log('   Total: 103 units (out of 10,000 daily quota)');
    
  } catch (error) {
    console.error('❌ Error:', error.message);
    console.error('\nMake sure your YOUTUBE_API_KEY is set in .env file');
  }
}

testYouTubeAPI();