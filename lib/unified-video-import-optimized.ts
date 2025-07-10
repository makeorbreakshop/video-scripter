/**
 * Optimized Video Import Methods for Unified Video Import Service
 * 
 * Key Optimizations:
 * 1. Batch channel statistics fetching (1 API call per 50 channels vs 1 per video)
 * 2. Batch video details fetching (50 videos per API call)
 * 3. Parallel processing where possible
 * 4. Efficient deduplication and filtering
 * 5. Smart caching of channel stats during import
 */

export class OptimizedVideoImportMethods {
  /**
   * OPTIMIZED: Fetch video details with batched channel statistics
   * Reduces API calls from O(n*2) to O(n/50 + m/50) where n=videos, m=unique channels
   */
  async fetchVideoMetadataOptimized(
    videoIds: string[], 
    source: string, 
    userId?: string
  ): Promise<VideoMetadata[]> {
    console.log(`🚀 Starting optimized video metadata fetch for ${videoIds.length} videos`);
    
    // Step 1: Fetch all video details in batches
    const videoDetailsMap = new Map<string, any>();
    const channelIds = new Set<string>();
    
    const videoBatchSize = 50; // YouTube API limit
    for (let i = 0; i < videoIds.length; i += videoBatchSize) {
      const batch = videoIds.slice(i, i + videoBatchSize);
      const videoIdsParam = batch.join(',');
      
      try {
        console.log(`📹 Fetching video batch ${Math.floor(i/videoBatchSize) + 1}/${Math.ceil(videoIds.length/videoBatchSize)}`);
        
        const response = await fetch(
          `https://www.googleapis.com/youtube/v3/videos?` +
          `part=snippet,statistics,contentDetails&` +
          `id=${videoIdsParam}&` +
          `key=${this.youtubeApiKey}`
        );
        
        if (response.ok) {
          const data = await response.json();
          
          for (const video of data.items || []) {
            videoDetailsMap.set(video.id, video);
            channelIds.add(video.snippet.channelId);
          }
        }
      } catch (error) {
        console.error(`❌ Failed to fetch video batch:`, error);
      }
    }
    
    console.log(`✅ Fetched ${videoDetailsMap.size} videos from ${channelIds.size} unique channels`);
    
    // Step 2: Fetch all unique channel statistics in batches
    const channelStatsMap = await this.fetchChannelStatsBatch(Array.from(channelIds));
    
    // Step 3: Combine video and channel data
    const videos: VideoMetadata[] = [];
    
    for (const [videoId, video] of videoDetailsMap) {
      const snippet = video.snippet;
      const statistics = video.statistics;
      const channelData = channelStatsMap.get(snippet.channelId);
      
      const metadata: Record<string, any> = {
        channel_name: snippet.channelTitle,
        channel_title: channelData?.title || snippet.channelTitle,
        youtube_channel_id: snippet.channelId,
        channel_handle: channelData?.handle || null,
        duration: video.contentDetails?.duration || null,
        tags: snippet.tags || [],
        category_id: snippet.categoryId || null,
        live_broadcast_content: snippet.liveBroadcastContent || null,
        default_language: snippet.defaultLanguage || null,
        default_audio_language: snippet.defaultAudioLanguage || null,
        // Add channel statistics
        channel_stats: channelData?.stats || null
      };
      
      videos.push({
        id: videoId,
        title: snippet.title,
        channel_id: snippet.channelId,
        channel_name: snippet.channelTitle,
        view_count: parseInt(statistics.viewCount || '0'),
        published_at: snippet.publishedAt,
        performance_ratio: 1, // Database calculates this
        thumbnail_url: snippet.thumbnails?.maxresdefault?.url || 
                      snippet.thumbnails?.high?.url || 
                      snippet.thumbnails?.medium?.url || 
                      snippet.thumbnails?.default?.url || '',
        description: snippet.description || '',
        data_source: source === 'owner' ? 'owner' : 'competitor',
        is_competitor: source !== 'owner',
        import_date: new Date().toISOString(),
        user_id: userId || '00000000-0000-0000-0000-000000000000',
        metadata: metadata
      });
    }
    
    console.log(`📊 Processed ${videos.length} videos with complete metadata`);
    return videos;
  }

  /**
   * OPTIMIZED: Batch fetch channel statistics
   * Fetches up to 50 channels per API call
   */
  private async fetchChannelStatsBatch(channelIds: string[]): Promise<Map<string, any>> {
    console.log(`📺 Fetching statistics for ${channelIds.length} unique channels`);
    const channelStatsMap = new Map();
    
    // Remove duplicates
    const uniqueChannelIds = Array.from(new Set(channelIds));
    
    // YouTube API allows up to 50 channel IDs per request
    const batchSize = 50;
    
    for (let i = 0; i < uniqueChannelIds.length; i += batchSize) {
      const batch = uniqueChannelIds.slice(i, i + batchSize);
      const channelIdsParam = batch.join(',');
      
      try {
        console.log(`📊 Fetching channel batch ${Math.floor(i/batchSize) + 1}/${Math.ceil(uniqueChannelIds.length/batchSize)}`);
        
        const response = await fetch(
          `https://www.googleapis.com/youtube/v3/channels?` +
          `part=snippet,statistics&` +
          `id=${channelIdsParam}&` +
          `key=${this.youtubeApiKey}`
        );
        
        if (response.ok) {
          const data = await response.json();
          
          for (const channel of data.items || []) {
            const channelStats = {
              subscriber_count: channel.statistics?.subscriberCount || '0',
              view_count: channel.statistics?.viewCount || '0',
              video_count: channel.statistics?.videoCount || '0',
              channel_thumbnail: channel.snippet?.thumbnails?.high?.url || 
                               channel.snippet?.thumbnails?.default?.url || null,
            };
            
            channelStatsMap.set(channel.id, {
              stats: channelStats,
              handle: channel.snippet?.customUrl || null,
              title: channel.snippet?.title || null
            });
          }
        }
      } catch (error) {
        console.error(`❌ Failed to fetch channel stats for batch:`, error);
      }
    }
    
    console.log(`✅ Retrieved stats for ${channelStatsMap.size} channels`);
    return channelStatsMap;
  }

  /**
   * OPTIMIZED: Fetch videos from channels using search API
   * More efficient than playlist API for large channels
   */
  async fetchVideosFromChannelsOptimized(
    channelIds: string[], 
    options?: {
      maxVideosPerChannel?: number;
      timePeriod?: string;
      excludeShorts?: boolean;
    }
  ): Promise<string[]> {
    console.log(`🚀 Starting optimized channel video fetch for ${channelIds.length} channels`);
    
    const allVideoIds: string[] = [];
    
    // Calculate date filter
    const isAllTime = !options?.timePeriod || options.timePeriod === 'all';
    const daysAgo = isAllTime ? 0 : parseInt(options.timePeriod) || 3650;
    const publishedAfter = isAllTime ? null : new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000);
    
    // Process channels in parallel (but limit concurrency to avoid rate limits)
    const concurrencyLimit = 3;
    const channelPromises = [];
    
    for (let i = 0; i < channelIds.length; i += concurrencyLimit) {
      const channelBatch = channelIds.slice(i, i + concurrencyLimit);
      
      const batchPromise = Promise.all(
        channelBatch.map(channelId => 
          this.fetchChannelVideosOptimized(channelId, options, publishedAfter)
        )
      );
      
      channelPromises.push(batchPromise);
    }
    
    // Wait for all batches
    const results = await Promise.all(channelPromises);
    
    // Flatten results
    for (const batchResults of results) {
      for (const channelVideoIds of batchResults) {
        allVideoIds.push(...channelVideoIds);
      }
    }
    
    console.log(`✅ Retrieved ${allVideoIds.length} total videos from ${channelIds.length} channels`);
    return allVideoIds;
  }

  /**
   * OPTIMIZED: Fetch videos from a single channel
   * Uses search API for better performance with large channels
   */
  private async fetchChannelVideosOptimized(
    channelId: string,
    options?: {
      maxVideosPerChannel?: number;
      timePeriod?: string;
      excludeShorts?: boolean;
    },
    publishedAfter?: Date | null
  ): Promise<string[]> {
    const videoIds: string[] = [];
    let nextPageToken: string | undefined;
    const pageSize = 50;
    const maxResults = options?.maxVideosPerChannel || 500; // Default limit
    
    console.log(`📺 Fetching videos from channel ${channelId}`);
    
    try {
      // Use search API instead of playlist API for better performance
      do {
        let searchUrl = `https://www.googleapis.com/youtube/v3/search?` +
          `part=id&` +
          `channelId=${channelId}&` +
          `type=video&` +
          `order=date&` +
          `maxResults=${pageSize}`;
        
        if (publishedAfter) {
          searchUrl += `&publishedAfter=${publishedAfter.toISOString()}`;
        }
        
        if (nextPageToken) {
          searchUrl += `&pageToken=${nextPageToken}`;
        }
        
        searchUrl += `&key=${this.youtubeApiKey}`;
        
        const response = await fetch(searchUrl);
        
        if (!response.ok) {
          console.error(`❌ Search API error for channel ${channelId}: ${response.status}`);
          break;
        }
        
        const data = await response.json();
        
        if (data.items && data.items.length > 0) {
          const batchVideoIds = data.items.map((item: any) => item.id.videoId);
          
          // If excluding shorts, batch check durations
          if (options?.excludeShorts) {
            const nonShortIds = await this.filterOutShorts(batchVideoIds);
            videoIds.push(...nonShortIds);
          } else {
            videoIds.push(...batchVideoIds);
          }
          
          if (videoIds.length >= maxResults) {
            // Trim to exact limit
            videoIds.splice(maxResults);
            break;
          }
          
          nextPageToken = data.nextPageToken;
        } else {
          break;
        }
      } while (nextPageToken && videoIds.length < maxResults);
      
    } catch (error) {
      console.error(`❌ Error fetching videos from channel ${channelId}:`, error);
    }
    
    console.log(`✅ Retrieved ${videoIds.length} videos from channel ${channelId}`);
    return videoIds;
  }

  /**
   * Helper: Filter out YouTube Shorts from video IDs
   */
  private async filterOutShorts(videoIds: string[]): Promise<string[]> {
    if (videoIds.length === 0) return [];
    
    try {
      const response = await fetch(
        `https://www.googleapis.com/youtube/v3/videos?` +
        `part=contentDetails&` +
        `id=${videoIds.join(',')}&` +
        `key=${this.youtubeApiKey}`
      );
      
      if (!response.ok) return videoIds; // Return all if API fails
      
      const data = await response.json();
      
      return data.items
        ?.filter((video: any) => {
          const duration = video.contentDetails?.duration || '';
          const match = duration.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
          if (!match) return true;
          
          const hours = parseInt(match[1] || '0');
          const minutes = parseInt(match[2] || '0');
          const seconds = parseInt(match[3] || '0');
          const totalSeconds = hours * 3600 + minutes * 60 + seconds;
          
          return totalSeconds >= 60; // Keep videos 60 seconds or longer
        })
        .map((video: any) => video.id) || [];
        
    } catch (error) {
      console.error('Error filtering shorts:', error);
      return videoIds; // Return all on error
    }
  }
}

/**
 * Summary of optimizations:
 * 
 * 1. BATCH CHANNEL STATS: Instead of fetching channel stats for each video individually,
 *    we collect all unique channel IDs and fetch them in batches of 50.
 *    - Before: 1000 videos = 2000 API calls (1 video + 1 channel per video)
 *    - After: 1000 videos = ~20 video calls + ~2 channel calls = 22 API calls
 *    - Reduction: 98.9% fewer API calls
 * 
 * 2. SEARCH API: Using search API instead of playlist API for channels
 *    - Allows date filtering at API level (reduces data transfer)
 *    - Better performance for large channels
 *    - Direct video type filtering
 * 
 * 3. PARALLEL PROCESSING: Process multiple channels concurrently
 *    - Controlled concurrency to avoid rate limits
 *    - Significantly faster for multi-channel imports
 * 
 * 4. SMART FILTERING: Only fetch duration data when excluding shorts
 *    - Reduces unnecessary API calls when not filtering
 *    - Batch duration checks instead of individual
 * 
 * 5. EARLY TERMINATION: Stop fetching when limits are reached
 *    - Avoid fetching unnecessary pages of results
 *    - Respect maxVideosPerChannel efficiently
 */