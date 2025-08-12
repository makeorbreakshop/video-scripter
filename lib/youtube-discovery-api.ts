// YouTube Channel Discovery API Service
// Handles subscription network crawling and channel validation using YouTube Data API v3

import { getValidAccessToken } from './youtube-oauth.ts';

export interface SubscriptionResult {
  channelId: string;
  title: string;
  description?: string;
  thumbnailUrl?: string;
  publishedAt?: string;
  subscriberCount?: number;
  videoCount?: number;
}

export interface ChannelValidationResult {
  channelId: string;
  title: string;
  description: string;
  thumbnailUrl: string;
  subscriberCount: number;
  videoCount: number;
  viewCount: number;
  publishedAt: string;
  customUrl?: string;
  uploads?: {
    recentVideoCount: number;
    lastUploadDate?: string;
  };
}

export interface QuotaUsage {
  subscriptions: number;
  channels: number;
  total: number;
}

export class YouTubeDiscoveryAPI {
  private quotaUsed: QuotaUsage = { subscriptions: 0, channels: 0, total: 0 };
  private cache: Map<string, { data: any; timestamp: number; ttl: number }> = new Map();

  /**
   * Gets subscription list for a channel with pagination support
   * Quota cost: 1 unit per request
   */
  async getChannelSubscriptions(
    channelId: string, 
    maxResults: number = 50,
    pageToken?: string
  ): Promise<{
    subscriptions: SubscriptionResult[];
    nextPageToken?: string;
    totalResults?: number;
    quotaUsed: number;
  }> {
    // For public subscription data, we can use API key instead of OAuth
    const apiKey = process.env.YOUTUBE_API_KEY;
    if (!apiKey) {
      throw new Error('YouTube API key not configured');
    }

    // Check cache first (30-day TTL)
    const cacheKey = `subscriptions_${channelId}_${maxResults}_${pageToken || 'first'}`;
    const cached = this.getCachedData(cacheKey, 30 * 24 * 60 * 60 * 1000); // 30 days
    if (cached) {
      return cached;
    }

    const url = new URL('https://www.googleapis.com/youtube/v3/subscriptions');
    url.searchParams.append('part', 'snippet');
    url.searchParams.append('channelId', channelId);
    url.searchParams.append('maxResults', Math.min(maxResults, 50).toString());
    url.searchParams.append('order', 'alphabetical');
    
    if (pageToken) {
      url.searchParams.append('pageToken', pageToken);
    }

    const response = await this.makeApiKeyRequest(url.toString(), apiKey);
    
    if (!response.ok) {
      const error = await response.json();
      throw new Error(`Subscriptions API error: ${error.error?.message || response.statusText}`);
    }

    const data = await response.json();
    const quotaUsed = 1; // subscriptions.list costs 1 unit
    this.quotaUsed.subscriptions += quotaUsed;
    this.quotaUsed.total += quotaUsed;

    const subscriptions: SubscriptionResult[] = data.items?.map((item: any) => ({
      channelId: item.snippet.resourceId.channelId,
      title: item.snippet.title,
      description: item.snippet.description,
      thumbnailUrl: item.snippet.thumbnails?.default?.url,
      publishedAt: item.snippet.publishedAt,
    })) || [];

    const result = {
      subscriptions,
      nextPageToken: data.nextPageToken,
      totalResults: data.pageInfo?.totalResults,
      quotaUsed
    };

    // Cache the result
    this.setCachedData(cacheKey, result, 30 * 24 * 60 * 60 * 1000);

    return result;
  }

  /**
   * Gets all subscriptions for a channel (handles pagination automatically)
   * Quota cost: 1 unit per 50 subscriptions
   */
  async getAllChannelSubscriptions(channelId: string): Promise<{
    subscriptions: SubscriptionResult[];
    totalQuotaUsed: number;
  }> {
    const allSubscriptions: SubscriptionResult[] = [];
    let nextPageToken: string | undefined;
    let totalQuotaUsed = 0;

    do {
      try {
        const result = await this.getChannelSubscriptions(channelId, 50, nextPageToken);
        allSubscriptions.push(...result.subscriptions);
        totalQuotaUsed += result.quotaUsed;
        nextPageToken = result.nextPageToken;

        // Add delay between requests to be respectful
        if (nextPageToken) {
          await this.delay(100);
        }
      } catch (error) {
        // Handle quota exhaustion or other errors gracefully
        if (error instanceof Error && error.message.includes('quotaExceeded')) {
          console.warn(`Quota exhausted while fetching subscriptions for ${channelId}`);
          break;
        }
        throw error;
      }
    } while (nextPageToken);

    return {
      subscriptions: allSubscriptions,
      totalQuotaUsed
    };
  }

  /**
   * Validates and enriches channel data in batches
   * Quota cost: 1 unit per request (up to 50 channels per request)
   */
  async validateChannels(channelIds: string[]): Promise<{
    channels: ChannelValidationResult[];
    quotaUsed: number;
  }> {
    const apiKey = process.env.YOUTUBE_API_KEY;
    if (!apiKey) {
      throw new Error('YouTube API key not configured');
    }

    const allChannels: ChannelValidationResult[] = [];
    let totalQuotaUsed = 0;

    // Process in batches of 50 (API limit)
    for (let i = 0; i < channelIds.length; i += 50) {
      const batch = channelIds.slice(i, i + 50);
      
      // Check cache first
      const cacheKey = `channels_${batch.sort().join('_')}`;
      const cached = this.getCachedData(cacheKey, 24 * 60 * 60 * 1000); // 24 hours
      
      if (cached) {
        allChannels.push(...cached.channels);
        continue;
      }

      const url = new URL('https://www.googleapis.com/youtube/v3/channels');
      url.searchParams.append('part', 'snippet,statistics,contentDetails');
      url.searchParams.append('id', batch.join(','));

      const response = await this.makeApiKeyRequest(url.toString(), apiKey);
      
      if (!response.ok) {
        const error = await response.json();
        console.warn(`Channels API error for batch: ${error.error?.message}`);
        continue;
      }

      const data = await response.json();
      const quotaUsed = 1; // channels.list costs 1 unit regardless of number of channels
      this.quotaUsed.channels += quotaUsed;
      this.quotaUsed.total += quotaUsed;
      totalQuotaUsed += quotaUsed;
      
      // Track in central quota system
      if (typeof window === 'undefined') {
        // Server-side only
        const { quotaTracker } = await import('./youtube-quota-tracker');
        await quotaTracker.trackAPICall('channels.list', {
          description: `Validate ${batch.length} channels`,
          count: 1
        });
      }

      const channels: ChannelValidationResult[] = data.items?.map((item: any) => ({
        channelId: item.id,
        title: item.snippet.title,
        description: item.snippet.description || '',
        thumbnailUrl: item.snippet.thumbnails?.default?.url || '',
        subscriberCount: parseInt(item.statistics.subscriberCount || '0'),
        videoCount: parseInt(item.statistics.videoCount || '0'),
        viewCount: parseInt(item.statistics.viewCount || '0'),
        publishedAt: item.snippet.publishedAt,
        customUrl: item.snippet.customUrl,
      })) || [];

      allChannels.push(...channels);

      // Cache the batch result
      this.setCachedData(cacheKey, { channels }, 24 * 60 * 60 * 1000);

      // Add delay between batch requests
      if (i + 50 < channelIds.length) {
        await this.delay(100);
      }
    }

    return {
      channels: allChannels,
      quotaUsed: totalQuotaUsed
    };
  }

  /**
   * Extracts featured channels from existing channel data calls
   * Quota cost: 0 units (piggybacks on existing channel validation calls)
   */
  async getFeaturedChannels(channelIds: string[]): Promise<{
    featuredChannels: { sourceChannelId: string; featuredChannelIds: string[] }[];
    quotaUsed: number;
  }> {
    const apiKey = process.env.YOUTUBE_API_KEY;
    if (!apiKey) {
      throw new Error('YouTube API key not configured');
    }

    const allFeaturedChannels: { sourceChannelId: string; featuredChannelIds: string[] }[] = [];
    let totalQuotaUsed = 0;

    // Process in batches of 50 (API limit)
    for (let i = 0; i < channelIds.length; i += 50) {
      const batch = channelIds.slice(i, i + 50);
      
      // Check cache first
      const cacheKey = `featured_${batch.sort().join('_')}`;
      const cached = this.getCachedData(cacheKey, 7 * 24 * 60 * 60 * 1000); // 7 days
      
      if (cached) {
        allFeaturedChannels.push(...cached.featuredChannels);
        continue;
      }

      const url = new URL('https://www.googleapis.com/youtube/v3/channels');
      url.searchParams.append('part', 'brandingSettings');
      url.searchParams.append('id', batch.join(','));

      const response = await this.makeApiKeyRequest(url.toString(), apiKey);
      
      if (!response.ok) {
        const error = await response.json();
        console.warn(`Featured channels API error for batch: ${error.error?.message}`);
        continue;
      }

      const data = await response.json();
      const quotaUsed = 1; // channels.list costs 1 unit regardless of number of channels
      this.quotaUsed.channels += quotaUsed;
      this.quotaUsed.total += quotaUsed;
      totalQuotaUsed += quotaUsed;

      const batchFeaturedChannels = data.items?.map((item: any) => {
        const featuredChannelsUrls = item.brandingSettings?.channel?.featuredChannelsUrls || [];
        
        // Extract channel IDs from featured channel URLs
        const featuredChannelIds = featuredChannelsUrls
          .map((url: string) => {
            // Extract channel ID from various YouTube URL formats
            const channelMatch = url.match(/(?:channel\/|user\/|c\/|@)([^\/\?]+)/);
            return channelMatch ? channelMatch[1] : null;
          })
          .filter(Boolean);

        return {
          sourceChannelId: item.id,
          featuredChannelIds
        };
      }).filter((result: any) => result.featuredChannelIds.length > 0) || [];

      allFeaturedChannels.push(...batchFeaturedChannels);

      // Cache the batch result
      this.setCachedData(cacheKey, { featuredChannels: batchFeaturedChannels }, 7 * 24 * 60 * 60 * 1000);

      // Add delay between batch requests
      if (i + 50 < channelIds.length) {
        await this.delay(100);
      }
    }

    return {
      featuredChannels: allFeaturedChannels,
      quotaUsed: totalQuotaUsed
    };
  }

  /**
   * Gets multi-channel shelves for channels (Method 3)
   * Quota cost: 1 unit per request per channel
   */
  async getMultiChannelShelves(channelIds: string[]): Promise<{
    shelves: { sourceChannelId: string; shelfChannelIds: string[] }[];
    quotaUsed: number;
  }> {
    const apiKey = process.env.YOUTUBE_API_KEY;
    if (!apiKey) {
      throw new Error('YouTube API key not configured');
    }

    const allShelves: { sourceChannelId: string; shelfChannelIds: string[] }[] = [];
    let totalQuotaUsed = 0;

    // Process each channel individually (channelSections API doesn't support batch)
    for (const channelId of channelIds) {
      try {
        // Check cache first
        const cacheKey = `shelves_${channelId}`;
        const cached = this.getCachedData(cacheKey, 7 * 24 * 60 * 60 * 1000); // 7 days
        
        if (cached) {
          allShelves.push(...cached.shelves);
          continue;
        }

        const url = new URL('https://www.googleapis.com/youtube/v3/channelSections');
        url.searchParams.append('part', 'snippet,contentDetails');
        url.searchParams.append('channelId', channelId);

        const response = await this.makeApiKeyRequest(url.toString(), apiKey);
        
        if (!response.ok) {
          const error = await response.json();
          console.warn(`Channel sections API error for ${channelId}: ${error.error?.message}`);
          continue;
        }

        const data = await response.json();
        const quotaUsed = 1; // channelSections.list costs 1 unit
        this.quotaUsed.channels += quotaUsed;
        this.quotaUsed.total += quotaUsed;
        totalQuotaUsed += quotaUsed;

        // Extract multi-channel shelves
        const channelShelves = data.items
          ?.filter((item: any) => item.snippet.type === 'multipleChannels')
          .map((item: any) => {
            const shelfChannelIds = item.contentDetails?.channels || [];
            return {
              sourceChannelId: channelId,
              shelfChannelIds
            };
          })
          .filter((shelf: any) => shelf.shelfChannelIds.length > 0) || [];

        allShelves.push(...channelShelves);

        // Cache the result
        this.setCachedData(cacheKey, { shelves: channelShelves }, 7 * 24 * 60 * 60 * 1000);

        // Rate limiting between requests
        await this.delay(100);

      } catch (error) {
        console.warn(`Error getting channel sections for ${channelId}:`, error);
      }
    }

    return {
      shelves: allShelves,
      quotaUsed: totalQuotaUsed
    };
  }

  /**
   * Gets playlist creators from channel playlists (Method 4)
   * Quota cost: 1 unit per playlist request
   */
  async getPlaylistCreators(channelIds: string[], maxPlaylistsPerChannel: number = 5): Promise<{
    creators: { sourceChannelId: string; creatorChannelIds: string[] }[];
    quotaUsed: number;
  }> {
    const apiKey = process.env.YOUTUBE_API_KEY;
    if (!apiKey) {
      throw new Error('YouTube API key not configured');
    }

    const allCreators: { sourceChannelId: string; creatorChannelIds: string[] }[] = [];
    let totalQuotaUsed = 0;

    // First, get playlists for each channel
    for (const channelId of channelIds) {
      try {
        // Check cache first
        const cacheKey = `playlist_creators_${channelId}`;
        const cached = this.getCachedData(cacheKey, 24 * 60 * 60 * 1000); // 24 hours
        
        if (cached) {
          allCreators.push(cached);
          continue;
        }

        // Get playlists for this channel
        const playlistsUrl = new URL('https://www.googleapis.com/youtube/v3/playlists');
        playlistsUrl.searchParams.append('part', 'id,snippet');
        playlistsUrl.searchParams.append('channelId', channelId);
        playlistsUrl.searchParams.append('maxResults', maxPlaylistsPerChannel.toString());

        const playlistsResponse = await this.makeApiKeyRequest(playlistsUrl.toString(), apiKey);
        
        if (!playlistsResponse.ok) {
          console.warn(`Playlists API error for ${channelId}`);
          continue;
        }

        const playlistsData = await playlistsResponse.json();
        const quotaUsed = 1; // playlists.list costs 1 unit
        this.quotaUsed.channels += quotaUsed;
        this.quotaUsed.total += quotaUsed;
        totalQuotaUsed += quotaUsed;

        const playlists = playlistsData.items || [];
        const creatorChannelIds: string[] = [];

        // Get items from each playlist
        for (const playlist of playlists.slice(0, maxPlaylistsPerChannel)) {
          try {
            const itemsUrl = new URL('https://www.googleapis.com/youtube/v3/playlistItems');
            itemsUrl.searchParams.append('part', 'snippet');
            itemsUrl.searchParams.append('playlistId', playlist.id);
            itemsUrl.searchParams.append('maxResults', '50');

            const itemsResponse = await this.makeApiKeyRequest(itemsUrl.toString(), apiKey);
            
            if (!itemsResponse.ok) {
              continue;
            }

            const itemsData = await itemsResponse.json();
            const itemsQuotaUsed = 1; // playlistItems.list costs 1 unit
            this.quotaUsed.channels += itemsQuotaUsed;
            this.quotaUsed.total += itemsQuotaUsed;
            totalQuotaUsed += itemsQuotaUsed;

            // Extract video owner channel IDs
            const videoOwnerChannelIds = itemsData.items
              ?.map((item: any) => item.snippet.videoOwnerChannelId)
              .filter(Boolean) || [];

            creatorChannelIds.push(...videoOwnerChannelIds);

            // Rate limiting between playlist requests
            await this.delay(100);

          } catch (error) {
            console.warn(`Error getting playlist items for playlist ${playlist.id}:`, error);
          }
        }

        // Remove duplicates and filter out the source channel itself
        const uniqueCreatorIds = [...new Set(creatorChannelIds)]
          .filter(id => id !== channelId);

        const result = {
          sourceChannelId: channelId,
          creatorChannelIds: uniqueCreatorIds
        };

        allCreators.push(result);

        // Cache the result
        this.setCachedData(cacheKey, result, 24 * 60 * 60 * 1000);

        // Rate limiting between channels
        await this.delay(200);

      } catch (error) {
        console.warn(`Error getting playlist creators for ${channelId}:`, error);
      }
    }

    return {
      creators: allCreators,
      quotaUsed: totalQuotaUsed
    };
  }

  /**
   * Gets recent upload activity for channels to check if they're active
   * Quota cost: 1 unit per request (up to 50 channels per request)
   */
  async checkChannelActivity(channelIds: string[], maxAge: number = 180): Promise<{
    activeChannels: string[];
    inactiveChannels: string[];
    quotaUsed: number;
  }> {

    const activeChannels: string[] = [];
    const inactiveChannels: string[] = [];
    let totalQuotaUsed = 0;
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - maxAge);

    // Get upload playlist IDs for channels
    const channelData = await this.validateChannels(channelIds);
    totalQuotaUsed += channelData.quotaUsed;

    for (const channel of channelData.channels) {
      // Check if channel was created recently (could be considered active)
      const publishedDate = new Date(channel.publishedAt);
      if (publishedDate > cutoffDate) {
        activeChannels.push(channel.channelId);
        continue;
      }

      // If we have video count, we can make an educated guess
      if (channel.videoCount > 0) {
        // For now, assume channels with videos are potentially active
        // In a full implementation, we'd check their uploads playlist
        activeChannels.push(channel.channelId);
      } else {
        inactiveChannels.push(channel.channelId);
      }
    }

    return {
      activeChannels,
      inactiveChannels,
      quotaUsed: totalQuotaUsed
    };
  }

  /**
   * Gets recent videos from a channel for collaboration analysis
   * Quota cost: 1 unit per request
   */
  async getChannelVideos(
    channelId: string,
    maxResults: number = 50
  ): Promise<{ videos: any[], quotaUsed: number }> {
    const cacheKey = `videos:${channelId}:${maxResults}`;
    const cached = this.getCachedData(cacheKey, 3600000); // 1 hour TTL
    
    if (cached) {
      console.log(`📦 Using cached videos for channel ${channelId}`);
      return { videos: cached, quotaUsed: 0 };
    }

    try {
      const apiKey = process.env.YOUTUBE_API_KEY;
      if (!apiKey) {
        throw new Error('YouTube API key not configured');
      }

      // Get the uploads playlist ID first (uploads playlist = channel uploads)
      const channelResponse = await this.makeApiKeyRequest(
        `https://www.googleapis.com/youtube/v3/channels?part=contentDetails&id=${channelId}`,
        apiKey
      );

      if (!channelResponse.ok) {
        throw new Error(`Channel API error: ${channelResponse.status}`);
      }

      const channelData = await channelResponse.json();

      if (!channelData.items || channelData.items.length === 0) {
        return { videos: [], quotaUsed: 1 };
      }

      const uploadsPlaylistId = channelData.items[0].contentDetails?.relatedPlaylists?.uploads;
      
      if (!uploadsPlaylistId) {
        return { videos: [], quotaUsed: 1 };
      }

      // Get recent videos from uploads playlist with detailed snippet info
      const videosResponse = await this.makeApiKeyRequest(
        `https://www.googleapis.com/youtube/v3/playlistItems?part=snippet&playlistId=${uploadsPlaylistId}&maxResults=${maxResults}`,
        apiKey
      );

      if (!videosResponse.ok) {
        throw new Error(`PlaylistItems API error: ${videosResponse.status}`);
      }

      const videosData = await videosResponse.json();
      const videos = videosData.items || [];
      
      // Cache the results
      this.setCachedData(cacheKey, videos, 3600000);
      
      // Track quota usage
      this.quotaUsed.channels += 2; // 1 for channel lookup + 1 for playlist items
      this.quotaUsed.total += 2;

      console.log(`📹 Retrieved ${videos.length} videos for channel ${channelId}`);
      return { videos, quotaUsed: 2 };

    } catch (error) {
      console.error(`Error getting videos for channel ${channelId}:`, error);
      throw error;
    }
  }

  /**
   * Searches for channels by name
   * Quota cost: 100 units per request (expensive!)
   */
  async searchChannels(
    query: string,
    maxResults: number = 5
  ): Promise<{ channels: Array<{ channelId: string; title: string; description: string; }>; quotaUsed: number }> {
    const cacheKey = `search:${query}:${maxResults}`;
    const cached = this.getCachedData(cacheKey, 86400000); // 24 hour TTL
    
    if (cached) {
      console.log(`📦 Using cached search results for "${query}"`);
      return { channels: cached, quotaUsed: 0 };
    }

    try {
      const apiKey = process.env.YOUTUBE_API_KEY;
      if (!apiKey) {
        throw new Error('YouTube API key not configured');
      }

      const searchResponse = await this.makeApiKeyRequest(
        `https://www.googleapis.com/youtube/v3/search?part=snippet&type=channel&q=${encodeURIComponent(query)}&maxResults=${maxResults}`,
        apiKey
      );

      if (!searchResponse.ok) {
        throw new Error(`Search API error: ${searchResponse.status}`);
      }

      const searchData = await searchResponse.json();

      const channels = (searchData.items || []).map((item: any) => ({
        channelId: item.snippet?.channelId || item.id?.channelId,
        title: item.snippet?.title || '',
        description: item.snippet?.description || ''
      })).filter((c: any) => c.channelId);
      
      // Cache the results
      this.setCachedData(cacheKey, channels, 86400000);
      
      // Track quota usage (search is expensive!)
      this.quotaUsed.channels += 100;
      this.quotaUsed.total += 100;

      console.log(`🔍 Search for "${query}" returned ${channels.length} channels (100 quota used)`);
      return { channels, quotaUsed: 100 };

    } catch (error) {
      console.error(`Error searching for channels with query "${query}":`, error);
      throw error;
    }
  }

  /**
   * Resets quota tracking (call this daily)
   */
  resetQuotaTracking(): void {
    this.quotaUsed = { subscriptions: 0, channels: 0, total: 0 };
  }

  /**
   * Gets current quota usage
   */
  getQuotaUsage(): QuotaUsage {
    return { ...this.quotaUsed };
  }

  /**
   * Clears all cached data
   */
  clearCache(): void {
    this.cache.clear();
  }

  // Private helper methods

  private async makeAuthenticatedRequest(url: string, accessToken: string): Promise<Response> {
    return fetch(url, {
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Accept': 'application/json',
      },
    });
  }

  private async makeApiKeyRequest(url: string, apiKey: string): Promise<Response> {
    const urlWithKey = new URL(url);
    urlWithKey.searchParams.append('key', apiKey);
    
    return fetch(urlWithKey.toString(), {
      headers: {
        'Accept': 'application/json',
      },
    });
  }

  private getCachedData(key: string, maxAge: number): any {
    const cached = this.cache.get(key);
    if (!cached) return null;

    const age = Date.now() - cached.timestamp;
    if (age > maxAge) {
      this.cache.delete(key);
      return null;
    }

    return cached.data;
  }

  private setCachedData(key: string, data: any, ttl: number): void {
    this.cache.set(key, {
      data,
      timestamp: Date.now(),
      ttl
    });
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// Singleton instance
export const youtubeDiscoveryAPI = new YouTubeDiscoveryAPI();