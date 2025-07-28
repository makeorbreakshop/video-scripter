import { YouTubeChannelSpider } from '../lib/youtube-channel-spider';
import dotenv from 'dotenv';

dotenv.config();

async function testSpider() {
  console.log('Starting YouTube Channel Spider test...');
  
  const spider = new YouTubeChannelSpider(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    {
      minSubscribers: 10000,        // Minimum 10K subscribers
      maxDaysSinceUpload: 90,       // Must have uploaded in last 90 days
      maxChannels: 50,              // Find up to 50 channels
      maxDepth: 2,                  // Go 2 levels deep
      batchSize: 10                 // Save every 10 channels
    }
  );
  
  try {
    // You can change this to any channel ID from your database
    // Example: Using a tech channel as seed
    const seedChannelId = 'UCsBjURrPoezykLs9EqgamOA'; // Fireship channel
    
    console.log(`Starting spider with seed channel: ${seedChannelId}`);
    console.log('This will take several minutes...');
    
    const discovered = await spider.spider(seedChannelId);
    
    console.log(`\nSpider completed! Found ${discovered.length} channels:`);
    
    // Display summary
    discovered.slice(0, 10).forEach((channel, idx) => {
      console.log(`${idx + 1}. ${channel.channelTitle} (@${channel.channelHandle})`);
      console.log(`   Subscribers: ${channel.subscriberCount?.toLocaleString() || 'Unknown'}`);
      console.log(`   Discovered via: ${channel.discoveryMethod} at depth ${channel.depth}`);
    });
    
    if (discovered.length > 10) {
      console.log(`... and ${discovered.length - 10} more channels`);
    }
    
  } catch (error) {
    console.error('Spider error:', error);
  }
}

// Run the test
testSpider();