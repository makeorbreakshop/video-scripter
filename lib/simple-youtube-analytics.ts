/**
 * Simple YouTube Analytics API client for basic data collection
 * Designed for immediate results with future expansion capability
 */

import { getValidAccessToken, isAuthenticated } from './youtube-oauth';

// Basic analytics data structure (expandable)
export interface BasicAnalyticsData {
  video_id: string;
  date: string;
  views: number;
  likes?: number;
  comments?: number;
  shares?: number;
  subscribers_gained?: number;
  estimated_minutes_watched?: number;
  average_view_duration?: number;
  average_view_percentage?: number;
  
  // Future expansion fields (will be null initially)
  card_click_rate?: number;
  estimated_revenue?: number;
  country_views?: Record<string, number>;
  device_breakdown?: Record<string, number>;
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

export class SimpleYouTubeAnalytics {
  private baseUrl = 'https://youtubeanalytics.googleapis.com/v2';

  /**
   * Get basic analytics for ALL videos in one API call
   * Most efficient approach for bulk data collection
   */
  async getAllVideosBasicAnalytics(
    startDate: string, // YYYY-MM-DD
    endDate: string,   // YYYY-MM-DD
    accessToken?: string
  ): Promise<BasicAnalyticsData[]> {
    const token = await this.getToken(accessToken);
    
    // Get per-video data for the date range
    // This returns aggregated data per video for the entire date range
    const url = new URL(`${this.baseUrl}/reports`);
    url.searchParams.append('ids', 'channel==MINE');
    url.searchParams.append('startDate', startDate);
    url.searchParams.append('endDate', endDate);
    url.searchParams.append('metrics', 'views,estimatedMinutesWatched,averageViewDuration');
    url.searchParams.append('dimensions', 'video');
    url.searchParams.append('maxResults', '500'); // Get all videos
    url.searchParams.append('sort', '-views'); // Sort by views descending

    console.log(`📊 Fetching per-video analytics from ${startDate} to ${endDate}`);
    console.log(`📊 Query: ${url.toString()}`);

    const response = await fetch(url.toString(), {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      }
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`❌ Analytics API error:`, errorText);
      
      // Fallback to day dimension if video dimension fails
      console.log(`⚠️ Falling back to day-based analytics...`);
      return this.getFallbackDayAnalytics(startDate, endDate, token);
    }

    const data: AnalyticsResponse = await response.json();
    return this.transformVideoResponse(data, startDate, endDate);
  }

  /**
   * Fallback method using day dimension (channel totals)
   */
  private async getFallbackDayAnalytics(
    startDate: string,
    endDate: string,
    token: string
  ): Promise<BasicAnalyticsData[]> {
    const url = new URL(`${this.baseUrl}/reports`);
    url.searchParams.append('ids', 'channel==MINE');
    url.searchParams.append('startDate', startDate);
    url.searchParams.append('endDate', endDate);
    url.searchParams.append('metrics', 'views');
    url.searchParams.append('dimensions', 'day');

    const response = await fetch(url.toString(), {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      }
    });

    if (!response.ok) {
      throw new Error(`YouTube Analytics API error: ${response.status}`);
    }

    const data: AnalyticsResponse = await response.json();
    return this.transformDayResponse(data);
  }

  /**
   * Get analytics for last N days (convenience method)
   */
  async getRecentAnalytics(days: number = 30, accessToken?: string): Promise<BasicAnalyticsData[]> {
    const endDate = new Date().toISOString().split('T')[0];
    const startDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    
    return this.getAllVideosBasicAnalytics(startDate, endDate, accessToken);
  }

  /**
   * Get channel summary for dashboard cards
   */
  async getChannelSummary(days: number = 30, accessToken?: string): Promise<{
    totalViews: number;
    totalLikes: number;
    totalComments: number;
    totalVideos: number;
    avgViewDuration: number;
    avgViewPercentage: number;
  }> {
    const data = await this.getRecentAnalytics(days, accessToken);
    
    // Group by video and sum metrics
    const videoStats = new Map<string, BasicAnalyticsData[]>();
    data.forEach(row => {
      if (!videoStats.has(row.video_id)) {
        videoStats.set(row.video_id, []);
      }
      videoStats.get(row.video_id)!.push(row);
    });

    // Calculate totals
    let totalViews = 0;
    let totalLikes = 0;
    let totalComments = 0;
    let totalWatchTime = 0;
    let totalViewPercentage = 0;
    let recordCount = 0;

    data.forEach(row => {
      totalViews += row.views;
      totalLikes += row.likes || 0;
      totalComments += row.comments || 0;
      totalWatchTime += row.average_view_duration || 0;
      totalViewPercentage += row.average_view_percentage || 0;
      recordCount++;
    });

    return {
      totalViews,
      totalLikes,
      totalComments,
      totalVideos: videoStats.size,
      avgViewDuration: recordCount > 0 ? totalWatchTime / recordCount : 0,
      avgViewPercentage: recordCount > 0 ? totalViewPercentage / recordCount : 0
    };
  }

  /**
   * Transform video-based response to our data format
   */
  private transformVideoResponse(
    data: AnalyticsResponse, 
    startDate: string,
    endDate: string
  ): BasicAnalyticsData[] {
    if (!data.rows || data.rows.length === 0) {
      console.log(`ℹ️ No video analytics data found`);
      return [];
    }

    // Create column mapping
    const columnMap = new Map<string, number>();
    data.columnHeaders.forEach((header, index) => {
      columnMap.set(header.name, index);
    });

    console.log(`✅ Processing ${data.rows.length} video analytics records`);

    // For video dimension with date range, we get aggregated data per video
    // We'll store this as the end date's data (aggregate for the period)
    return data.rows.map(row => {
      const result: BasicAnalyticsData = {
        video_id: row[columnMap.get('video') || 0] as string,
        date: endDate, // Aggregate data stored as end date
        views: Number(row[columnMap.get('views') || 0] || 0),
        estimated_minutes_watched: Number(row[columnMap.get('estimatedMinutesWatched') || 0] || 0),
        average_view_duration: Number(row[columnMap.get('averageViewDuration') || 0] || 0),
      };

      return result;
    });
  }

  /**
   * Transform day-based response to our data format
   */
  private transformDayResponse(data: AnalyticsResponse): BasicAnalyticsData[] {
    if (!data.rows || data.rows.length === 0) {
      console.log(`ℹ️ No analytics data found`);
      return [];
    }

    // Create column mapping
    const columnMap = new Map<string, number>();
    data.columnHeaders.forEach((header, index) => {
      columnMap.set(header.name, index);
    });

    console.log(`✅ Processing ${data.rows.length} daily analytics records`);

    // For day dimension, we get one row per day with total views for that day
    return data.rows.map(row => {
      const result: BasicAnalyticsData = {
        video_id: 'CHANNEL_TOTAL', // Since this is channel-level data by day
        date: row[columnMap.get('day') || 0] as string,
        views: Number(row[columnMap.get('views') || 1] || 0),
      };

      return result;
    });
  }

  /**
   * Transform API response to our data format
   */
  private transformBasicResponse(data: AnalyticsResponse, endDate: string): BasicAnalyticsData[] {
    if (!data.rows || data.rows.length === 0) {
      console.log(`ℹ️ No analytics data found`);
      return [];
    }

    // Create column mapping
    const columnMap = new Map<string, number>();
    data.columnHeaders.forEach((header, index) => {
      columnMap.set(header.name, index);
    });

    console.log(`✅ Processing ${data.rows.length} analytics records`);

    return data.rows.map(row => {
      const result: BasicAnalyticsData = {
        video_id: row[columnMap.get('video') || 0] as string,
        date: endDate, // Use the end date since we're getting aggregate data for the period
        views: Number(row[columnMap.get('views') || 1] || 0),
      };

      // Add optional metrics if available
      if (columnMap.has('likes')) {
        result.likes = Number(row[columnMap.get('likes')!] || 0);
      }
      if (columnMap.has('comments')) {
        result.comments = Number(row[columnMap.get('comments')!] || 0);
      }
      if (columnMap.has('shares')) {
        result.shares = Number(row[columnMap.get('shares')!] || 0);
      }
      if (columnMap.has('subscribersGained')) {
        result.subscribers_gained = Number(row[columnMap.get('subscribersGained')!] || 0);
      }
      if (columnMap.has('estimatedMinutesWatched')) {
        result.estimated_minutes_watched = Number(row[columnMap.get('estimatedMinutesWatched')!] || 0);
      }
      if (columnMap.has('averageViewDuration')) {
        result.average_view_duration = Number(row[columnMap.get('averageViewDuration')!] || 0);
      }
      if (columnMap.has('averageViewPercentage')) {
        result.average_view_percentage = Number(row[columnMap.get('averageViewPercentage')!] || 0);
      }

      return result;
    });
  }

  /**
   * Helper to get access token
   */
  private async getToken(accessToken?: string): Promise<string> {
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
    return token;
  }
}

// Export singleton
export const simpleYouTubeAnalytics = new SimpleYouTubeAnalytics();