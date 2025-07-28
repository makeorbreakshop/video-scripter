/**
 * Test script to verify channel access and ownership
 * Run this to diagnose the YouTube Analytics API 401 errors
 */

const fs = require('fs');

// Function to test channel access
async function testChannelAccess() {
  // You'll need to manually get an access token from the browser
  console.log('🔍 YouTube Analytics API Channel Access Test');
  console.log('');
  console.log('1. Go to your YouTube dashboard: /dashboard/youtube');
  console.log('2. Open browser dev tools (F12)');
  console.log('3. Go to Application > Local Storage');
  console.log('4. Find "youtube_oauth_tokens" and copy the access_token value');
  console.log('5. Set ACCESS_TOKEN below and run this script');
  console.log('');
  
  // Set your access token here
  const ACCESS_TOKEN = 'YOUR_TOKEN_HERE';
  
  if (ACCESS_TOKEN === 'YOUR_TOKEN_HERE') {
    console.log('❌ Please set your access token in the script first');
    return;
  }

  try {
    // Test 1: Get channel info
    console.log('📺 Testing channel access...');
    const channelResponse = await fetch('https://www.googleapis.com/youtube/v3/channels?part=snippet,statistics&mine=true', {
      headers: {
        'Authorization': `Bearer ${ACCESS_TOKEN}`,
        'Content-Type': 'application/json'
      }
    });
    
    if (!channelResponse.ok) {
      console.log('❌ Failed to get channel info:', await channelResponse.text());
      return;
    }
    
    const channelData = await channelResponse.json();
    if (!channelData.items || channelData.items.length === 0) {
      console.log('❌ No channels found for this account');
      return;
    }
    
    const channel = channelData.items[0];
    console.log(`✅ Channel found: ${channel.snippet.title}`);
    console.log(`   Channel ID: ${channel.id}`);
    console.log(`   Subscribers: ${channel.statistics.subscriberCount}`);
    console.log(`   Videos: ${channel.statistics.videoCount}`);
    console.log('');

    // Test 2: Try YouTube Analytics API
    console.log('📊 Testing YouTube Analytics API access...');
    const analyticsResponse = await fetch(
      'https://youtubeanalytics.googleapis.com/v2/reports?' +
      'ids=channel==MINE&' +
      'startDate=2025-06-20&' +
      'endDate=2025-06-26&' +
      'metrics=views&' +
      'dimensions=day',
      {
        headers: {
          'Authorization': `Bearer ${ACCESS_TOKEN}`,
          'Content-Type': 'application/json'
        }
      }
    );
    
    if (!analyticsResponse.ok) {
      const errorData = await analyticsResponse.text();
      console.log('❌ YouTube Analytics API failed:', errorData);
      console.log('');
      console.log('🔧 This confirms the permission issue!');
      console.log('   Make sure you\'re logged in with the channel owner account.');
    } else {
      const analyticsData = await analyticsResponse.json();
      console.log('✅ YouTube Analytics API working!');
      console.log(`   Found ${analyticsData.rows?.length || 0} days of data`);
    }

  } catch (error) {
    console.error('❌ Test failed:', error);
  }
}

testChannelAccess();