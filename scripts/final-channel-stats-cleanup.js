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

async function finalCleanup() {
  try {
    console.log('🔍 Finding remaining channels without stats...');
    
    // Get channels with 0 subscribers from the materialized view
    const { data: channelsToUpdate, error } = await supabase
      .from('competitor_channel_summary')
      .select('channel_id, channel_name, video_count')
      .eq('subscriber_count', 0)
      .order('video_count', { ascending: false });
    
    if (error) {
      console.error('Error fetching channels:', error);
      return;
    }
    
    console.log(`📊 Found ${channelsToUpdate.length} channels still needing stats update`);
    
    // Process in batches
    const batchSize = 50;
    let totalUpdated = 0;
    let notFound = 0;
    
    for (let i = 0; i < channelsToUpdate.length; i += batchSize) {
      const batch = channelsToUpdate.slice(i, i + batchSize);
      const channelIds = batch.map(c => c.channel_id).join(',');
      
      console.log(`\n🔄 Processing batch ${Math.floor(i/batchSize) + 1}/${Math.ceil(channelsToUpdate.length/batchSize)}...`);
      
      try {
        const response = await fetchChannelData(channelIds);
        
        // Create a map of found channels
        const foundChannels = new Map();
        response.items.forEach(ch => foundChannels.set(ch.id, ch));
        
        // Process each channel in the batch
        for (const channel of batch) {
          const youtubeData = foundChannels.get(channel.channel_id);
          
          if (!youtubeData) {
            console.log(`❌ Channel not found on YouTube: ${channel.channel_name} (${channel.channel_id})`);
            notFound++;
            continue;
          }
          
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
          
          // Update all videos for this channel
          const { data: videos, error: videosError } = await supabase
            .from('videos')
            .select('id, metadata')
            .eq('channel_id', channel.channel_id)
            .eq('is_competitor', true);
          
          if (videosError) {
            console.error(`❌ Error fetching videos for ${channel.channel_id}:`, videosError);
            continue;
          }
          
          // Update each video
          for (const video of videos) {
            const updatedMetadata = {
              ...video.metadata,
              ...channelInfo,
              channel_stats: channelStats
            };
            
            const { error: updateError } = await supabase
              .from('videos')
              .update({ metadata: updatedMetadata })
              .eq('id', video.id);
            
            if (updateError) {
              console.error(`❌ Error updating video ${video.id}:`, updateError);
            }
          }
          
          console.log(`✅ Updated ${videos.length} videos for ${channelInfo.channel_name || channel.channel_id} (${channelStats.subscriber_count} subscribers)`);
          totalUpdated++;
        }
        
        if (i + batchSize < channelsToUpdate.length) {
          console.log('⏳ Waiting 1 second before next batch...');
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
        
      } catch (apiError) {
        console.error('❌ YouTube API error:', apiError.message);
      }
    }
    
    console.log(`\n✨ Final cleanup complete!`);
    console.log(`📊 Successfully updated: ${totalUpdated} channels`);
    console.log(`❌ Not found on YouTube: ${notFound} channels`);
    console.log('\n⚠️  Now refresh the materialized view: SELECT refresh_competitor_channel_summary();');
    
  } catch (error) {
    console.error('Fatal error:', error);
  }
}

// Run the cleanup
finalCleanup();