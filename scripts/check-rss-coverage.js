import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config({ path: '.env.local' });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function checkRSSCoverage() {
  console.log('🔍 Checking RSS monitoring coverage...\n');

  // Get all competitor channels with YouTube IDs
  const { data: channels, error: channelsError } = await supabase
    .from('videos')
    .select('channel_id, metadata->youtube_channel_id')
    .eq('is_competitor', true)
    .not('metadata->youtube_channel_id', 'is', null);

  if (channelsError) {
    console.error('Error fetching channels:', channelsError);
    return;
  }

  // Get unique channels
  const uniqueChannels = new Map();
  channels.forEach(video => {
    const youtubeChannelId = video.metadata?.youtube_channel_id;
    if (youtubeChannelId && youtubeChannelId.startsWith('UC')) {
      uniqueChannels.set(youtubeChannelId, video.channel_id);
    }
  });

  console.log(`📺 Total unique competitor channels: ${uniqueChannels.size}`);

  // Check recent imports for each channel
  const now = new Date();
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

  let channelsWithRecentImports = 0;
  let channelsWithoutRecentImports = [];

  for (const [youtubeId, channelName] of uniqueChannels) {
    const { data: recentVideos, error } = await supabase
      .from('videos')
      .select('import_date')
      .eq('metadata->youtube_channel_id', youtubeId)
      .gte('import_date', thirtyDaysAgo.toISOString())
      .limit(1);

    if (!error && recentVideos && recentVideos.length > 0) {
      channelsWithRecentImports++;
    } else {
      channelsWithoutRecentImports.push({ youtubeId, channelName });
    }
  }

  console.log(`\n📊 RSS Monitoring Coverage Report:`);
  console.log(`✅ Channels with recent imports (last 30 days): ${channelsWithRecentImports}`);
  console.log(`❌ Channels without recent imports: ${channelsWithoutRecentImports.length}`);

  if (channelsWithoutRecentImports.length > 0) {
    console.log(`\n⚠️  Channels needing RSS updates:`);
    channelsWithoutRecentImports.slice(0, 10).forEach(({ channelName, youtubeId }) => {
      console.log(`   - ${channelName} (${youtubeId})`);
    });
    if (channelsWithoutRecentImports.length > 10) {
      console.log(`   ... and ${channelsWithoutRecentImports.length - 10} more`);
    }
  }

  console.log(`\n💡 Run the daily update all to import missing videos from these channels!`);
}

checkRSSCoverage().catch(console.error);