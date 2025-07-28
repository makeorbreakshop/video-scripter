/**
 * Google Programmable Search Engine Service
 * Uses Google's Custom Search API to search YouTube without using YouTube API quota
 * 100 free searches per day!
 */

import { quotaTracker } from './youtube-quota-tracker';

interface PSESearchResult {
  kind: string;
  title: string;
  htmlTitle: string;
  link: string;
  displayLink: string;
  snippet: string;
  htmlSnippet: string;
  cacheId?: string;
  formattedUrl: string;
  htmlFormattedUrl: string;
  pagemap?: {
    cse_thumbnail?: Array<{
      src: string;
      width: string;
      height: string;
    }>;
    videoobject?: Array<{
      name: string;
      description: string;
      thumbnailurl: string;
      uploaddate: string;
      duration: string;
      author: string;
      channelid: string;
    }>;
    person?: Array<{
      name: string;
      url: string;
    }>;
    metatags?: Array<{
      [key: string]: string;
    }>;
  };
}

interface PSEResponse {
  kind: string;
  url: {
    type: string;
    template: string;
  };
  queries: {
    request: Array<{
      title: string;
      totalResults: string;
      searchTerms: string;
      count: number;
      startIndex: number;
      inputEncoding: string;
      outputEncoding: string;
      safe: string;
      cx: string;
    }>;
    nextPage?: Array<{
      title: string;
      totalResults: string;
      searchTerms: string;
      count: number;
      startIndex: number;
      inputEncoding: string;
      outputEncoding: string;
      safe: string;
      cx: string;
    }>;
  };
  context: {
    title: string;
  };
  searchInformation: {
    searchTime: number;
    formattedSearchTime: string;
    totalResults: string;
    formattedTotalResults: string;
  };
  items?: PSESearchResult[];
}

export interface ExtractedChannel {
  channelId: string;
  channelName: string;
  channelUrl: string;
  videoUrl?: string;
  videoTitle?: string;
  confidence: 'high' | 'medium' | 'low';
  source: 'video' | 'channel';
}

export class GooglePSEService {
  private apiKey: string;
  private searchEngineId: string;
  private baseUrl = 'https://www.googleapis.com/customsearch/v1';
  private dailyQuotaUsed: number = 0;
  private maxDailyQuota: number = 100;
  private lastResetDate: string = '';

  constructor() {
    this.apiKey = process.env.GOOGLE_PSE_API_KEY || process.env.GOOGLE_API_KEY || '';
    this.searchEngineId = process.env.GOOGLE_PSE_ENGINE_ID || '';
    
    if (!this.apiKey || !this.searchEngineId) {
      console.warn('Google PSE credentials not configured. Set GOOGLE_PSE_API_KEY and GOOGLE_PSE_ENGINE_ID');
    }
    
    this.loadQuotaFromStorage();
  }

  private loadQuotaFromStorage() {
    const today = new Date().toISOString().split('T')[0];
    if (this.lastResetDate !== today) {
      this.dailyQuotaUsed = 0;
      this.lastResetDate = today;
    }
  }

  private checkQuota(): boolean {
    this.loadQuotaFromStorage();
    return this.dailyQuotaUsed < this.maxDailyQuota;
  }

  private incrementQuota() {
    this.dailyQuotaUsed++;
    console.log(`Google PSE quota used: ${this.dailyQuotaUsed}/${this.maxDailyQuota}`);
  }

  getQuotaStatus() {
    this.loadQuotaFromStorage();
    return {
      used: this.dailyQuotaUsed,
      remaining: this.maxDailyQuota - this.dailyQuotaUsed,
      total: this.maxDailyQuota
    };
  }

  /**
   * Search YouTube using Google PSE (1 quota unit per search)
   */
  async searchYouTube(
    query: string, 
    options: {
      num?: number; // Results per page (max 10)
      start?: number; // Starting index
      type?: 'video' | 'channel' | 'any';
    } = {}
  ): Promise<{ results: ExtractedChannel[]; totalResults: number; error?: string }> {
    if (!this.apiKey || !this.searchEngineId) {
      return { 
        results: [], 
        totalResults: 0, 
        error: 'Google PSE not configured' 
      };
    }

    if (!this.checkQuota()) {
      return {
        results: [],
        totalResults: 0,
        error: `Google PSE daily quota exceeded (${this.dailyQuotaUsed}/${this.maxDailyQuota}). Try again tomorrow.`
      };
    }

    try {
      const url = new URL(this.baseUrl);
      url.searchParams.set('key', this.apiKey);
      url.searchParams.set('cx', this.searchEngineId);
      url.searchParams.set('q', this.formatQuery(query, options.type));
      url.searchParams.set('num', String(options.num || 10));
      
      if (options.start) {
        url.searchParams.set('start', String(options.start));
      }

      const response = await fetch(url.toString());
      
      if (!response.ok) {
        const error = await response.text();
        console.error('Google PSE error:', error);
        throw new Error(`PSE search failed: ${response.status}`);
      }

      const data: PSEResponse = await response.json();
      
      // Increment quota after successful API call
      this.incrementQuota();
      
      // Extract channels from search results
      const channels = this.extractChannelsFromResults(data.items || []);
      
      return {
        results: channels,
        totalResults: parseInt(data.searchInformation?.totalResults || '0')
      };

    } catch (error) {
      console.error('PSE search error:', error);
      return {
        results: [],
        totalResults: 0,
        error: error instanceof Error ? error.message : 'Search failed'
      };
    }
  }

  /**
   * Run multiple searches and aggregate unique channels
   */
  async batchSearchYouTube(
    queries: string[],
    options: {
      type?: 'video' | 'channel' | 'any';
      dedupeChannels?: boolean;
    } = {}
  ): Promise<{ 
    channels: ExtractedChannel[]; 
    totalSearches: number;
    totalResults: number;
    errors: string[];
  }> {
    // Check if we have enough quota for all searches
    const quotaStatus = this.getQuotaStatus();
    if (quotaStatus.remaining < queries.length) {
      return {
        channels: [],
        totalSearches: 0,
        totalResults: 0,
        errors: [`Insufficient Google PSE quota. Need ${queries.length} searches, only ${quotaStatus.remaining} remaining today.`]
      };
    }

    const allChannels: ExtractedChannel[] = [];
    const errors: string[] = [];
    let totalResults = 0;

    // Process queries in parallel (but respect rate limits)
    const BATCH_SIZE = 10;
    
    for (let i = 0; i < queries.length; i += BATCH_SIZE) {
      const batch = queries.slice(i, i + BATCH_SIZE);
      
      const results = await Promise.all(
        batch.map(async (query) => {
          const result = await this.searchYouTube(query, { type: options.type });
          if (result.error) {
            errors.push(`${query}: ${result.error}`);
          }
          return result;
        })
      );

      for (const result of results) {
        allChannels.push(...result.results);
        totalResults += result.totalResults;
      }

      // Small delay between batches to avoid rate limiting
      if (i + BATCH_SIZE < queries.length) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    }

    // Deduplicate channels if requested
    let finalChannels = allChannels;
    if (options.dedupeChannels) {
      const uniqueMap = new Map<string, ExtractedChannel>();
      for (const channel of allChannels) {
        // Use channel URL or name as key since we might not have IDs yet
        const key = channel.channelUrl || channel.channelName;
        if (!uniqueMap.has(key) || 
            channel.confidence === 'high' && uniqueMap.get(key)!.confidence !== 'high') {
          uniqueMap.set(key, channel);
        }
      }
      finalChannels = Array.from(uniqueMap.values());
    }

    return {
      channels: finalChannels,
      totalSearches: queries.length,
      totalResults,
      errors
    };
  }

  /**
   * Format query for YouTube-specific searches
   */
  private formatQuery(query: string, type?: 'video' | 'channel' | 'any'): string {
    // Ensure we're searching YouTube
    let formattedQuery = query;
    
    if (!query.includes('site:youtube.com')) {
      formattedQuery = `${query} site:youtube.com`;
    }

    // Add type-specific filters
    if (type === 'video') {
      formattedQuery += ' inurl:watch';
    } else if (type === 'channel') {
      formattedQuery += ' inurl:channel OR inurl:c OR inurl:user';
    }

    return formattedQuery;
  }

  /**
   * Extract channel information from PSE results
   */
  private extractChannelsFromResults(items: PSESearchResult[]): ExtractedChannel[] {
    const channels: ExtractedChannel[] = [];

    for (const item of items) {
      const extracted = this.extractChannelFromResult(item);
      if (extracted) {
        channels.push(extracted);
      }
    }

    return channels;
  }

  /**
   * Extract channel info from a single search result
   */
  private extractChannelFromResult(item: PSESearchResult): ExtractedChannel | null {
    const url = item.link;
    
    // Video URL pattern: youtube.com/watch?v=VIDEO_ID
    const videoMatch = url.match(/youtube\.com\/watch\?v=([a-zA-Z0-9_-]+)/);
    if (videoMatch) {
      // Try to extract channel info from video result
      const videoId = videoMatch[1];
      
      // Check pagemap for channel info
      const channelId = item.pagemap?.videoobject?.[0]?.channelid;
      let channelName = item.pagemap?.videoobject?.[0]?.author || 
                       item.pagemap?.person?.[0]?.name ||
                       this.extractChannelNameFromSnippet(item.snippet);
      
      let channelUrl = '';
      let channelHandle = '';
      
      // Check for person URL which contains the channel handle
      if (item.pagemap?.person?.[0]?.url) {
        const personUrl = item.pagemap.person[0].url;
        const handleMatch = personUrl.match(/youtube\.com\/@([a-zA-Z0-9_-]+)/);
        if (handleMatch) {
          channelHandle = handleMatch[1];
          channelUrl = `https://youtube.com/@${channelHandle}`;
        }
      }

      // If we have a channel name and handle/URL, that's enough
      if (channelName && (channelHandle || channelId)) {
        return {
          channelId: channelId || '', // Will need to resolve @handles to IDs later
          channelName,
          channelUrl: channelUrl || (channelId ? `https://youtube.com/channel/${channelId}` : ''),
          videoUrl: url,
          videoTitle: item.title,
          confidence: channelId ? 'high' : 'medium',
          source: 'video'
        };
      }
    }

    // Channel URL patterns
    const channelPatterns = [
      /youtube\.com\/channel\/([a-zA-Z0-9_-]+)/,
      /youtube\.com\/c\/([a-zA-Z0-9_-]+)/,
      /youtube\.com\/user\/([a-zA-Z0-9_-]+)/,
      /youtube\.com\/@([a-zA-Z0-9_-]+)/
    ];

    for (const pattern of channelPatterns) {
      const match = url.match(pattern);
      if (match) {
        const channelIdentifier = match[1];
        const isChannelId = channelIdentifier.startsWith('UC') && channelIdentifier.length === 24;
        
        return {
          channelId: isChannelId ? channelIdentifier : '', // Will need to resolve non-ID identifiers
          channelName: item.title.replace(' - YouTube', '').trim(),
          channelUrl: url,
          confidence: isChannelId ? 'high' : 'medium',
          source: 'channel'
        };
      }
    }

    return null;
  }

  /**
   * Extract channel name from snippet text
   */
  private extractChannelNameFromSnippet(snippet: string): string {
    // Common patterns in snippets
    const patterns = [
      /by ([^·•\-]+?)(?:·|•|-|$)/i,
      /^([^·•\-]+?)(?:·|•|-)/,
      /Channel: ([^·•\-]+)/i
    ];

    for (const pattern of patterns) {
      const match = snippet.match(pattern);
      if (match) {
        return match[1].trim();
      }
    }

    return '';
  }

  /**
   * Resolve channel handles (@username) to channel IDs using YouTube API
   * Uses only 1 unit per channel (channels.list)
   */
  async resolveChannelHandles(handles: string[]): Promise<Map<string, string>> {
    const resolvedMap = new Map<string, string>();
    
    if (handles.length === 0) return resolvedMap;
    
    const apiKey = process.env.YOUTUBE_API_KEY;
    if (!apiKey) {
      console.warn('YouTube API key not configured for channel resolution');
      return resolvedMap;
    }
    
    try {
      // YouTube API allows checking up to 50 channels at once
      const BATCH_SIZE = 50;
      
      for (let i = 0; i < handles.length; i += BATCH_SIZE) {
        const batch = handles.slice(i, i + BATCH_SIZE);
        
        // Process each handle individually (forHandle doesn't support multiple)
        for (const handle of batch) {
          const url = new URL('https://www.googleapis.com/youtube/v3/channels');
          url.searchParams.set('key', apiKey);
          url.searchParams.set('part', 'id,snippet');
          url.searchParams.set('forHandle', handle);
          
          const response = await fetch(url.toString());
          
          if (response.ok) {
            const data = await response.json();
            
            // Track quota usage - channels.list costs 1 unit
            await quotaTracker.trackAPICall('channels.list', {
              description: `Resolve handle @${handle} to channel ID`,
              count: 1
            });
            
            // Should only return one channel
            if (data.items && data.items.length > 0) {
              const item = data.items[0];
              resolvedMap.set(handle, item.id);
            }
          }
          
          // Small delay to avoid rate limiting
          await new Promise(resolve => setTimeout(resolve, 50));
        }
      }
    } catch (error) {
      console.error('Error resolving channel handles:', error);
    }
    
    return resolvedMap;
  }

  /**
   * Check if PSE is properly configured
   */
  isConfigured(): boolean {
    return !!(this.apiKey && this.searchEngineId);
  }

  /**
   * Get remaining quota for today (rough estimate)
   */
  async getQuotaStatus(): Promise<{
    available: boolean;
    limit: number;
    used: number;
    remaining: number;
  }> {
    // Google PSE has a hard limit of 100 queries per day for free tier
    // This is a simple estimate - you'd want to track actual usage in your database
    const limit = 100;
    const used = 0; // TODO: Track in database
    
    return {
      available: used < limit,
      limit,
      used,
      remaining: limit - used
    };
  }
}

// Export singleton instance
export const googlePSE = new GooglePSEService();