#!/usr/bin/env node

/**
 * Backfill script for discovery channels that only got partial imports
 * This will import ALL videos for the discovery channels using the fixed API
 */

require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
);

const DISCOVERY_CHANNELS = [
  'UCbTMPp5eIyEt2pFJcMLrUDA', // TotalBoat - 3/381 videos
  'UCTIoWt_29GK8pbnfOREWXlA', // Functional Print Friday - 14/212 videos
  'UCU1QY7hQztMkgJh-XLsa5rQ', // Mechanical Triage - 20/566 videos
  'UCMyOj6fhvKFMjxUCp3b_3gA', // Nick DiGiovanni - 4/424 videos
  'UC2RD8S7cc0US-2W7FOnyz5w', // Ronnie & Barty - 2/180 videos
  'UCu-HZmBHciu-LcBkRERIq_A', // JT Makes It - 3/104 videos
  'UC7Jh_-fyN4VnMxXfErdtLng', // Jon Adams - 14/130 videos
  'UCQObd2W7coJIAYe-sZmO6ew', // The Art of Craftsmanship - 1/177 videos
  'UChbcn2mOzPHEEHxPmU66Sdg'  // Black's Tropical Homestead - 50/1657 videos
];

async function backfillDiscoveryChannels() {
  console.log('🚀 Starting discovery channels backfill...');
  console.log(`📋 Processing ${DISCOVERY_CHANNELS.length} channels for full import`);
  
  try {
    const response = await fetch('http://localhost:3000/api/youtube/discovery/import-approved', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        channelIds: DISCOVERY_CHANNELS,
        userId: 'discovery-system',
        maxVideos: 'all',  // Import ALL videos
        timePeriod: 'all', // From ALL time
        excludeShorts: true
      })
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`API request failed: ${response.status} - ${error}`);
    }

    const results = await response.json();
    
    console.log('\n✅ BACKFILL COMPLETE!');
    console.log(`📊 Results:`);
    console.log(`   - Channels processed: ${results.channelsProcessed}`);
    console.log(`   - Total videos imported: ${results.totalVideosImported}`);
    console.log(`   - Vectorization triggered: ${results.vectorizationTriggered ? '✅ Yes' : '❌ No'}`);
    console.log(`   - RSS channels added: ${results.rssChannelsAdded.length}`);
    
    if (results.errors && results.errors.length > 0) {
      console.log(`\n⚠️  Warnings/Errors:`);
      results.errors.forEach(error => console.log(`   - ${error}`));
    }
    
    if (results.channelsImported && results.channelsImported.length > 0) {
      console.log(`\n📈 Channel Import Details:`);
      results.channelsImported.forEach(channel => {
        console.log(`   - ${channel.channelTitle}: ${channel.videosImported} videos (${channel.subscriberCount.toLocaleString()} subs)`);
      });
    }
    
    console.log('\n🎯 Discovery channels backfill completed successfully!');
    
  } catch (error) {
    console.error('❌ Backfill failed:', error);
    process.exit(1);
  }
}

// Run the backfill
backfillDiscoveryChannels();