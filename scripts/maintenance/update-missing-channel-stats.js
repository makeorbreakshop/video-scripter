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

async function updateMissingChannelStats() {
  try {
    console.log('🔍 Finding channels with missing stats...');
    
    // Find all unique channel IDs that have 0 subscribers in the materialized view
    const { data: channelsToUpdate, error } = await supabase
      .from('competitor_channel_summary')
      .select('youtube_channel_id, channel_name')
      .eq('subscriber_count', 0)
      .not('youtube_channel_id', 'eq', ''); // Skip empty channel IDs
    
    if (error) {
      console.error('Error fetching channels:', error);
      return;
    }
    
    console.log(`📊 Found ${channelsToUpdate.length} channels needing stats update`);
    
    // Process in batches of 50 to respect API limits
    const batchSize = 50;
    let totalUpdated = 0;
    let apiUnitsUsed = 0;
    
    for (let i = 0; i < channelsToUpdate.length; i += batchSize) {
      const batch = channelsToUpdate.slice(i, i + batchSize);
      const channelIds = batch.map(c => c.youtube_channel_id).join(',');
      
      console.log(`\n🔄 Processing batch ${Math.floor(i/batchSize) + 1}/${Math.ceil(channelsToUpdate.length/batchSize)}...`);
      
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
          
          // Get all videos for this channel
          const { data: videos, error: videosError } = await supabase
            .from('videos')
            .select('id, metadata')
            .eq('channel_id', channel.id)
            .eq('is_competitor', true);
          
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
        if (i + batchSize < channelsToUpdate.length) {
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
    
    // Now refresh the materialized view
    console.log('\n🔄 Refreshing competitor channel summary...');
    const { error: refreshError } = await supabase.rpc('refresh_competitor_channel_summary');
    
    if (refreshError) {
      console.error('❌ Error refreshing summary:', refreshError);
    } else {
      console.log('✅ Competitor channel summary refreshed successfully!');
    }
    
  } catch (error) {
    console.error('Fatal error:', error);
  }
}

// Run the update
updateMissingChannelStats();