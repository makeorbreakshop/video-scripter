import dotenv from 'dotenv';

dotenv.config({ path: '.env' });

async function testYouTubeAPI() {
  const apiKey = process.env.YOUTUBE_API_KEY;
  
  if (!apiKey) {
    console.error('❌ YOUTUBE_API_KEY not found in environment');
    return;
  }
  
  console.log('✅ API Key found:', apiKey.substring(0, 10) + '...');
  
  // Test with a known video ID
  const testVideoId = '6cSq6QxvKRo';
  
  try {
    console.log('\n🔍 Testing YouTube API...');
    const response = await fetch(
      `https://www.googleapis.com/youtube/v3/videos?` +
      `part=statistics&` +
      `id=${testVideoId}&` +
      `key=${apiKey}`
    );
    
    console.log('Response status:', response.status);
    
    if (!response.ok) {
      const error = await response.text();
      console.error('❌ API Error:', error);
      return;
    }
    
    const data = await response.json();
    console.log('✅ API Response:', JSON.stringify(data, null, 2));
    
    if (data.items && data.items.length > 0) {
      const stats = data.items[0].statistics;
      console.log('\n📊 Video Stats:');
      console.log(`  Views: ${parseInt(stats.viewCount).toLocaleString()}`);
      console.log(`  Likes: ${parseInt(stats.likeCount).toLocaleString()}`);
      console.log(`  Comments: ${parseInt(stats.commentCount).toLocaleString()}`);
    }
  } catch (error) {
    console.error('❌ Fetch error:', error);
  }
}

testYouTubeAPI().catch(console.error);