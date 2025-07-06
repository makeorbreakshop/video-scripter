/**
 * Comprehensive Channel Discovery Script
 * Runs all 6 discovery methods, filters existing channels, ranks by frequency
 */

const DISCOVERY_METHODS = [
  'subscriptions',
  'featured', 
  'shelves',
  'playlists',
  'comments',
  'collaborations'
];

async function runComprehensiveDiscovery() {
  console.log('🚀 Starting comprehensive channel discovery...\n');
  
  const allDiscoveries = [];
  const methodResults = {};
  
  // Run each discovery method
  for (const method of DISCOVERY_METHODS) {
    console.log(`📊 Running ${method} discovery...`);
    
    try {
      const response = await fetch(`http://localhost:3000/api/youtube/discovery/${method}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          sourceChannelIds: ['all'],
          excludeExisting: true,
          dryRun: false
        }),
      });

      if (!response.ok) {
        const error = await response.json();
        console.error(`❌ ${method} failed:`, error.error);
        methodResults[method] = { error: error.error };
        continue;
      }

      const result = await response.json();
      console.log(`✅ ${method}: Found ${result.channelsDiscovered} new channels`);
      
      methodResults[method] = result;
      
      // Add to all discoveries with method tracking
      if (result.discoveries) {
        result.discoveries.forEach(discovery => {
          allDiscoveries.push({
            ...discovery,
            discoveryMethod: method
          });
        });
      }
      
    } catch (error) {
      console.error(`❌ ${method} error:`, error.message);
      methodResults[method] = { error: error.message };
    }
  }
  
  console.log('\n📈 Discovery Summary by Method:');
  let totalNewChannels = 0;
  
  DISCOVERY_METHODS.forEach(method => {
    const result = methodResults[method];
    if (result?.error) {
      console.log(`  ${method}: ❌ ${result.error}`);
    } else {
      const count = result?.channelsDiscovered || 0;
      totalNewChannels += count;
      console.log(`  ${method}: ${count} channels`);
    }
  });
  
  console.log(`\n🎯 Total New Channels Discovered: ${totalNewChannels}`);
  
  // Get current database state to analyze rankings
  console.log('\n🔍 Analyzing discovery frequency rankings...');
  
  try {
    // Get all discovery data from database
    const statsResponse = await fetch('http://localhost:3000/api/youtube/discovery/stats');
    if (!statsResponse.ok) {
      console.error('Failed to fetch discovery stats for ranking analysis');
      return;
    }
    
    const stats = await statsResponse.json();
    
    // Count discovery frequency per channel
    const channelFrequency = {};
    
    if (stats.allDiscoveries) {
      stats.allDiscoveries.forEach(discovery => {
        const channelId = discovery.discovered_channel_id;
        if (!channelFrequency[channelId]) {
          channelFrequency[channelId] = {
            channelId,
            channelTitle: discovery.channel_title,
            subscriberCount: discovery.subscriber_count,
            discoveryCount: 0,
            methods: new Set(),
            validationStatus: discovery.validation_status
          };
        }
        channelFrequency[channelId].discoveryCount++;
        channelFrequency[channelId].methods.add(discovery.discovery_method);
      });
    }
    
    // Convert to array and sort by frequency
    const rankedChannels = Object.values(channelFrequency)
      .map(channel => ({
        ...channel,
        methods: Array.from(channel.methods).sort()
      }))
      .sort((a, b) => b.discoveryCount - a.discoveryCount);
    
    console.log('\n🏆 Top Discovered Channels (by frequency):');
    console.log('═'.repeat(80));
    
    rankedChannels.slice(0, 20).forEach((channel, index) => {
      const rank = index + 1;
      const methods = channel.methods.join(', ');
      const subscribers = channel.subscriberCount ? 
        `${channel.subscriberCount.toLocaleString()} subs` : 'Unknown subs';
      
      console.log(`${rank.toString().padStart(2)}. ${channel.channelTitle}`);
      console.log(`    📊 Found ${channel.discoveryCount}x via: ${methods}`);
      console.log(`    👥 ${subscribers} | Status: ${channel.validationStatus}`);
      console.log('');
    });
    
    // Summary statistics
    const pendingCount = rankedChannels.filter(c => c.validationStatus === 'pending').length;
    const multiMethodCount = rankedChannels.filter(c => c.discoveryCount > 1).length;
    const highFrequencyCount = rankedChannels.filter(c => c.discoveryCount >= 3).length;
    
    console.log('\n📊 Discovery Analysis:');
    console.log(`  Total unique channels: ${rankedChannels.length}`);
    console.log(`  Pending review: ${pendingCount}`);
    console.log(`  Found by multiple methods: ${multiMethodCount}`);
    console.log(`  High frequency (3+ methods): ${highFrequencyCount}`);
    
    if (highFrequencyCount > 0) {
      console.log('\n⭐ High-Priority Channels (3+ discovery methods):');
      rankedChannels
        .filter(c => c.discoveryCount >= 3)
        .slice(0, 10)
        .forEach((channel, index) => {
          console.log(`  ${index + 1}. ${channel.channelTitle} (${channel.discoveryCount}x)`);
        });
    }
    
  } catch (error) {
    console.error('Error analyzing discovery rankings:', error.message);
  }
  
  console.log('\n✅ Comprehensive discovery complete!');
  console.log('💡 Check the Discovery Dashboard for detailed review interface');
}

// Run the discovery
runComprehensiveDiscovery().catch(console.error);