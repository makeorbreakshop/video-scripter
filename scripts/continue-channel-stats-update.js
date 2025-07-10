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

async function continueChannelStatsUpdate() {
  try {
    console.log('🔍 Finding remaining channels with missing stats...');
    
    // Find channels that still don't have stats in the videos table
    const { data: channelsToUpdate, error } = await supabase
      .from('videos')
      .select('channel_id, metadata->channel_name')
      .eq('is_competitor', true)
      .is('metadata->channel_stats', null)
      .limit(1000);
    
    if (error) {
      console.error('Error fetching videos:', error);
      return;
    }
    
    // Get unique channel IDs
    const uniqueChannels = [...new Set(channelsToUpdate.map(v => v.channel_id))];
    console.log(`📊 Found ${uniqueChannels.length} channels still needing stats update`);
    
    // Process in batches of 50 to respect API limits
    const batchSize = 50;
    let totalUpdated = 0;
    let apiUnitsUsed = 0;
    
    for (let i = 0; i < uniqueChannels.length; i += batchSize) {
      const batch = uniqueChannels.slice(i, i + batchSize);
      const channelIds = batch.join(',');
      
      console.log(`\n🔄 Processing batch ${Math.floor(i/batchSize) + 1}/${Math.ceil(uniqueChannels.length/batchSize)}...`);
      
      try {
        // Fetch channel data from YouTube API (costs 1 unit)
        const response = await fetchChannelData(channelIds);
        apiUnitsUsed += 1; // channels.list costs 1 unit
        
        for (const channel of response.items) {
          const channelStats = {
            subscriber_count: channel.statistics?.subscriberCount || '0',
            view_count: channel.statistics?.viewCount || '0', 
            video_count: channel.statistics?.videoCount || '0',
            channel_thumbnail: channel.snippet?.thumbnails?.high?.url || channel.snippet?.thumbnails?.default?.url || null,
          };
          
          const channelInfo = {
            channel_name: channel.snippet?.title || null,
            channel_title: channel.snippet?.title || null,
            channel_handle: channel.snippet?.customUrl || null,
          };
          
          // Get all videos for this channel that need updating
          const { data: videos, error: videosError } = await supabase
            .from('videos')
            .select('id, metadata')
            .eq('channel_id', channel.id)
            .eq('is_competitor', true)
            .is('metadata->channel_stats', null);
          
          if (videosError) {
            console.error(`❌ Error fetching videos for ${channel.id}:`, videosError);
            continue;
          }
          
          // Update each video with the new channel stats
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
          
          console.log(`✅ Updated ${videos.length} videos for ${channelInfo.channel_name || channel.id} (${channelStats.subscriber_count} subscribers)`);
          totalUpdated++;
        }
        
        // Small delay between batches to avoid rate limits
        if (i + batchSize < uniqueChannels.length) {
          console.log('⏳ Waiting 1 second before next batch...');
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
        
      } catch (apiError) {
        console.error('❌ YouTube API error:', apiError.message);
        if (apiError.message.includes('quotaExceeded')) {
          console.error('API quota exceeded. Try again tomorrow.');
          break;
        }
      }
    }
    
    console.log(`\n✨ Update complete! Updated ${totalUpdated} channels.`);
    console.log(`📊 API units used: ${apiUnitsUsed}`);
    console.log('\n⚠️  Note: The materialized view needs to be manually refreshed in the database.');
    console.log('Run this SQL: SELECT refresh_competitor_channel_summary();');
    
  } catch (error) {
    console.error('Fatal error:', error);
  }
}

// Run the update
continueChannelStatsUpdate();