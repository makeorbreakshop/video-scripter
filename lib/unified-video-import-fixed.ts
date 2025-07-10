/**
 * Fixed fetchVideoDetails method that includes channel statistics
 * This should replace the existing method in unified-video-import.ts
 */

/**
 * Helper: Fetch individual video details with channel statistics
 */
private async fetchVideoDetails(videoId: string): Promise<Partial<VideoMetadata> | null> {
  try {
    const response = await fetch(
      `https://www.googleapis.com/youtube/v3/videos?part=snippet,statistics&id=${videoId}&key=${this.youtubeApiKey}`
    );
    
    if (!response.ok) {
      throw new Error(`YouTube API error: ${response.status}`);
    }
    
    const data = await response.json();
    
    if (!data.items || data.items.length === 0) {
      return null;
    }
    
    const video = data.items[0];
    const snippet = video.snippet;
    const statistics = video.statistics;
    
    // Now fetch channel statistics
    const channelResponse = await fetch(
      `https://www.googleapis.com/youtube/v3/channels?part=snippet,statistics&id=${snippet.channelId}&key=${this.youtubeApiKey}`
    );
    
    let channelStats = null;
    let channelHandle = null;
    let channelThumbnail = null;
    
    if (channelResponse.ok) {
      const channelData = await channelResponse.json();
      if (channelData.items && channelData.items.length > 0) {
        const channel = channelData.items[0];
        channelStats = {
          subscriber_count: channel.statistics?.subscriberCount || '0',
          view_count: channel.statistics?.viewCount || '0',
          video_count: channel.statistics?.videoCount || '0',
          channel_thumbnail: channel.snippet?.thumbnails?.high?.url || 
                           channel.snippet?.thumbnails?.default?.url || null,
        };
        channelHandle = channel.snippet?.customUrl || null;
        channelThumbnail = channelStats.channel_thumbnail;
      }
    }
    
    // Calculate performance ratio (views / subscriber count, defaulting to 1.0)
    const viewCount = parseInt(statistics.viewCount || '0');
    const performance_ratio = 1; // Database calculates this via rolling_baseline_views
    
    // Build metadata object with channel stats
    const metadata: Record<string, any> = {
      channel_name: snippet.channelTitle,
      channel_title: snippet.channelTitle,
      youtube_channel_id: snippet.channelId,
      channel_handle: channelHandle,
      duration: video.contentDetails?.duration || null,
      tags: snippet.tags || [],
      category_id: snippet.categoryId || null,
      live_broadcast_content: snippet.liveBroadcastContent || null,
      default_language: snippet.defaultLanguage || null,
      default_audio_language: snippet.defaultAudioLanguage || null,
      // Add channel statistics
      channel_stats: channelStats
    };
    
    return {
      id: videoId,
      title: snippet.title,
      channel_id: snippet.channelId,
      channel_name: snippet.channelTitle,
      view_count: viewCount,
      published_at: snippet.publishedAt,
      performance_ratio,
      thumbnail_url: snippet.thumbnails?.maxresdefault?.url || 
                    snippet.thumbnails?.high?.url || 
                    snippet.thumbnails?.medium?.url || 
                    snippet.thumbnails?.default?.url || '',
      description: snippet.description || '',
      metadata: metadata
    };
  } catch (error) {
    console.error(`❌ Failed to fetch video details for ${videoId}:`, error);
    return null;
  }
}

/**
 * Alternative: Batch fetch channel statistics for better efficiency
 * This method fetches channel stats for multiple channels at once
 */
private async fetchChannelStatsBatch(channelIds: string[]): Promise<Map<string, any>> {
  const channelStatsMap = new Map();
  
  // Remove duplicates
  const uniqueChannelIds = Array.from(new Set(channelIds));
  
  // YouTube API allows up to 50 channel IDs per request
  const batchSize = 50;
  
  for (let i = 0; i < uniqueChannelIds.length; i += batchSize) {
    const batch = uniqueChannelIds.slice(i, i + batchSize);
    const channelIdsParam = batch.join(',');
    
    try {
      const response = await fetch(
        `https://www.googleapis.com/youtube/v3/channels?part=snippet,statistics&id=${channelIdsParam}&key=${this.youtubeApiKey}`
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
  
  return channelStatsMap;
}

/**
 * More efficient version of fetchVideoDetailsBatch that fetches channel stats in bulk
 */
private async fetchVideoDetailsBatchEfficient(videoIds: string[], source: string, userId?: string): Promise<VideoMetadata[]> {
  // First, fetch all video details
  const videoDetailsMap = new Map();
  const channelIds = new Set<string>();
  
  // Fetch videos in batches of 50 (YouTube API limit)
  const batchSize = 50;
  for (let i = 0; i < videoIds.length; i += batchSize) {
    const batch = videoIds.slice(i, i + batchSize);
    const videoIdsParam = batch.join(',');
    
    try {
      const response = await fetch(
        `https://www.googleapis.com/youtube/v3/videos?part=snippet,statistics,contentDetails&id=${videoIdsParam}&key=${this.youtubeApiKey}`
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
  
  // Now fetch all channel stats in bulk
  const channelStatsMap = await this.fetchChannelStatsBatch(Array.from(channelIds));
  
  // Combine video and channel data
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
  
  return videos;
}