import fetch from 'node-fetch';

async function testCompetitorChannelsAPI() {
  try {
    console.log('🔍 Testing competitor channels API endpoint...');
    
    const response = await fetch('http://localhost:3000/api/youtube/competitor-channels');
    
    if (!response.ok) {
      console.error('❌ API returned error:', response.status, response.statusText);
      return;
    }
    
    const data = await response.json();
    console.log(`\n✅ Found ${data.channels.length} competitor channels\n`);
    
    // Show channels with subscriber counts
    const channelsWithSubs = data.channels.filter(ch => ch.subscriberCount > 0);
    const channelsWithoutSubs = data.channels.filter(ch => ch.subscriberCount === 0);
    
    console.log(`📊 Channels with subscribers: ${channelsWithSubs.length}`);
    console.log(`❌ Channels without subscribers: ${channelsWithoutSubs.length}\n`);
    
    // Show sample of channels with subscribers
    console.log('Sample channels WITH subscriber data:');
    channelsWithSubs.slice(0, 5).forEach(ch => {
      console.log(`  - ${ch.name}: ${ch.subscriberCount.toLocaleString()} subscribers ${ch.thumbnailUrl ? '✅' : '❌'} thumbnail`);
    });
    
    // Show channels without subscribers
    if (channelsWithoutSubs.length > 0) {
      console.log('\nChannels WITHOUT subscriber data:');
      channelsWithoutSubs.slice(0, 10).forEach(ch => {
        console.log(`  - ${ch.name} (${ch.videoCount} videos)`);
      });
    }
    
  } catch (error) {
    console.error('Error testing API:', error);
  }
}

testCompetitorChannelsAPI();