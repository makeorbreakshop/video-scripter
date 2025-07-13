/**
 * Analytics data processing service
 * Handles transformation and database operations for YouTube Analytics data
 */

import { createClient } from '@supabase/supabase-js';
import type { AnalyticsDataRow } from './youtube-analytics-api.ts';
import { youtubeAnalyticsClient } from './youtube-analytics-api.ts';
import type { ComprehensiveAnalyticsData } from './enhanced-youtube-analytics-api.ts';
import { enhancedYouTubeAnalyticsClient } from './enhanced-youtube-analytics-api.ts';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const supabase = createClient(supabaseUrl, supabaseKey);

// Types for database operations - enhanced to match comprehensive schema
export interface DailyAnalyticsRecord {
  video_id: string;
  date: string;
  views: number;
  
  // Enhanced metrics from comprehensive collection
  engaged_views?: number;
  red_views?: number;
  viewer_percentage?: number;
  estimated_minutes_watched?: number;
  estimated_red_minutes_watched?: number;
  average_view_duration?: number;
  average_view_percentage?: number;
  likes?: number;
  dislikes?: number;
  comments?: number;
  shares?: number;
  subscribers_gained?: number;
  subscribers_lost?: number;
  estimated_revenue?: number;
  estimated_ad_revenue?: number;
  estimated_red_partner_revenue?: number;
  gross_revenue?: number;
  cpm?: number;
  ad_impressions?: number;
  monetized_playbacks?: number;
  card_impressions?: number;
  card_clicks?: number;
  card_click_rate?: number;
  end_screen_element_clicks?: number;
  
  // JSONB fields for geographic and demographic data
  country_views?: Record<string, number>;
  top_age_groups?: Record<string, number>;
  gender_breakdown?: Record<string, number>;
  
  // Device breakdown
  mobile_views?: number;
  desktop_views?: number;
  tablet_views?: number;
  tv_views?: number;
  
  // Traffic source breakdown
  search_views?: number;
  suggested_views?: number;
  external_views?: number;
  direct_views?: number;
  playlist_views?: number;
}

export interface ProcessingResult {
  success: boolean;
  processed: number;
  errors: string[];
  videoIds: string[];
}

export interface BackfillProgress {
  total: number;
  processed: number;
  currentVideo: string;
  errors: string[];
}

export class AnalyticsProcessor {
  /**
   * Process and store comprehensive analytics data for a single video
   * Uses enhanced API client to maximize data collection
   */
  async processVideoAnalyticsComprehensive(
    videoId: string,
    startDate: string,
    endDate: string,
    userId: string,
    accessToken?: string
  ): Promise<ProcessingResult> {
    const errors: string[] = [];
    let processed = 0;

    try {
      console.log(`🔄 Processing comprehensive analytics for video: ${videoId}`);

      // Get comprehensive analytics data
      const comprehensiveData = await enhancedYouTubeAnalyticsClient.getComprehensiveVideoAnalytics(
        videoId,
        startDate,
        endDate,
        accessToken
      );

      // Transform and combine all data
      const combinedRecords = this.transformComprehensiveData(
        comprehensiveData.dailyMetrics,
        comprehensiveData.geographic,
        comprehensiveData.trafficSources,
        comprehensiveData.devices,
        comprehensiveData.demographics
      );

      // Store in database
      if (combinedRecords.length > 0) {
        await this.storeDailyAnalytics(combinedRecords, userId);
        processed = combinedRecords.length;
        console.log(`✅ Processed ${processed} comprehensive daily records for video ${videoId}`);
      } else {
        console.log(`ℹ️ No comprehensive analytics data found for video ${videoId}`);
      }

      return {
        success: true,
        processed,
        errors,
        videoIds: [videoId]
      };

    } catch (error) {
      const errorMsg = `Failed to process comprehensive video ${videoId}: ${error}`;
      console.error(`❌ ${errorMsg}`);
      errors.push(errorMsg);
      
      // Fallback to basic processing
      return this.processVideoAnalytics(videoId, startDate, endDate, userId, accessToken);
    }
  }

  /**
   * Process and store analytics data for a single video (basic version)
   */
  async processVideoAnalytics(
    videoId: string,
    startDate: string,
    endDate: string,
    userId: string,
    accessToken?: string
  ): Promise<ProcessingResult> {
    const errors: string[] = [];
    let processed = 0;

    try {
      console.log(`🔄 Processing analytics for video: ${videoId}`);

      // Get analytics data from YouTube API
      const analyticsData = await youtubeAnalyticsClient.getVideoAnalytics(
        videoId, 
        startDate, 
        endDate,
        ['views', 'likes', 'comments'],
        accessToken
      );

      // Get CTR data
      let ctrData: AnalyticsDataRow[] = [];
      try {
        ctrData = await youtubeAnalyticsClient.getVideoCTRData([videoId], startDate, endDate, accessToken);
      } catch (error) {
        console.warn(`⚠️ Could not get CTR data for ${videoId}:`, error);
        errors.push(`CTR data unavailable for ${videoId}`);
      }

      // Get retention data
      let retentionData: AnalyticsDataRow[] = [];
      try {
        retentionData = await youtubeAnalyticsClient.getVideoRetentionData([videoId], startDate, endDate, accessToken);
      } catch (error) {
        console.warn(`⚠️ Could not get retention data for ${videoId}:`, error);
        errors.push(`Retention data unavailable for ${videoId}`);
      }

      // Combine data by date
      const combinedData = this.combineAnalyticsData(analyticsData, ctrData, retentionData);

      // Store in database
      if (combinedData.length > 0) {
        await this.storeDailyAnalytics(combinedData, userId);
        processed = combinedData.length;
        console.log(`✅ Processed ${processed} daily records for video ${videoId}`);
      } else {
        console.log(`ℹ️ No analytics data found for video ${videoId}`);
      }

      return {
        success: true,
        processed,
        errors,
        videoIds: [videoId]
      };

    } catch (error) {
      const errorMsg = `Failed to process video ${videoId}: ${error}`;
      console.error(`❌ ${errorMsg}`);
      errors.push(errorMsg);
      
      return {
        success: false,
        processed: 0,
        errors,
        videoIds: [videoId]
      };
    }
  }

  /**
   * Process analytics for multiple videos with progress tracking
   */
  async processMultipleVideos(
    videoIds: string[],
    startDate: string,
    endDate: string,
    userId: string,
    progressCallback?: (progress: BackfillProgress) => void
  ): Promise<ProcessingResult> {
    const allErrors: string[] = [];
    let totalProcessed = 0;

    console.log(`🚀 Starting batch processing for ${videoIds.length} videos`);

    for (let i = 0; i < videoIds.length; i++) {
      const videoId = videoIds[i];
      
      // Update progress
      if (progressCallback) {
        progressCallback({
          total: videoIds.length,
          processed: i,
          currentVideo: videoId,
          errors: allErrors
        });
      }

      try {
        const result = await this.processVideoAnalytics(videoId, startDate, endDate, userId, undefined);
        totalProcessed += result.processed;
        allErrors.push(...result.errors);

        // Rate limiting: wait between requests
        await new Promise(resolve => setTimeout(resolve, 500));

      } catch (error) {
        const errorMsg = `Batch processing error for video ${videoId}: ${error}`;
        console.error(`❌ ${errorMsg}`);
        allErrors.push(errorMsg);
      }
    }

    // Final progress update
    if (progressCallback) {
      progressCallback({
        total: videoIds.length,
        processed: videoIds.length,
        currentVideo: '',
        errors: allErrors
      });
    }

    console.log(`🏁 Batch processing complete: ${totalProcessed} records processed, ${allErrors.length} errors`);

    return {
      success: allErrors.length < videoIds.length, // Success if at least some videos processed
      processed: totalProcessed,
      errors: allErrors,
      videoIds
    };
  }

  /**
   * Get existing "Make or Break Shop" videos from database
   */
  async getMakeOrBreakShopVideos(): Promise<string[]> {
    try {
      // Query for videos from Make or Break Shop channel
      // We'll look for the channel ID or channel name in the database
      const { data, error } = await supabase
        .from('videos')
        .select('id, title, channel_id')
        .order('published_at', { ascending: false });

      if (error) {
        console.error('❌ Error fetching videos:', error);
        throw error;
      }

      // Filter for Make or Break Shop videos
      // The channel should be identifiable by title patterns or channel_id
      const makeOrBreakVideos = data.filter(video => 
        video.title && (
          video.title.toLowerCase().includes('make or break') ||
          // Add other filtering criteria as needed
          video.channel_id === 'UCYour_Channel_ID_Here' // Replace with actual channel ID
        )
      );

      console.log(`📹 Found ${makeOrBreakVideos.length} Make or Break Shop videos in database`);
      return makeOrBreakVideos.map(video => video.id);

    } catch (error) {
      console.error('❌ Error fetching Make or Break Shop videos:', error);
      throw error;
    }
  }

  /**
   * Run historical backfill for existing videos
   */
  async runHistoricalBackfill(
    userId: string,
    daysBack: number = 90,
    progressCallback?: (progress: BackfillProgress) => void
  ): Promise<ProcessingResult> {
    const endDate = new Date().toISOString().split('T')[0];
    const startDate = new Date(Date.now() - daysBack * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

    console.log(`📅 Starting historical backfill from ${startDate} to ${endDate}`);

    try {
      // Get all Make or Break Shop videos
      const videoIds = await this.getMakeOrBreakShopVideos();
      
      if (videoIds.length === 0) {
        console.log('ℹ️ No Make or Break Shop videos found for backfill');
        return {
          success: true,
          processed: 0,
          errors: ['No videos found for backfill'],
          videoIds: []
        };
      }

      // Process all videos
      return await this.processMultipleVideos(
        videoIds,
        startDate,
        endDate,
        userId,
        progressCallback
      );

    } catch (error) {
      console.error('❌ Historical backfill failed:', error);
      throw error;
    }
  }

  /**
   * Transform comprehensive analytics data into database records
   */
  private transformComprehensiveData(
    dailyMetrics: ComprehensiveAnalyticsData[],
    geographic: any[],
    trafficSources: any[],
    devices: any[],
    demographics: any[]
  ): DailyAnalyticsRecord[] {
    // Convert geographic data to country_views object
    const countryViews = geographic.reduce((acc, item) => {
      acc[item.country_code] = item.views;
      return acc;
    }, {} as Record<string, number>);

    // Convert demographics to age groups and gender breakdown
    const ageGroups = demographics
      .filter(d => d.age_group)
      .reduce((acc, item) => {
        acc[item.age_group] = item.percentage;
        return acc;
      }, {} as Record<string, number>);

    const genderBreakdown = demographics
      .filter(d => d.gender)
      .reduce((acc, item) => {
        acc[item.gender] = item.percentage;
        return acc;
      }, {} as Record<string, number>);

    // Convert devices to specific device views
    const deviceMap = devices.reduce((acc, item) => {
      acc[item.device_type.toLowerCase()] = item.views;
      return acc;
    }, {} as Record<string, number>);

    // Convert traffic sources to specific source views
    const trafficMap = trafficSources.reduce((acc, item) => {
      const sourceType = item.source_type.toLowerCase();
      if (sourceType.includes('search')) acc.search = item.views;
      else if (sourceType.includes('suggested')) acc.suggested = item.views;
      else if (sourceType.includes('external')) acc.external = item.views;
      else if (sourceType.includes('direct')) acc.direct = item.views;
      else if (sourceType.includes('playlist')) acc.playlist = item.views;
      return acc;
    }, {} as Record<string, number>);

    return dailyMetrics.map(metric => ({
      video_id: metric.video_id,
      date: metric.date,
      views: metric.views,
      engaged_views: metric.engaged_views,
      red_views: metric.red_views,
      viewer_percentage: metric.viewer_percentage,
      estimated_minutes_watched: metric.estimated_minutes_watched,
      estimated_red_minutes_watched: metric.estimated_red_minutes_watched,
      average_view_duration: metric.average_view_duration,
      average_view_percentage: metric.average_view_percentage,
      likes: metric.likes,
      dislikes: metric.dislikes,
      comments: metric.comments,
      shares: metric.shares,
      subscribers_gained: metric.subscribers_gained,
      subscribers_lost: metric.subscribers_lost,
      estimated_revenue: metric.estimated_revenue,
      estimated_ad_revenue: metric.estimated_ad_revenue,
      estimated_red_partner_revenue: metric.estimated_red_partner_revenue,
      gross_revenue: metric.gross_revenue,
      cpm: metric.cpm,
      ad_impressions: metric.ad_impressions,
      monetized_playbacks: metric.monetized_playbacks,
      card_impressions: metric.card_impressions,
      card_clicks: metric.card_clicks,
      card_click_rate: metric.card_click_rate,
      end_screen_element_clicks: metric.end_screen_element_clicks,
      
      // JSONB fields
      country_views: Object.keys(countryViews).length > 0 ? countryViews : undefined,
      top_age_groups: Object.keys(ageGroups).length > 0 ? ageGroups : undefined,
      gender_breakdown: Object.keys(genderBreakdown).length > 0 ? genderBreakdown : undefined,
      
      // Device breakdown
      mobile_views: deviceMap.mobile || deviceMap.phone,
      desktop_views: deviceMap.desktop || deviceMap.computer,
      tablet_views: deviceMap.tablet,
      tv_views: deviceMap.tv || deviceMap.television,
      
      // Traffic source breakdown
      search_views: trafficMap.search,
      suggested_views: trafficMap.suggested,
      external_views: trafficMap.external,
      direct_views: trafficMap.direct,
      playlist_views: trafficMap.playlist,
    }));
  }

  /**
   * Combine analytics data from different API calls by date (basic version)
   */
  private combineAnalyticsData(
    analyticsData: AnalyticsDataRow[],
    ctrData: AnalyticsDataRow[],
    retentionData: AnalyticsDataRow[]
  ): DailyAnalyticsRecord[] {
    const combinedMap = new Map<string, DailyAnalyticsRecord>();

    // Start with basic analytics data
    analyticsData.forEach(row => {
      const key = `${row.video_id}-${row.date}`;
      combinedMap.set(key, {
        video_id: row.video_id,
        date: row.date,
        views: row.views,
        likes: row.likes,
        comments: row.comments
      });
    });

    // Add CTR data
    ctrData.forEach(row => {
      const key = `${row.video_id}-${row.date}`;
      const existing = combinedMap.get(key);
      if (existing) {
        existing.ctr = row.ctr;
      }
    });

    // Add retention data
    retentionData.forEach(row => {
      const key = `${row.video_id}-${row.date}`;
      const existing = combinedMap.get(key);
      if (existing) {
        existing.retention_avg = row.retention_avg;
      }
    });

    return Array.from(combinedMap.values());
  }

  /**
   * Store daily analytics data in Supabase
   */
  private async storeDailyAnalytics(
    records: DailyAnalyticsRecord[],
    userId: string
  ): Promise<void> {
    if (records.length === 0) return;

    try {
      // Note: We'll use upsert to handle duplicate dates
      // The unique constraint on (video_id, date) will prevent duplicates
      const { error } = await supabase
        .from('daily_analytics')
        .upsert(records, {
          onConflict: 'video_id,date'
        });

      if (error) {
        console.error('❌ Error storing analytics data:', error);
        throw error;
      }

      console.log(`💾 Stored ${records.length} daily analytics records`);

    } catch (error) {
      console.error('❌ Failed to store analytics data:', error);
      throw error;
    }
  }

  /**
   * Get analytics summary for dashboard
   */
  async getAnalyticsSummary(userId: string, days: number = 30): Promise<{
    totalVideos: number;
    totalViews: number;
    averageCTR: number;
    averageRetention: number;
    totalRecords: number;
  }> {
    try {
      const startDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

      const { data, error } = await supabase
        .from('daily_analytics')
        .select('*')
        .gte('date', startDate);

      if (error) {
        console.error('❌ Error fetching analytics summary:', error);
        throw error;
      }

      if (!data || data.length === 0) {
        return {
          totalVideos: 0,
          totalViews: 0,
          averageCTR: 0,
          averageRetention: 0,
          totalRecords: 0
        };
      }

      const uniqueVideos = new Set(data.map(record => record.video_id));
      const totalViews = data.reduce((sum, record) => sum + (record.views || 0), 0);
      const ctrValues = data.filter(record => record.ctr != null).map(record => record.ctr);
      const retentionValues = data.filter(record => record.retention_avg != null).map(record => record.retention_avg);

      return {
        totalVideos: uniqueVideos.size,
        totalViews,
        averageCTR: ctrValues.length > 0 ? ctrValues.reduce((a, b) => a + b, 0) / ctrValues.length : 0,
        averageRetention: retentionValues.length > 0 ? retentionValues.reduce((a, b) => a + b, 0) / retentionValues.length : 0,
        totalRecords: data.length
      };

    } catch (error) {
      console.error('❌ Error getting analytics summary:', error);
      throw error;
    }
  }
}

// Export singleton instance
export const analyticsProcessor = new AnalyticsProcessor();