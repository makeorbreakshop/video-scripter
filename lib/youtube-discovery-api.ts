// YouTube Channel Discovery API Service
// Handles subscription network crawling and channel validation using YouTube Data API v3

import { getValidAccessToken } from './youtube-oauth';

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
    const accessToken = await getValidAccessToken();
    if (!accessToken) {
      throw new Error('YouTube authentication required');
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

    const response = await this.makeAuthenticatedRequest(url.toString(), accessToken);
    
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
    const accessToken = await getValidAccessToken();
    if (!accessToken) {
      throw new Error('YouTube authentication required');
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

      const response = await this.makeAuthenticatedRequest(url.toString(), accessToken);
      
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
   * Gets recent upload activity for channels to check if they're active
   * Quota cost: 1 unit per request (up to 50 channels per request)
   */
  async checkChannelActivity(channelIds: string[], maxAge: number = 180): Promise<{
    activeChannels: string[];
    inactiveChannels: string[];
    quotaUsed: number;
  }> {
    const accessToken = await getValidAccessToken();
    if (!accessToken) {
      throw new Error('YouTube authentication required');
    }

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