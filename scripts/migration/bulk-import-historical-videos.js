/**
 * Bulk Import Historical Videos Script
 * 
 * Identifies channels with limited historical data and imports their full backlog
 * to fix rolling baseline calculations and performance ratios.
 * 
 * Usage: node scripts/bulk-import-historical-videos.js [--dry-run] [--channel=CHANNEL_NAME]
 */

const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

// Initialize Supabase client
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  {
    auth: {
      autoRefreshToken: false,
      persistSession: false
    }
  }
);

// Parse command line arguments
const args = process.argv.slice(2);
const isDryRun = args.includes('--dry-run');
const channelFilter = args.find(arg => arg.startsWith('--channel='))?.split('=')[1];

console.log('🔍 Starting bulk historical video import analysis...');
console.log(`Mode: ${isDryRun ? 'DRY RUN (analysis only)' : 'LIVE IMPORT'}`);
if (channelFilter) {
  console.log(`Filter: Only processing channel "${channelFilter}"`);
}

async function identifyChannelsNeedingBackfill() {
  console.log('\n📊 Identifying channels needing historical backfill...');
  
  const { data: channels, error } = await supabase
    .from('videos')
    .select(`
      channel_name,
      channel_id,
      view_count,
      published_at,
      is_competitor,
      import_date
    `)
    .eq('is_competitor', true)
    .not('channel_name', 'is', null);

  if (error) {
    console.error('❌ Error identifying channels:', error);
    return [];
  }

  // Process the raw data to identify channels needing backfill
  const channelStats = {};
  
  channels.forEach(video => {
    const key = `${video.channel_name}:${video.channel_id}`;
    if (!channelStats[key]) {
      channelStats[key] = {
        channel_name: video.channel_name,
        channel_id: video.channel_id,
        total_videos: 0,
        earliest_year: null,
        latest_year: null,
        is_competitor: video.is_competitor,
        last_import_date: video.import_date
      };
    }
    
    const stats = channelStats[key];
    stats.total_videos++;
    
    const year = new Date(video.published_at).getFullYear();
    if (!stats.earliest_year || year < stats.earliest_year) {
      stats.earliest_year = year;
    }
    if (!stats.latest_year || year > stats.latest_year) {
      stats.latest_year = year;
    }
    
    if (!stats.last_import_date || video.import_date > stats.last_import_date) {
      stats.last_import_date = video.import_date;
    }
  });

  // Debug: Show channel data for filtered channel
  if (channelFilter) {
    const filteredChannels = Object.values(channelStats).filter(channel => 
      channel.channel_name.toLowerCase().includes(channelFilter.toLowerCase())
    );
    console.log('\n🔍 Debug: Found matching channels:');
    filteredChannels.forEach(channel => {
      const yearSpan = channel.latest_year - channel.earliest_year;
      console.log(`   ${channel.channel_name}: ${channel.total_videos} videos, ${channel.earliest_year}-${channel.latest_year} (span: ${yearSpan})`);
    });
  }

  // Debug: Show some sample channels
  console.log('\n🔍 Debug: Sample channels data:');
  Object.values(channelStats).slice(0, 5).forEach(channel => {
    const yearSpan = channel.latest_year - channel.earliest_year;
    console.log(`   ${channel.channel_name}: ${channel.total_videos} videos, ${channel.earliest_year}-${channel.latest_year} (span: ${yearSpan})`);
  });

  // Filter channels that need backfill (more aggressive criteria)
  const channelsNeedingBackfill = Object.values(channelStats).filter(channel => {
    const yearSpan = channel.latest_year - channel.earliest_year;
    const matchesFilter = !channelFilter || channel.channel_name.toLowerCase().includes(channelFilter.toLowerCase());
    
    // More aggressive filtering - catch channels with limited historical data
    const needsBackfill = matchesFilter && 
           channel.total_videos > 10 && 
           (
             // Channels with only recent years (2024-2025)
             (yearSpan <= 1 && channel.earliest_year >= 2024) ||
             // Channels with only 2025 videos 
             (yearSpan === 0 && channel.earliest_year === 2025) ||
             // Large channels (50+ videos) that span less than 3 years
             (channel.total_videos >= 50 && yearSpan <= 2)
           );
    
    if (channelFilter && channel.channel_name.toLowerCase().includes(channelFilter.toLowerCase())) {
      console.log(`   Debug: ${channel.channel_name} - yearSpan: ${yearSpan}, earliest: ${channel.earliest_year}, videos: ${channel.total_videos}, needsBackfill: ${needsBackfill}`);
    }
    
    return needsBackfill;
  });

  console.log(`\n📋 Found ${channelsNeedingBackfill.length} channels needing historical backfill:`);
  
  channelsNeedingBackfill.forEach((channel, index) => {
    console.log(`${index + 1}. ${channel.channel_name} (${channel.total_videos} videos, ${channel.earliest_year}-${channel.latest_year})`);
  });

  return channelsNeedingBackfill;
}

async function importChannelHistory(channelId, channelName, userId) {
  console.log(`\n🔄 Importing historical videos for ${channelName}...`);
  
  if (isDryRun) {
    console.log(`   [DRY RUN] Would import all historical videos for channel ${channelId}`);
    return { success: true, imported: 0, message: 'Dry run simulation' };
  }

  try {
    // Call the competitor import API with all-time settings
    const response = await fetch(`${process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'}/api/youtube/import-competitor`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        channelId,
        channelName,
        timePeriod: 'all',     // Import all historical videos
        maxVideos: 'all',      // No video limit
        excludeShorts: true,   // Keep shorts filtering
        userId
      })
    });

    const result = await response.json();
    
    if (result.success) {
      console.log(`   ✅ Successfully imported ${result.imported_videos} videos for ${channelName}`);
      return { success: true, imported: result.imported_videos, message: result.message };
    } else {
      console.log(`   ❌ Failed to import ${channelName}: ${result.error}`);
      return { success: false, error: result.error };
    }
  } catch (error) {
    console.log(`   ❌ Error importing ${channelName}: ${error.message}`);
    return { success: false, error: error.message };
  }
}

async function updateRollingBaselines() {
  console.log('\n🔄 Updating rolling baselines for newly imported videos...');
  
  if (isDryRun) {
    console.log('   [DRY RUN] Would update rolling baselines after import');
    return;
  }

  try {
    const { error } = await supabase.rpc('calculate_rolling_baselines');
    
    if (error) {
      console.error('❌ Error updating rolling baselines:', error);
    } else {
      console.log('   ✅ Rolling baselines updated successfully');
    }
  } catch (error) {
    console.error('❌ Error calling rolling baseline function:', error);
  }
}

async function main() {
  try {
    // Step 1: Identify channels needing backfill
    const channelsToProcess = await identifyChannelsNeedingBackfill();
    
    if (channelsToProcess.length === 0) {
      console.log('\n✅ No channels found needing historical backfill');
      return;
    }

    console.log(`\n🚀 Processing ${channelsToProcess.length} channels...`);
    
    // Use the known user ID from the auth system
    const userId = '4d154389-9f5f-4a97-83ab-528e3adf6c0e';
    if (!userId) {
      console.error('❌ No user found for imports');
      return;
    }

    // Step 2: Process each channel
    const results = {
      success: 0,
      failed: 0,
      totalImported: 0
    };

    for (let i = 0; i < channelsToProcess.length; i++) {
      const channel = channelsToProcess[i];
      console.log(`\n[${i + 1}/${channelsToProcess.length}] Processing ${channel.channel_name}...`);
      
      const result = await importChannelHistory(channel.channel_id, channel.channel_name, userId);
      
      if (result.success) {
        results.success++;
        results.totalImported += result.imported || 0;
      } else {
        results.failed++;
      }

      // Add delay between imports to avoid rate limiting
      if (i < channelsToProcess.length - 1) {
        console.log('   ⏳ Waiting 5 seconds before next import...');
        await new Promise(resolve => setTimeout(resolve, 5000));
      }
    }

    // Step 3: Update rolling baselines
    if (results.success > 0) {
      await updateRollingBaselines();
    }

    // Step 4: Show summary
    console.log('\n📊 IMPORT SUMMARY:');
    console.log(`   ✅ Successful imports: ${results.success}`);
    console.log(`   ❌ Failed imports: ${results.failed}`);
    console.log(`   📹 Total videos imported: ${results.totalImported}`);
    console.log('\n🎉 Bulk import process complete!');

  } catch (error) {
    console.error('❌ Script error:', error);
    process.exit(1);
  }
}

// Handle graceful shutdown
process.on('SIGINT', () => {
  console.log('\n⏹️  Script interrupted by user');
  process.exit(0);
});

// Run the script
main().catch(console.error);