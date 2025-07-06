/**
 * YouTube Channel ID Backfill Script
 * 
 * Backfills missing YouTube Channel IDs for 77 channels that don't have them in metadata.
 * Uses YouTube Videos API to lookup channel IDs from existing video IDs.
 * 
 * Usage: node scripts/backfill-youtube-channel-ids.js
 */

const { createClient } = require('@supabase/supabase-js');

// Initialize Supabase client
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
);

const YOUTUBE_API_KEY = process.env.YOUTUBE_API_KEY;

if (!YOUTUBE_API_KEY) {
  console.error('❌ YOUTUBE_API_KEY environment variable is required');
  process.exit(1);
}

/**
 * Get channels missing YouTube Channel IDs
 */
async function getChannelsMissingYouTubeIds() {
  console.log('🔍 Finding channels missing YouTube Channel IDs...');
  
  const { data, error } = await supabase.rpc('get_channels_missing_youtube_ids');
  
  if (error) {
    console.error('Error getting channels missing YouTube IDs:', error);
    // Fallback to direct query
    const { data: fallbackData, error: fallbackError } = await supabase
      .from('videos')
      .select(`
        channel_id,
        id,
        published_at
      `)
      .not('channel_id', 'like', 'UC%')
      .or('metadata->>youtube_channel_id.is.null,metadata->>youtube_channel_id.not.like.UC%')
      .not('channel_id', 'eq', 'Make or Break Shop') // Exclude user's own channel
      .order('published_at', { ascending: false });
      
    if (fallbackError) {
      throw new Error(`Failed to get missing channels: ${fallbackError.message}`);
    }
    
    // Group by channel_id and get one video ID per channel
    const channelMap = new Map();
    fallbackData.forEach(video => {
      if (!channelMap.has(video.channel_id)) {
        channelMap.set(video.channel_id, {
          channel_id: video.channel_id,
          sample_video_id: video.id,
          video_count: 1
        });
      } else {
        channelMap.get(video.channel_id).video_count++;
      }
    });
    
    return Array.from(channelMap.values());
  }
  
  return data || [];
}

/**
 * Lookup YouTube Channel IDs from video IDs using YouTube API
 */
async function lookupChannelIdsFromVideos(videoIds) {
  const url = new URL('https://www.googleapis.com/youtube/v3/videos');
  url.searchParams.append('part', 'snippet');
  url.searchParams.append('id', videoIds.join(','));
  url.searchParams.append('key', YOUTUBE_API_KEY);
  
  console.log(`🔍 Looking up ${videoIds.length} video IDs via YouTube API...`);
  
  const response = await fetch(url.toString());
  
  if (!response.ok) {
    const error = await response.json();
    throw new Error(`YouTube API error: ${error.error?.message || response.statusText}`);
  }
  
  const data = await response.json();
  return data.items || [];
}

/**
 * Update video metadata with YouTube Channel ID
 */
async function updateVideoMetadata(channelId, youtubeChannelId, channelTitle) {
  console.log(`📝 Updating metadata for channel: ${channelId} → ${youtubeChannelId}`);
  
  // Get all videos for this channel
  const { data: videos, error: fetchError } = await supabase
    .from('videos')
    .select('id, metadata')
    .eq('channel_id', channelId);
    
  if (fetchError) {
    throw new Error(`Failed to fetch videos for channel ${channelId}: ${fetchError.message}`);
  }
  
  // Update each video's metadata
  const updates = videos.map(video => {
    const updatedMetadata = {
      ...video.metadata,
      youtube_channel_id: youtubeChannelId,
      channel_title: channelTitle,
      backfilled: true,
      backfill_date: new Date().toISOString()
    };
    
    return {
      id: video.id,
      metadata: updatedMetadata
    };
  });
  
  // Batch update
  const { error: updateError } = await supabase
    .from('videos')
    .upsert(updates, { onConflict: 'id' });
    
  if (updateError) {
    throw new Error(`Failed to update videos for channel ${channelId}: ${updateError.message}`);
  }
  
  return videos.length;
}

/**
 * Main backfill function
 */
async function backfillYouTubeChannelIds() {
  try {
    console.log('🚀 Starting YouTube Channel ID backfill process...\n');
    
    // Get channels missing YouTube Channel IDs
    const missingChannels = await getChannelsMissingYouTubeIds();
    console.log(`📊 Found ${missingChannels.length} channels missing YouTube Channel IDs\n`);
    
    if (missingChannels.length === 0) {
      console.log('✅ All channels already have YouTube Channel IDs!');
      return;
    }
    
    let successful = 0;
    let failed = 0;
    let quotaUsed = 0;
    
    // Process in batches of 50 (YouTube API limit)
    const BATCH_SIZE = 50;
    
    for (let i = 0; i < missingChannels.length; i += BATCH_SIZE) {
      const batch = missingChannels.slice(i, i + BATCH_SIZE);
      const videoIds = batch.map(channel => channel.sample_video_id);
      
      try {
        console.log(`\n📦 Processing batch ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(missingChannels.length / BATCH_SIZE)} (${batch.length} channels)...`);
        
        // Lookup video info from YouTube API
        const videos = await lookupChannelIdsFromVideos(videoIds);
        quotaUsed += 1; // 1 quota unit per request
        
        // Create map of video ID to channel info
        const videoToChannelMap = new Map();
        videos.forEach(video => {
          videoToChannelMap.set(video.id, {
            youtubeChannelId: video.snippet.channelId,
            channelTitle: video.snippet.channelTitle
          });
        });
        
        // Update metadata for each channel in batch
        for (const channel of batch) {
          try {
            const videoInfo = videoToChannelMap.get(channel.sample_video_id);
            
            if (videoInfo) {
              const videosUpdated = await updateVideoMetadata(
                channel.channel_id,
                videoInfo.youtubeChannelId,
                videoInfo.channelTitle
              );
              
              console.log(`✅ ${channel.channel_id}: ${videosUpdated} videos updated with channel ID ${videoInfo.youtubeChannelId}`);
              successful++;
            } else {
              console.log(`⚠️  ${channel.channel_id}: Video not found in API response`);
              failed++;
            }
          } catch (error) {
            console.error(`❌ ${channel.channel_id}: ${error.message}`);
            failed++;
          }
        }
        
        // Rate limiting - wait 100ms between batches
        if (i + BATCH_SIZE < missingChannels.length) {
          await new Promise(resolve => setTimeout(resolve, 100));
        }
        
      } catch (error) {
        console.error(`❌ Batch ${Math.floor(i / BATCH_SIZE) + 1} failed: ${error.message}`);
        failed += batch.length;
      }
    }
    
    console.log('\n🎉 Backfill process completed!');
    console.log('============================================');
    console.log(`✅ Successful: ${successful} channels`);
    console.log(`❌ Failed: ${failed} channels`);
    console.log(`💰 Quota used: ${quotaUsed} units`);
    console.log(`📊 Success rate: ${Math.round((successful / (successful + failed)) * 100)}%`);
    
    // Verify RSS monitoring coverage after backfill
    console.log('\n🔍 Verifying RSS monitoring coverage...');
    const { data: coverage } = await supabase.rpc('get_youtube_channel_ids');
    console.log(`📺 RSS monitoring now covers ${coverage?.length || 0} channels`);
    
  } catch (error) {
    console.error('❌ Backfill process failed:', error);
    process.exit(1);
  }
}

// Create the RPC function if it doesn't exist
async function createHelperFunction() {
  const { error } = await supabase.rpc('create_missing_channels_function');
  if (error && !error.message.includes('already exists')) {
    console.warn('Could not create helper function:', error.message);
  }
}

// Run the backfill
if (require.main === module) {
  createHelperFunction().then(() => {
    backfillYouTubeChannelIds();
  });
}

module.exports = {
  backfillYouTubeChannelIds,
  getChannelsMissingYouTubeIds,
  lookupChannelIdsFromVideos,
  updateVideoMetadata
};