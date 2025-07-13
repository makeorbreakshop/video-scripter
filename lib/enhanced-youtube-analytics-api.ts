/**
 * Enhanced YouTube Analytics API client for comprehensive data collection
 * Captures all available YouTube Analytics metrics to maximize API quota usage
 */

import { getValidAccessToken, isAuthenticated } from './youtube-oauth.ts';

// Comprehensive types for enhanced analytics data
export interface ComprehensiveAnalyticsData {
  video_id: string;
  date: string;
  
  // View Metrics
  views: number;
  engaged_views?: number;
  red_views?: number;
  viewer_percentage?: number;
  
  // Watch Time Metrics
  estimated_minutes_watched?: number;
  estimated_red_minutes_watched?: number;
  average_view_duration?: number;
  average_view_percentage?: number;
  
  // Engagement Metrics
  likes?: number;
  dislikes?: number;
  comments?: number;
  shares?: number;
  subscribers_gained?: number;
  subscribers_lost?: number;
  
  // Revenue Metrics (requires monetary scope)
  estimated_revenue?: number;
  estimated_ad_revenue?: number;
  estimated_red_partner_revenue?: number;
  gross_revenue?: number;
  cpm?: number;
  
  // Ad Performance Metrics
  ad_impressions?: number;
  monetized_playbacks?: number;
  
  // Interaction Metrics
  card_impressions?: number;
  card_clicks?: number;
  card_click_rate?: number;
  end_screen_element_clicks?: number;
}

export interface GeographicData {
  country_code: string;
  views: number;
  percentage: number;
}

export interface TrafficSourceData {
  source_type: string;
  views: number;
  percentage: number;
}

export interface DeviceData {
  device_type: string;
  views: number;
  percentage: number;
}

export interface DemographicData {
  age_group: string;
  gender: string;
  views: number;
  percentage: number;
}

// Enhanced YouTube Analytics client
export class EnhancedYouTubeAnalyticsClient {
  private baseUrl = 'https://youtubeanalytics.googleapis.com/v2';

  /**
   * Get comprehensive analytics data for a video
   * Fetches all available metrics in optimized API calls
   */
  async getComprehensiveVideoAnalytics(
    videoId: string,
    startDate: string,
    endDate: string,
    accessToken?: string
  ): Promise<{
    dailyMetrics: ComprehensiveAnalyticsData[];
    geographic: GeographicData[];
    trafficSources: TrafficSourceData[];
    devices: DeviceData[];
    demographics: DemographicData[];
  }> {
    const token = await this.getAccessToken(accessToken);
    
    console.log(`🔍 Fetching comprehensive analytics for video ${videoId}`);

    // Execute multiple API calls in parallel for efficiency
    const [
      dailyMetrics,
      geographic,
      trafficSources,
      devices,
      demographics
    ] = await Promise.all([
      this.getDailyVideoMetrics(videoId, startDate, endDate, token),
      this.getGeographicBreakdown(videoId, startDate, endDate, token),
      this.getTrafficSourceBreakdown(videoId, startDate, endDate, token),
      this.getDeviceBreakdown(videoId, startDate, endDate, token),
      this.getDemographicBreakdown(videoId, startDate, endDate, token)
    ]);

    return {
      dailyMetrics,
      geographic,
      trafficSources,
      devices,
      demographics
    };
  }

  /**
   * Get all daily metrics for a video
   */
  private async getDailyVideoMetrics(
    videoId: string,
    startDate: string,
    endDate: string,
    token: string
  ): Promise<ComprehensiveAnalyticsData[]> {
    const url = new URL(`${this.baseUrl}/reports`);
    
    // COMPREHENSIVE YouTube Analytics API metrics (available with OAuth authentication)
    const metrics = [
      // Core view & engagement metrics
      'views',
      'engagedViews',
      'likes', 
      'dislikes',
      'comments',
      'shares',
      'subscribersGained',
      
      // Watch time metrics
      'estimatedMinutesWatched',
      'averageViewDuration', 
      'averageViewPercentage',
      'viewerPercentage',
      
      // Revenue metrics (available with OAuth)
      'estimatedRevenue',
      'estimatedAdRevenue',
      'monetizedPlaybacks',
      'adImpressions',
      
      // Card interaction metrics (available with OAuth)
      'cardImpressions',
      'cardClicks', 
      'cardClickRate'
    ];

    url.searchParams.append('ids', 'channel==MINE');
    url.searchParams.append('startDate', startDate);
    url.searchParams.append('endDate', endDate);
    url.searchParams.append('metrics', metrics.join(','));
    url.searchParams.append('dimensions', 'video,day');
    url.searchParams.append('filters', `video==${videoId}`);
    url.searchParams.append('sort', 'day');

    const response = await fetch(url.toString(), {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      }
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.warn(`⚠️ Some metrics unavailable for video ${videoId}:`, errorText);
      
      // Fallback to basic metrics if comprehensive call fails
      return this.getBasicVideoMetrics(videoId, startDate, endDate, token);
    }

    const data = await response.json();
    return this.transformDailyMetricsResponse(data, videoId);
  }

  /**
   * Fallback to basic metrics if comprehensive call fails
   */
  private async getBasicVideoMetrics(
    videoId: string,
    startDate: string,
    endDate: string,
    token: string
  ): Promise<ComprehensiveAnalyticsData[]> {
    const url = new URL(`${this.baseUrl}/reports`);
    
    // Basic metrics that should always be available
    const basicMetrics = ['views', 'likes', 'comments', 'averageViewPercentage'];

    url.searchParams.append('ids', 'channel==MINE');
    url.searchParams.append('startDate', startDate);
    url.searchParams.append('endDate', endDate);
    url.searchParams.append('metrics', basicMetrics.join(','));
    url.searchParams.append('dimensions', 'video,day');
    url.searchParams.append('filters', `video==${videoId}`);
    url.searchParams.append('sort', 'day');

    const response = await fetch(url.toString(), {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      }
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch basic metrics for video ${videoId}`);
    }

    const data = await response.json();
    return this.transformDailyMetricsResponse(data, videoId);
  }

  /**
   * Get geographic breakdown (top countries)
   */
  private async getGeographicBreakdown(
    videoId: string,
    startDate: string,
    endDate: string,
    token: string
  ): Promise<GeographicData[]> {
    const url = new URL(`${this.baseUrl}/reports`);
    
    url.searchParams.append('ids', 'channel==MINE');
    url.searchParams.append('startDate', startDate);
    url.searchParams.append('endDate', endDate);
    url.searchParams.append('metrics', 'views');
    url.searchParams.append('dimensions', 'video,country');
    url.searchParams.append('filters', `video==${videoId}`);
    url.searchParams.append('sort', '-views');
    url.searchParams.append('maxResults', '10'); // Top 10 countries

    try {
      const response = await fetch(url.toString(), {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      });

      if (!response.ok) {
        console.warn(`⚠️ Geographic data unavailable for video ${videoId}`);
        return [];
      }

      const data = await response.json();
      return this.transformGeographicResponse(data);
    } catch (error) {
      console.warn(`⚠️ Error fetching geographic data for video ${videoId}:`, error);
      return [];
    }
  }

  /**
   * Get traffic source breakdown
   */
  private async getTrafficSourceBreakdown(
    videoId: string,
    startDate: string,
    endDate: string,
    token: string
  ): Promise<TrafficSourceData[]> {
    const url = new URL(`${this.baseUrl}/reports`);
    
    url.searchParams.append('ids', 'channel==MINE');
    url.searchParams.append('startDate', startDate);
    url.searchParams.append('endDate', endDate);
    url.searchParams.append('metrics', 'views');
    url.searchParams.append('dimensions', 'video,insightTrafficSourceType');
    url.searchParams.append('filters', `video==${videoId}`);
    url.searchParams.append('sort', '-views');

    try {
      const response = await fetch(url.toString(), {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      });

      if (!response.ok) {
        console.warn(`⚠️ Traffic source data unavailable for video ${videoId}`);
        return [];
      }

      const data = await response.json();
      return this.transformTrafficSourceResponse(data);
    } catch (error) {
      console.warn(`⚠️ Error fetching traffic source data for video ${videoId}:`, error);
      return [];
    }
  }

  /**
   * Get device breakdown
   */
  private async getDeviceBreakdown(
    videoId: string,
    startDate: string,
    endDate: string,
    token: string
  ): Promise<DeviceData[]> {
    const url = new URL(`${this.baseUrl}/reports`);
    
    url.searchParams.append('ids', 'channel==MINE');
    url.searchParams.append('startDate', startDate);
    url.searchParams.append('endDate', endDate);
    url.searchParams.append('metrics', 'views');
    url.searchParams.append('dimensions', 'video,deviceType');
    url.searchParams.append('filters', `video==${videoId}`);
    url.searchParams.append('sort', '-views');

    try {
      const response = await fetch(url.toString(), {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      });

      if (!response.ok) {
        console.warn(`⚠️ Device data unavailable for video ${videoId}`);
        return [];
      }

      const data = await response.json();
      return this.transformDeviceResponse(data);
    } catch (error) {
      console.warn(`⚠️ Error fetching device data for video ${videoId}:`, error);
      return [];
    }
  }

  /**
   * Get demographic breakdown
   */
  private async getDemographicBreakdown(
    videoId: string,
    startDate: string,
    endDate: string,
    token: string
  ): Promise<DemographicData[]> {
    const url = new URL(`${this.baseUrl}/reports`);
    
    url.searchParams.append('ids', 'channel==MINE');
    url.searchParams.append('startDate', startDate);
    url.searchParams.append('endDate', endDate);
    url.searchParams.append('metrics', 'viewerPercentage');
    url.searchParams.append('dimensions', 'video,ageGroup,gender');
    url.searchParams.append('filters', `video==${videoId}`);
    url.searchParams.append('sort', '-viewerPercentage');

    try {
      const response = await fetch(url.toString(), {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      });

      if (!response.ok) {
        console.warn(`⚠️ Demographic data unavailable for video ${videoId}`);
        return [];
      }

      const data = await response.json();
      return this.transformDemographicResponse(data);
    } catch (error) {
      console.warn(`⚠️ Error fetching demographic data for video ${videoId}:`, error);
      return [];
    }
  }

  /**
   * Transform daily metrics response
   */
  private transformDailyMetricsResponse(data: any, videoId: string): ComprehensiveAnalyticsData[] {
    if (!data.rows || data.rows.length === 0) {
      console.log(`ℹ️ No daily metrics found for video ${videoId}`);
      return [];
    }

    const columnMap = new Map<string, number>();
    data.columnHeaders.forEach((header: any, index: number) => {
      columnMap.set(header.name, index);
    });

    return data.rows.map((row: any[]) => ({
      video_id: videoId,
      date: row[columnMap.get('day') || 1] as string,
      views: Number(row[columnMap.get('views') || 2]) || 0,
      likes: columnMap.has('likes') ? Number(row[columnMap.get('likes')!]) : undefined,
      dislikes: columnMap.has('dislikes') ? Number(row[columnMap.get('dislikes')!]) : undefined,
      comments: columnMap.has('comments') ? Number(row[columnMap.get('comments')!]) : undefined,
      shares: columnMap.has('shares') ? Number(row[columnMap.get('shares')!]) : undefined,
      estimated_minutes_watched: columnMap.has('estimatedMinutesWatched') 
        ? Number(row[columnMap.get('estimatedMinutesWatched')!]) : undefined,
      average_view_duration: columnMap.has('averageViewDuration') 
        ? Number(row[columnMap.get('averageViewDuration')!]) : undefined,
      average_view_percentage: columnMap.has('averageViewPercentage') 
        ? Number(row[columnMap.get('averageViewPercentage')!]) / 100 : undefined,
      // Engagement metrics
      engaged_views: columnMap.has('engagedViews') 
        ? Number(row[columnMap.get('engagedViews')!]) : undefined,
      viewer_percentage: columnMap.has('viewerPercentage') 
        ? Number(row[columnMap.get('viewerPercentage')!]) : undefined,
      subscribers_gained: columnMap.has('subscribersGained') 
        ? Number(row[columnMap.get('subscribersGained')!]) : undefined,
      
      // Revenue & ad metrics (OAuth enabled)
      estimated_revenue: columnMap.has('estimatedRevenue') 
        ? Number(row[columnMap.get('estimatedRevenue')!]) : undefined,
      estimated_ad_revenue: columnMap.has('estimatedAdRevenue') 
        ? Number(row[columnMap.get('estimatedAdRevenue')!]) : undefined,
      ad_impressions: columnMap.has('adImpressions') 
        ? Number(row[columnMap.get('adImpressions')!]) : undefined,
      monetized_playbacks: columnMap.has('monetizedPlaybacks') 
        ? Number(row[columnMap.get('monetizedPlaybacks')!]) : undefined,
      
      // Card interaction metrics (OAuth enabled)
      card_impressions: columnMap.has('cardImpressions') 
        ? Number(row[columnMap.get('cardImpressions')!]) : undefined,
      card_clicks: columnMap.has('cardClicks') 
        ? Number(row[columnMap.get('cardClicks')!]) : undefined,
      card_click_rate: columnMap.has('cardClickRate') 
        ? Number(row[columnMap.get('cardClickRate')!]) : undefined,
    }));
  }

  /**
   * Transform geographic response
   */
  private transformGeographicResponse(data: any): GeographicData[] {
    if (!data.rows || data.rows.length === 0) return [];

    const columnMap = new Map<string, number>();
    data.columnHeaders.forEach((header: any, index: number) => {
      columnMap.set(header.name, index);
    });

    const totalViews = data.rows.reduce((sum: number, row: any[]) => 
      sum + Number(row[columnMap.get('views') || 1]), 0);

    return data.rows.map((row: any[]) => ({
      country_code: row[columnMap.get('country') || 1] as string,
      views: Number(row[columnMap.get('views') || 2]),
      percentage: Number(row[columnMap.get('views') || 2]) / totalViews * 100
    }));
  }

  /**
   * Transform traffic source response
   */
  private transformTrafficSourceResponse(data: any): TrafficSourceData[] {
    if (!data.rows || data.rows.length === 0) return [];

    const columnMap = new Map<string, number>();
    data.columnHeaders.forEach((header: any, index: number) => {
      columnMap.set(header.name, index);
    });

    const totalViews = data.rows.reduce((sum: number, row: any[]) => 
      sum + Number(row[columnMap.get('views') || 2]), 0);

    return data.rows.map((row: any[]) => ({
      source_type: row[columnMap.get('insightTrafficSourceType') || 1] as string,
      views: Number(row[columnMap.get('views') || 2]),
      percentage: Number(row[columnMap.get('views') || 2]) / totalViews * 100
    }));
  }

  /**
   * Transform device response
   */
  private transformDeviceResponse(data: any): DeviceData[] {
    if (!data.rows || data.rows.length === 0) return [];

    const columnMap = new Map<string, number>();
    data.columnHeaders.forEach((header: any, index: number) => {
      columnMap.set(header.name, index);
    });

    const totalViews = data.rows.reduce((sum: number, row: any[]) => 
      sum + Number(row[columnMap.get('views') || 2]), 0);

    return data.rows.map((row: any[]) => ({
      device_type: row[columnMap.get('deviceType') || 1] as string,
      views: Number(row[columnMap.get('views') || 2]),
      percentage: Number(row[columnMap.get('views') || 2]) / totalViews * 100
    }));
  }

  /**
   * Transform demographic response
   */
  private transformDemographicResponse(data: any): DemographicData[] {
    if (!data.rows || data.rows.length === 0) return [];

    const columnMap = new Map<string, number>();
    data.columnHeaders.forEach((header: any, index: number) => {
      columnMap.set(header.name, index);
    });

    return data.rows.map((row: any[]) => ({
      age_group: row[columnMap.get('ageGroup') || 1] as string,
      gender: row[columnMap.get('gender') || 2] as string,
      views: 0, // Not provided in viewerPercentage endpoint
      percentage: Number(row[columnMap.get('viewerPercentage') || 3])
    }));
  }

  /**
   * Get access token with fallback
   */
  private async getAccessToken(providedToken?: string): Promise<string> {
    let token = providedToken;
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

// Export singleton instance
export const enhancedYouTubeAnalyticsClient = new EnhancedYouTubeAnalyticsClient();