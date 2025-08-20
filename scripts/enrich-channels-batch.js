import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';
dotenv.config();

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const YOUTUBE_API_KEY = process.env.YOUTUBE_API_KEY;
const BATCH_SIZE = 50; // YouTube's max per request
const DELAY_BETWEEN_BATCHES = 1000; // 1 second delay between API calls

async function fetchChannelDetails(channelIds) {
  const parts = [
    'snippet',
    'contentDetails',
    'statistics',
    'topicDetails',
    'status',
    'brandingSettings'
  ].join(',');
  
  const url = `https://www.googleapis.com/youtube/v3/channels?` +
    `part=${parts}&` +
    `id=${channelIds.join(',')}&` +
    `key=${YOUTUBE_API_KEY}`;
  
  try {
    const response = await fetch(url);
    const data = await response.json();
    
    if (data.error) {
      console.error('YouTube API Error:', data.error);
      return null;
    }
    
    return data.items || [];
  } catch (error) {
    console.error('Error fetching channel details:', error);
    return null;
  }
}

function extractChannelData(channel) {
  const snippet = channel.snippet || {};
  const statistics = channel.statistics || {};
  const status = channel.status || {};
  const brandingSettings = channel.brandingSettings || {};
  const contentDetails = channel.contentDetails || {};
  const topicDetails = channel.topicDetails || {};
  
  // Core fields for direct columns
  const coreData = {
    channel_name: snippet.title,
    description: snippet.description,
    custom_url: snippet.customUrl,
    default_language: snippet.defaultLanguage || null,
    country: snippet.country,
    published_at: snippet.publishedAt,
    thumbnail_url: snippet.thumbnails?.high?.url || snippet.thumbnails?.medium?.url || snippet.thumbnails?.default?.url,
    
    // Statistics
    subscriber_count: parseInt(statistics.subscriberCount) || null,
    view_count: parseInt(statistics.viewCount) || null,
    video_count: parseInt(statistics.videoCount) || null,
    hidden_subscriber_count: statistics.hiddenSubscriberCount || false,
    
    // Status
    privacy_status: status.privacyStatus || 'public',
    made_for_kids: status.madeForKids || false,
    
    // Content details
    uploads_playlist_id: contentDetails.relatedPlaylists?.uploads || null,
    
    // Branding
    keywords: brandingSettings.channel?.keywords || null,
    
    // Mark as synced
    last_youtube_sync: new Date().toISOString()
  };
  
  // Additional metadata for JSONB column
  const metadata = {
    youtube_data: {
      topic_ids: topicDetails.topicIds || [],
      topic_categories: topicDetails.topicCategories || [],
      unsubscribed_trailer: brandingSettings.channel?.unsubscribedTrailer || null,
      banner_url: brandingSettings.image?.bannerExternalUrl || null,
      tracking_analytics_id: brandingSettings.channel?.trackingAnalyticsAccountId || null,
      is_linked: status.isLinked || null,
      long_uploads_status: status.longUploadsStatus || null,
      localizations: Object.keys(channel.localizations || {}),
      thumbnails: snippet.thumbnails || {},
      last_enriched: new Date().toISOString()
    }
  };
  
  return { coreData, metadata };
}

async function updateChannelsInDatabase(channels) {
  const updates = [];
  
  for (const channel of channels) {
    const { coreData, metadata } = extractChannelData(channel);
    
    updates.push({
      channel_id: channel.id,
      ...coreData,
      metadata: metadata
    });
  }
  
  // Batch update using upsert
  const { data, error } = await supabase
    .from('channels')
    .upsert(updates, { 
      onConflict: 'channel_id',
      ignoreDuplicates: false 
    });
  
  if (error) {
    console.error('Error updating channels:', error);
    return false;
  }
  
  return true;
}

async function getChannelsToEnrich(limit = null) {
  const allChannels = [];
  const pageSize = 1000; // Supabase's default limit
  let offset = 0;
  let hasMore = true;
  
  while (hasMore) {
    let query = supabase
      .from('channels')
      .select('channel_id')
      .or('last_youtube_sync.is.null,last_youtube_sync.lt.' + new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString())
      .order('subscriber_count', { ascending: false, nullsFirst: false })
      .range(offset, offset + pageSize - 1);
    
    const { data, error } = await query;
    
    if (error) {
      console.error('Error fetching channels:', error);
      return allChannels;
    }
    
    if (data && data.length > 0) {
      allChannels.push(...data);
      offset += pageSize;
      
      // If we got less than pageSize results, we've reached the end
      if (data.length < pageSize) {
        hasMore = false;
      }
      
      // If we have a limit and we've reached it, stop
      if (limit && allChannels.length >= limit) {
        hasMore = false;
        // Trim to exact limit if we went over
        if (allChannels.length > limit) {
          return allChannels.slice(0, limit);
        }
      }
    } else {
      hasMore = false;
    }
  }
  
  return allChannels;
}

async function enrichChannelsBatch(dryRun = false) {
  console.log('Starting channel enrichment process...');
  console.log('Dry run:', dryRun);
  
  const channels = await getChannelsToEnrich();
  console.log(`Found ${channels.length} channels to enrich`);
  
  if (channels.length === 0) {
    console.log('No channels need enrichment');
    return;
  }
  
  let processed = 0;
  let successful = 0;
  let failed = 0;
  
  // Process in batches of 50 (YouTube API limit)
  for (let i = 0; i < channels.length; i += BATCH_SIZE) {
    const batch = channels.slice(i, i + BATCH_SIZE);
    const channelIds = batch.map(c => c.channel_id);
    
    console.log(`\nProcessing batch ${Math.floor(i / BATCH_SIZE) + 1} of ${Math.ceil(channels.length / BATCH_SIZE)}`);
    console.log(`Channels: ${channelIds.length}`);
    
    // Fetch from YouTube API
    const youtubeData = await fetchChannelDetails(channelIds);
    
    if (!youtubeData) {
      console.error('Failed to fetch YouTube data for batch');
      failed += channelIds.length;
      continue;
    }
    
    console.log(`Received data for ${youtubeData.length} channels`);
    
    // Update database
    if (!dryRun) {
      const success = await updateChannelsInDatabase(youtubeData);
      if (success) {
        successful += youtubeData.length;
      } else {
        failed += youtubeData.length;
      }
    } else {
      // In dry run, just show what would be updated
      console.log('DRY RUN - Would update:');
      youtubeData.forEach(channel => {
        const { coreData } = extractChannelData(channel);
        console.log(`  - ${coreData.channel_name} (@${coreData.custom_url})`);
      });
      successful += youtubeData.length;
    }
    
    processed += channelIds.length;
    
    // Progress update
    console.log(`Progress: ${processed}/${channels.length} channels processed`);
    console.log(`Successful: ${successful}, Failed: ${failed}`);
    
    // Rate limiting - wait between batches
    if (i + BATCH_SIZE < channels.length) {
      console.log(`Waiting ${DELAY_BETWEEN_BATCHES}ms before next batch...`);
      await new Promise(resolve => setTimeout(resolve, DELAY_BETWEEN_BATCHES));
    }
  }
  
  console.log('\n=== ENRICHMENT COMPLETE ===');
  console.log(`Total channels processed: ${processed}`);
  console.log(`Successfully enriched: ${successful}`);
  console.log(`Failed: ${failed}`);
  console.log(`API calls made: ${Math.ceil(channels.length / BATCH_SIZE)}`);
}

// Run the enrichment
const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const limit = args.includes('--limit') ? parseInt(args[args.indexOf('--limit') + 1]) : null;

if (limit) {
  console.log(`Limiting to first ${limit} channels`);
}

enrichChannelsBatch(dryRun)
  .then(() => {
    console.log('Channel enrichment completed');
    process.exit(0);
  })
  .catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
  });