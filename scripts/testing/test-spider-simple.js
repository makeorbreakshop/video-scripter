import 'dotenv/config';
import { YouTubeChannelSpider } from '../lib/youtube-channel-spider.js';

async function testSpider() {
  console.log('🕷️  Starting YouTube Channel Spider Test...\n');
  
  const spider = new YouTubeChannelSpider(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    {
      minSubscribers: 5000,         // Lower threshold for testing
      maxDaysSinceUpload: 180,      // 6 months
      maxChannels: 3,               // Only find 3 channels for quick test
      maxDepth: 1,                  // Only go 1 level deep
      batchSize: 3                  // Save all at once
    }
  );
  
  try {
    // Using a popular tech channel as seed
    const seedChannelId = 'UCsBjURrPoezykLs9EqgamOA'; // Fireship
    
    console.log(`📍 Seed Channel: ${seedChannelId}`);
    console.log('🔍 Discovery Config:');
    console.log('   - Max channels: 3');
    console.log('   - Max depth: 1 level');
    console.log('   - Min subscribers: 5,000\n');
    
    console.log('⏳ Starting discovery (this will take about 30-60 seconds)...\n');
    
    const startTime = Date.now();
    const discovered = await spider.spider(seedChannelId);
    const duration = Math.round((Date.now() - startTime) / 1000);
    
    console.log(`\n✅ Discovery completed in ${duration} seconds!\n`);
    console.log(`📊 Found ${discovered.length} channels:\n`);
    
    discovered.forEach((channel, idx) => {
      console.log(`${idx + 1}. ${channel.channelTitle}`);
      console.log(`   Handle: @${channel.channelHandle || 'unknown'}`);
      console.log(`   Subscribers: ${channel.subscriberCount?.toLocaleString() || 'Unknown'}`);
      console.log(`   Discovery method: ${channel.discoveryMethod}`);
      console.log(`   Depth: ${channel.depth}\n`);
    });
    
  } catch (error) {
    console.error('❌ Spider test failed:', error.message);
    console.error('\nMake sure:');
    console.error('1. Your .env file has valid Supabase credentials');
    console.error('2. The database tables are created');
    console.error('3. You have internet connection');
  }
}

testSpider();