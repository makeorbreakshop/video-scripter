/**
 * YouTube Analytics API client for retrieving video performance metrics
 * Requires OAuth with yt-analytics.readonly scope
 */

import { getValidAccessToken, isAuthenticated } from './youtube-oauth';

// Types for YouTube Analytics API responses
export interface AnalyticsDataRow {
  video_id: string;
  date: string;
  views: number;
  ctr?: number;
  retention_avg?: number;
  likes?: number;
  comments?: number;
  revenue_estimate?: number;
}

export interface AnalyticsResponse {
  kind: string;
  columnHeaders: Array<{
    name: string;
    columnType: string;
    dataType: string;
  }>;
  rows: Array<Array<string | number>>;
}

// Comprehensive analytics data type for optimized batch processing
export interface ParsedAnalyticsData {
  video_id: string;
  date: string;
  views: number;
  engaged_views?: number;
  viewer_percentage?: number;
  estimated_minutes_watched: number;
  average_view_duration: number;
  average_view_percentage: number;
  likes?: number;
  dislikes?: number;
  comments?: number;
  shares?: number;
  subscribers_gained?: number;
  subscribers_lost?: number;
  estimated_revenue?: number;
  estimated_ad_revenue?: number;
  cpm?: number;
  ad_impressions?: number;
  monetized_playbacks?: number;
  // Breakdowns (for future enhancement)
  search_views?: number;
  suggested_views?: number;
  external_views?: number;
  direct_views?: number;
  mobile_views?: number;
  desktop_views?: number;
  tablet_views?: number;
  tv_views?: number;
  country_views?: Record<string, number>;
  top_age_groups?: Record<string, number>;
  gender_breakdown?: Record<string, number>;
}

// API client class
export class YouTubeAnalyticsClient {
  private baseUrl = 'https://youtubeanalytics.googleapis.com/v2';

  /**
   * Get analytics data for a single video over a date range
   */
  async getVideoAnalytics(
    videoId: string,
    startDate: string, // YYYY-MM-DD format
    endDate: string,   // YYYY-MM-DD format
    metrics: string[] = ['views', 'likes', 'comments'],
    accessToken?: string
  ): Promise<AnalyticsDataRow[]> {
    // Use provided token or get from OAuth
    let token = accessToken;
    if (!token) {
      if (!isAuthenticated()) {
        throw new Error('Not authenticated with YouTube');
      }
      token = await getValidAccessToken();
      if (!token) {
        throw new Error('Unable to get valid access token');
      }
    }

    const metricsParam = metrics.join(',');
    const url = new URL(`${this.baseUrl}/reports`);
    
    url.searchParams.append('ids', 'channel==MINE');
    url.searchParams.append('startDate', startDate);
    url.searchParams.append('endDate', endDate);
    url.searchParams.append('metrics', metricsParam);
    url.searchParams.append('dimensions', 'video,day');
    url.searchParams.append('filters', `video==${videoId}`);
    url.searchParams.append('sort', 'day');

    console.log(`🔍 Fetching analytics for video ${videoId} from ${startDate} to ${endDate}`);

    const response = await fetch(url.toString(), {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      }
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`❌ Analytics API error for video ${videoId}:`, errorText);
      throw new Error(`YouTube Analytics API error: ${response.status} ${errorText}`);
    }

    const data: AnalyticsResponse = await response.json();
    return this.transformAnalyticsResponse(data, videoId);
  }

  /**
   * Get analytics data for multiple videos (batch processing)
   */
  async getBatchVideoAnalytics(
    videoIds: string[],
    startDate: string,
    endDate: string,
    batchSize: number = 10
  ): Promise<AnalyticsDataRow[]> {
    const results: AnalyticsDataRow[] = [];
    
    // Process videos in batches to respect API quotas
    for (let i = 0; i < videoIds.length; i += batchSize) {
      const batch = videoIds.slice(i, i + batchSize);
      console.log(`📦 Processing batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(videoIds.length / batchSize)}: ${batch.length} videos`);
      
      const batchPromises = batch.map(async (videoId) => {
        try {
          const analytics = await this.getVideoAnalytics(videoId, startDate, endDate);
          return analytics;
        } catch (error) {
          console.error(`❌ Failed to get analytics for video ${videoId}:`, error);
          return [];
        }
      });

      const batchResults = await Promise.all(batchPromises);
      results.push(...batchResults.flat());
      
      // Add delay between batches to respect rate limits
      if (i + batchSize < videoIds.length) {
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }

    return results;
  }

  /**
   * Get CTR (Click-Through Rate) data for videos
   */
  async getVideoCTRData(
    videoIds: string[],
    startDate: string,
    endDate: string,
    accessToken?: string
  ): Promise<AnalyticsDataRow[]> {
    // Use provided token or get from OAuth
    let token = accessToken;
    if (!token) {
      if (!isAuthenticated()) {
        throw new Error('Not authenticated with YouTube');
      }
      token = await getValidAccessToken();
      if (!token) {
        throw new Error('Unable to get valid access token');
      }
    }

    const videoFilter = videoIds.map(id => `video==${id}`).join(',');
    const url = new URL(`${this.baseUrl}/reports`);
    
    url.searchParams.append('ids', 'channel==MINE');
    url.searchParams.append('startDate', startDate);
    url.searchParams.append('endDate', endDate);
    url.searchParams.append('metrics', 'views,cardImpressions,cardClickRate');
    url.searchParams.append('dimensions', 'video,day');
    url.searchParams.append('filters', videoFilter);
    url.searchParams.append('sort', 'day');

    console.log(`🎯 Fetching CTR data for ${videoIds.length} videos`);

    const response = await fetch(url.toString(), {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      }
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`❌ CTR Analytics API error:`, errorText);
      throw new Error(`YouTube Analytics API error: ${response.status} ${errorText}`);
    }

    const data: AnalyticsResponse = await response.json();
    return this.transformCTRResponse(data);
  }

  /**
   * Get retention data for videos
   */
  async getVideoRetentionData(
    videoIds: string[],
    startDate: string,
    endDate: string,
    accessToken?: string
  ): Promise<AnalyticsDataRow[]> {
    // Use provided token or get from OAuth
    let token = accessToken;
    if (!token) {
      if (!isAuthenticated()) {
        throw new Error('Not authenticated with YouTube');
      }
      token = await getValidAccessToken();
      if (!token) {
        throw new Error('Unable to get valid access token');
      }
    }

    const videoFilter = videoIds.map(id => `video==${id}`).join(',');
    const url = new URL(`${this.baseUrl}/reports`);
    
    url.searchParams.append('ids', 'channel==MINE');
    url.searchParams.append('startDate', startDate);
    url.searchParams.append('endDate', endDate);
    url.searchParams.append('metrics', 'averageViewDuration,averageViewPercentage');
    url.searchParams.append('dimensions', 'video,day');
    url.searchParams.append('filters', videoFilter);
    url.searchParams.append('sort', 'day');

    console.log(`⏱️ Fetching retention data for ${videoIds.length} videos`);

    const response = await fetch(url.toString(), {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      }
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`❌ Retention Analytics API error:`, errorText);
      throw new Error(`YouTube Analytics API error: ${response.status} ${errorText}`);
    }

    const data: AnalyticsResponse = await response.json();
    return this.transformRetentionResponse(data);
  }

  /**
   * Transform the YouTube Analytics API response into our data format
   */
  private transformAnalyticsResponse(data: AnalyticsResponse, videoId: string): AnalyticsDataRow[] {
    if (!data.rows || data.rows.length === 0) {
      console.log(`ℹ️ No analytics data found for video ${videoId}`);
      return [];
    }

    const columnMap = new Map<string, number>();
    data.columnHeaders.forEach((header, index) => {
      columnMap.set(header.name, index);
    });

    return data.rows.map(row => ({
      video_id: videoId,
      date: row[columnMap.get('day') || 1] as string,
      views: Number(row[columnMap.get('views') || 2]),
      likes: columnMap.has('likes') ? Number(row[columnMap.get('likes')!]) : undefined,
      comments: columnMap.has('comments') ? Number(row[columnMap.get('comments')!]) : undefined,
    }));
  }

  /**
   * Transform CTR response data
   */
  private transformCTRResponse(data: AnalyticsResponse): AnalyticsDataRow[] {
    if (!data.rows || data.rows.length === 0) {
      return [];
    }

    const columnMap = new Map<string, number>();
    data.columnHeaders.forEach((header, index) => {
      columnMap.set(header.name, index);
    });

    return data.rows.map(row => ({
      video_id: row[columnMap.get('video') || 0] as string,
      date: row[columnMap.get('day') || 1] as string,
      views: Number(row[columnMap.get('views') || 2]),
      ctr: columnMap.has('cardClickRate') 
        ? Number(row[columnMap.get('cardClickRate')!]) 
        : undefined,
    }));
  }

  /**
   * Transform retention response data
   */
  private transformRetentionResponse(data: AnalyticsResponse): AnalyticsDataRow[] {
    if (!data.rows || data.rows.length === 0) {
      return [];
    }

    const columnMap = new Map<string, number>();
    data.columnHeaders.forEach((header, index) => {
      columnMap.set(header.name, index);
    });

    return data.rows.map(row => ({
      video_id: row[columnMap.get('video') || 0] as string,
      date: row[columnMap.get('day') || 1] as string,
      views: 0, // Not included in retention endpoint
      retention_avg: columnMap.has('averageViewPercentage') 
        ? Number(row[columnMap.get('averageViewPercentage')!]) / 100 // Convert percentage to decimal
        : undefined,
    }));
  }

  /**
   * OPTIMIZED: Get historical analytics data for specific videos
   * Uses efficient batch processing with proper rate limiting
   * Based on working single video call pattern
   */
  async getHistoricalAnalyticsBatch(
    startDate: string,
    endDate: string,
    videoIds: string[],
    accessToken?: string
  ): Promise<ParsedAnalyticsData[]> {
    // Use provided token or get from OAuth
    let token = accessToken;
    if (!token) {
      if (!isAuthenticated()) {
        throw new Error('Not authenticated with YouTube');
      }
      token = await getValidAccessToken();
      if (!token) {
        throw new Error('Unable to get valid access token');
      }
    }

    console.log(`🚀 Starting Analytics API backfill: ${startDate} to ${endDate}`);
    console.log(`📊 Processing ${videoIds.length} videos with controlled batching`);

    // Core metrics that work reliably
    const coreMetrics = [
      'views',
      'estimatedMinutesWatched',
      'averageViewDuration', 
      'averageViewPercentage',
      'likes',
      'comments'
    ];

    const allResults: ParsedAnalyticsData[] = [];
    const batchSize = 5; // Conservative batch size to avoid rate limits
    let quotaUsed = 0;

    // Process videos in small batches with delays
    for (let i = 0; i < videoIds.length; i += batchSize) {
      const batch = videoIds.slice(i, i + batchSize);
      console.log(`📦 Processing batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(videoIds.length / batchSize)}: ${batch.length} videos`);
      
      // Process batch in parallel
      const batchPromises = batch.map(async (videoId) => {
        try {
          // Use the working single video call pattern
          const analytics = await this.getVideoAnalytics(videoId, startDate, endDate, coreMetrics, token);
          quotaUsed++;
          
          // Convert to ParsedAnalyticsData format
          return analytics.map(record => ({
            video_id: record.video_id,
            date: record.date,
            views: record.views,
            estimated_minutes_watched: 0, // Not available in basic call
            average_view_duration: 0, // Not available in basic call
            average_view_percentage: 0, // Not available in basic call
            likes: record.likes,
            comments: record.comments
          }));
        } catch (error) {
          console.error(`❌ Failed to get analytics for video ${videoId}:`, error);
          return [];
        }
      });

      const batchResults = await Promise.all(batchPromises);
      allResults.push(...batchResults.flat());
      
      console.log(`✅ Batch complete: ${batchResults.flat().length} records`);
      
      // Rate limiting between batches
      if (i + batchSize < videoIds.length) {
        console.log(`⏱️ Rate limiting: waiting 2 seconds...`);
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
    }

    console.log(`🎉 Analytics backfill complete: ${allResults.length} records`);
    console.log(`💰 Quota used: ${quotaUsed} units`);
    
    return allResults;
  }

  /**
   * Parse optimized Analytics API response with comprehensive metrics
   */
  private parseOptimizedAnalyticsResponse(data: AnalyticsResponse): ParsedAnalyticsData[] {
    if (!data.rows || data.rows.length === 0) {
      return [];
    }

    const columnMap = new Map<string, number>();
    data.columnHeaders.forEach((header, index) => {
      columnMap.set(header.name, index);
    });

    return data.rows.map(row => {
      const record: ParsedAnalyticsData = {
        video_id: row[columnMap.get('video') || 0] as string,
        date: row[columnMap.get('day') || 1] as string,
        views: Number(row[columnMap.get('views') || 0]) || 0,
        estimated_minutes_watched: Number(row[columnMap.get('estimatedMinutesWatched') || 0]) || 0,
        average_view_duration: Number(row[columnMap.get('averageViewDuration') || 0]) || 0,
        average_view_percentage: Number(row[columnMap.get('averageViewPercentage') || 0]) || 0
      };

      // Map additional metrics if available
      if (columnMap.has('engagedViews')) {
        record.engaged_views = Number(row[columnMap.get('engagedViews')!]) || 0;
      }
      if (columnMap.has('likes')) {
        record.likes = Number(row[columnMap.get('likes')!]) || 0;
      }
      if (columnMap.has('dislikes')) {
        record.dislikes = Number(row[columnMap.get('dislikes')!]) || 0;
      }
      if (columnMap.has('comments')) {
        record.comments = Number(row[columnMap.get('comments')!]) || 0;
      }
      if (columnMap.has('shares')) {
        record.shares = Number(row[columnMap.get('shares')!]) || 0;
      }
      if (columnMap.has('subscribersGained')) {
        record.subscribers_gained = Number(row[columnMap.get('subscribersGained')!]) || 0;
      }
      if (columnMap.has('subscribersLost')) {
        record.subscribers_lost = Number(row[columnMap.get('subscribersLost')!]) || 0;
      }
      if (columnMap.has('estimatedRevenue')) {
        record.estimated_revenue = Number(row[columnMap.get('estimatedRevenue')!]) || 0;
      }
      if (columnMap.has('estimatedAdRevenue')) {
        record.estimated_ad_revenue = Number(row[columnMap.get('estimatedAdRevenue')!]) || 0;
      }
      if (columnMap.has('cpm')) {
        record.cpm = Number(row[columnMap.get('cpm')!]) || 0;
      }
      if (columnMap.has('adImpressions')) {
        record.ad_impressions = Number(row[columnMap.get('adImpressions')!]) || 0;
      }
      if (columnMap.has('monetizedPlaybacks')) {
        record.monetized_playbacks = Number(row[columnMap.get('monetizedPlaybacks')!]) || 0;
      }

      return record;
    });
  }

  /**
   * Utility: Chunk array into smaller arrays
   */
  private chunkArray<T>(array: T[], chunkSize: number): T[][] {
    const chunks: T[][] = [];
    for (let i = 0; i < array.length; i += chunkSize) {
      chunks.push(array.slice(i, i + chunkSize));
    }
    return chunks;
  }

  /**
   * Token refresh capability (if config available)
   */
  private config?: { refreshToken: string };
  
  setRefreshConfig(refreshToken: string) {
    this.config = { refreshToken };
  }

  private async refreshAccessToken(): Promise<string | null> {
    try {
      const clientId = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID;
      const clientSecret = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_SECRET;
      
      if (!clientId || !clientSecret || !this.config?.refreshToken) {
        console.error('Missing OAuth credentials for token refresh');
        return null;
      }
      
      const response = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
          client_id: clientId,
          client_secret: clientSecret,
          refresh_token: this.config.refreshToken,
          grant_type: 'refresh_token',
        }).toString(),
      });
      
      if (!response.ok) {
        const errorData = await response.json();
        console.error('Failed to refresh token:', errorData);
        return null;
      }
      
      const data = await response.json();
      console.log('🔄 Successfully refreshed access token');
      return data.access_token;
      
    } catch (error) {
      console.error('Error refreshing token:', error);
      return null;
    }
  }

  /**
   * Get channel overview analytics for the last 30 days
   */
  async getChannelOverview(accessToken?: string): Promise<{
    totalViews: number;
    totalLikes: number;
    totalComments: number;
    averageCTR?: number;
    averageRetention?: number;
  }> {
    const endDate = new Date().toISOString().split('T')[0];
    const startDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

    // Use provided token or get from OAuth
    let token = accessToken;
    if (!token) {
      if (!isAuthenticated()) {
        throw new Error('Not authenticated with YouTube');
      }
      token = await getValidAccessToken();
      if (!token) {
        throw new Error('Unable to get valid access token');
      }
    }

    const url = new URL(`${this.baseUrl}/reports`);
    url.searchParams.append('ids', 'channel==MINE');
    url.searchParams.append('startDate', startDate);
    url.searchParams.append('endDate', endDate);
    url.searchParams.append('metrics', 'views,likes,comments,cardClickRate,averageViewPercentage');

    console.log(`📊 Fetching channel overview for last 30 days`);

    const response = await fetch(url.toString(), {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      }
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`❌ Channel overview API error:`, errorText);
      throw new Error(`YouTube Analytics API error: ${response.status} ${errorText}`);
    }

    const data: AnalyticsResponse = await response.json();
    
    if (!data.rows || data.rows.length === 0) {
      return {
        totalViews: 0,
        totalLikes: 0,
        totalComments: 0
      };
    }

    const row = data.rows[0];
    const columnMap = new Map<string, number>();
    data.columnHeaders.forEach((header, index) => {
      columnMap.set(header.name, index);
    });

    return {
      totalViews: Number(row[columnMap.get('views') || 0]),
      totalLikes: Number(row[columnMap.get('likes') || 1]),
      totalComments: Number(row[columnMap.get('comments') || 2]),
      averageCTR: columnMap.has('cardClickRate') 
        ? Number(row[columnMap.get('cardClickRate')!])
        : undefined,
      averageRetention: columnMap.has('averageViewPercentage') 
        ? Number(row[columnMap.get('averageViewPercentage')!]) / 100
        : undefined,
    };
  }
}

// Export singleton instance
export const youtubeAnalyticsClient = new YouTubeAnalyticsClient();