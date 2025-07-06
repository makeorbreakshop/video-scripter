/**
 * Comprehensive Discovery Analysis
 * Analyzes discovered channels and ranks by frequency and relevance
 */

const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
);

async function analyzeDiscoveries() {
  console.log('🔍 Analyzing Channel Discovery Results\n');
  
  try {
    // Get all discoveries with frequency analysis
    const { data: discoveries, error } = await supabase
      .from('channel_discovery')
      .select(`
        discovered_channel_id,
        subscriber_count,
        video_count,
        validation_status,
        discovery_method,
        channel_metadata,
        discovery_date
      `)
      .order('discovery_date', { ascending: false });

    if (error) {
      console.error('Error fetching discoveries:', error);
      return;
    }

    if (!discoveries || discoveries.length === 0) {
      console.log('No discoveries found.');
      return;
    }

    // Group by channel and calculate frequency
    const channelFrequency = {};
    
    discoveries.forEach(discovery => {
      const channelId = discovery.discovered_channel_id;
      if (!channelFrequency[channelId]) {
        channelFrequency[channelId] = {
          channelId,
          channelTitle: discovery.channel_metadata?.title || 'Unknown Channel',
          subscriberCount: discovery.subscriber_count,
          videoCount: discovery.video_count,
          validationStatus: discovery.validation_status,
          discoveryCount: 0,
          methods: new Set(),
          firstDiscovery: discovery.discovery_date,
          lastDiscovery: discovery.discovery_date
        };
      }
      
      channelFrequency[channelId].discoveryCount++;
      channelFrequency[channelId].methods.add(discovery.discovery_method);
      
      // Update discovery dates
      if (discovery.discovery_date < channelFrequency[channelId].firstDiscovery) {
        channelFrequency[channelId].firstDiscovery = discovery.discovery_date;
      }
      if (discovery.discovery_date > channelFrequency[channelId].lastDiscovery) {
        channelFrequency[channelId].lastDiscovery = discovery.discovery_date;
      }
    });

    // Convert to array and sort by relevance score
    const rankedChannels = Object.values(channelFrequency)
      .map(channel => ({
        ...channel,
        methods: Array.from(channel.methods).sort(),
        relevanceScore: calculateRelevanceScore(channel)
      }))
      .sort((a, b) => {
        // Sort by discovery count first, then by subscriber count
        if (b.discoveryCount !== a.discoveryCount) {
          return b.discoveryCount - a.discoveryCount;
        }
        return (b.subscriberCount || 0) - (a.subscriberCount || 0);
      });

    // Check for existing channels to filter out
    const channelIds = rankedChannels.map(c => c.channelId);
    const { data: existingVideos } = await supabase
      .from('videos')
      .select('channel_id')
      .in('channel_id', channelIds);
    
    const existingChannelIds = new Set(existingVideos?.map(v => v.channel_id) || []);
    
    // Filter out existing channels
    const newChannels = rankedChannels.filter(channel => 
      !existingChannelIds.has(channel.channelId)
    );

    console.log('📊 Discovery Summary:');
    console.log('═'.repeat(60));
    console.log(`Total discovered: ${rankedChannels.length} channels`);
    console.log(`Already imported: ${rankedChannels.length - newChannels.length} channels`);
    console.log(`New channels: ${newChannels.length} channels`);
    console.log(`Pending review: ${newChannels.filter(c => c.validationStatus === 'pending').length}`);

    // Method breakdown
    const methodStats = {};
    discoveries.forEach(d => {
      methodStats[d.discovery_method] = (methodStats[d.discovery_method] || 0) + 1;
    });
    
    console.log('\n📈 Discovery by Method:');
    Object.entries(methodStats)
      .sort(([,a], [,b]) => b - a)
      .forEach(([method, count]) => {
        console.log(`  ${method}: ${count} discoveries`);
      });

    // Top channels by frequency
    console.log('\n🏆 Top New Channels (by discovery frequency):');
    console.log('═'.repeat(80));
    
    newChannels.slice(0, 25).forEach((channel, index) => {
      const rank = index + 1;
      const methods = channel.methods.join(', ');
      const subscribers = channel.subscriberCount ? 
        `${channel.subscriberCount.toLocaleString()} subs` : 'Unknown subs';
      
      console.log(`${rank.toString().padStart(2)}. ${channel.channelTitle}`);
      console.log(`    📊 Found ${channel.discoveryCount}x via: ${methods}`);
      console.log(`    👥 ${subscribers} | ${channel.videoCount || 'Unknown'} videos`);
      console.log(`    🔗 https://youtube.com/channel/${channel.channelId}`);
      console.log('');
    });

    // High-priority channels (multiple methods)
    const highPriorityChannels = newChannels.filter(c => c.discoveryCount > 1);
    
    if (highPriorityChannels.length > 0) {
      console.log('\n⭐ High-Priority Channels (multiple discovery methods):');
      console.log('═'.repeat(60));
      
      highPriorityChannels.forEach((channel, index) => {
        console.log(`${index + 1}. ${channel.channelTitle} (${channel.discoveryCount} methods)`);
        console.log(`   Methods: ${channel.methods.join(', ')}`);
        console.log(`   ${channel.subscriberCount?.toLocaleString() || 'Unknown'} subscribers`);
      });
    }

    // Subscriber distribution analysis
    const subscriberRanges = {
      'Unknown': 0,
      '< 10K': 0,
      '10K - 100K': 0,
      '100K - 1M': 0,
      '1M - 10M': 0,
      '10M+': 0
    };

    newChannels.forEach(channel => {
      const subs = channel.subscriberCount;
      if (!subs) subscriberRanges['Unknown']++;
      else if (subs < 10000) subscriberRanges['< 10K']++;
      else if (subs < 100000) subscriberRanges['10K - 100K']++;
      else if (subs < 1000000) subscriberRanges['100K - 1M']++;
      else if (subs < 10000000) subscriberRanges['1M - 10M']++;
      else subscriberRanges['10M+']++;
    });

    console.log('\n📊 Subscriber Distribution:');
    Object.entries(subscriberRanges).forEach(([range, count]) => {
      if (count > 0) {
        console.log(`  ${range}: ${count} channels`);
      }
    });

    console.log('\n💡 Next Steps:');
    console.log('1. Review high-priority channels (multiple discovery methods)');
    console.log('2. Focus on channels with 100K+ subscribers for quality content');
    console.log('3. Use the Discovery Dashboard to approve/reject channels');
    console.log('4. Run import process for approved channels');

  } catch (error) {
    console.error('Analysis error:', error);
  }
}

function calculateRelevanceScore(channel) {
  let score = 0;
  
  // Discovery frequency (most important)
  score += channel.discoveryCount * 10;
  
  // Subscriber count tiers
  const subs = channel.subscriberCount || 0;
  if (subs >= 1000000) score += 8;
  else if (subs >= 100000) score += 6;
  else if (subs >= 10000) score += 4;
  else if (subs >= 1000) score += 2;
  
  // Video count (active channels)
  const videos = channel.videoCount || 0;
  if (videos >= 100) score += 3;
  else if (videos >= 50) score += 2;
  else if (videos >= 10) score += 1;
  
  return score;
}

// Run the analysis
analyzeDiscoveries().catch(console.error);