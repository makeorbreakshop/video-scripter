import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config();

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const YOUTUBE_API_KEY = process.env.YOUTUBE_API_KEY;

async function fetchChannelData(channelIds) {
  const response = await fetch(
    `https://www.googleapis.com/youtube/v3/channels?` +
    `part=snippet,statistics` +
    `&id=${channelIds}` +
    `&key=${YOUTUBE_API_KEY}`
  );
  
  if (!response.ok) {
    throw new Error(`YouTube API error: ${response.statusText}`);
  }
  
  return response.json();
}

async function updateChannelVideos(channelId, channelInfo, channelStats) {
  // Instead of updating all videos at once, use a single bulk update
  const { error } = await supabase.rpc('update_channel_metadata', {
    p_channel_id: channelId,
    p_channel_info: channelInfo,
    p_channel_stats: channelStats
  });
  
  if (error) {
    // Fallback to manual update if function doesn't exist
    const { data: videos, error: fetchError } = await supabase
      .from('videos')
      .select('id')
      .eq('channel_id', channelId)
      .eq('is_competitor', true)
      .limit(100); // Process only first 100 videos to avoid timeout
    
    if (!fetchError && videos) {
      for (const video of videos) {
        await supabase
          .from('videos')
          .update({ 
            metadata: supabase.rpc('jsonb_merge', {
              target: { metadata: {} },
              source: { ...channelInfo, channel_stats: channelStats }
            })
          })
          .eq('id', video.id);
      }
    }
  }
}

async function fixRemainingChannels() {
  try {
    console.log('🔍 Finding remaining channels without stats...');
    
    // Get ALL channel IDs that need updates (not from materialized view)
    const { data: channelsToUpdate, error } = await supabase
      .from('videos')
      .select('channel_id')
      .eq('is_competitor', true)
      .is('metadata->channel_stats', null)
      .limit(1000);
    
    if (error) {
      console.error('Error fetching videos:', error);
      return;
    }
    
    // Get unique channel IDs
    const uniqueChannels = [...new Set(channelsToUpdate.map(v => v.channel_id))];
    console.log(`📊 Found ${uniqueChannels.length} channels needing stats update`);
    
    // Process ALL channels in one batch (YouTube API supports up to 50)
    const batchSize = 50;
    let totalUpdated = 0;
    let notFound = 0;
    
    for (let i = 0; i < uniqueChannels.length; i += batchSize) {
      const batch = uniqueChannels.slice(i, i + batchSize);
      const channelIds = batch.join(',');
      
      console.log(`\n🔄 Processing batch ${Math.floor(i/batchSize) + 1}/${Math.ceil(uniqueChannels.length/batchSize)}...`);
      
      try {
        const response = await fetchChannelData(channelIds);
        
        // Process all channels in parallel
        const updatePromises = response.items.map(async (youtubeData) => {
          const channelStats = {
            subscriber_count: youtubeData.statistics?.subscriberCount || '0',
            view_count: youtubeData.statistics?.viewCount || '0', 
            video_count: youtubeData.statistics?.videoCount || '0',
            channel_thumbnail: youtubeData.snippet?.thumbnails?.high?.url || youtubeData.snippet?.thumbnails?.default?.url || null,
          };
          
          const channelInfo = {
            channel_name: youtubeData.snippet?.title || null,
            channel_title: youtubeData.snippet?.title || null,
            channel_handle: youtubeData.snippet?.customUrl || null,
            youtube_channel_id: youtubeData.id
          };
          
          // Update videos for this channel
          await updateChannelVideos(youtubeData.id, channelInfo, channelStats);
          
          console.log(`✅ ${channelInfo.channel_name} (${channelStats.subscriber_count} subscribers)`);
          return true;
        });
        
        await Promise.all(updatePromises);
        totalUpdated += response.items.length;
        
        // Check for missing channels
        const foundIds = new Set(response.items.map(item => item.id));
        batch.forEach(id => {
          if (!foundIds.has(id)) {
            console.log(`❌ Channel not found: ${id}`);
            notFound++;
          }
        });
        
      } catch (apiError) {
        console.error('❌ YouTube API error:', apiError.message);
      }
    }
    
    console.log(`\n✨ Update complete!`);
    console.log(`📊 Successfully updated: ${totalUpdated} channels`);
    console.log(`❌ Not found on YouTube: ${notFound} channels`);
    
    // Now refresh the materialized view
    console.log('\n🔄 Refreshing materialized view...');
    const { error: refreshError } = await supabase.rpc('refresh_competitor_channel_summary');
    
    if (refreshError) {
      console.log('❌ Error refreshing view:', refreshError.message);
      console.log('Run manually: SELECT refresh_competitor_channel_summary();');
    } else {
      console.log('✅ Materialized view refreshed successfully!');
    }
    
  } catch (error) {
    console.error('Fatal error:', error);
  }
}

// Run the fix
fixRemainingChannels();