/**
 * YouTube Analytics Daily Import Service
 * Handles daily collection of YouTube Analytics API data for all videos
 * Replaces the YouTube Reporting API CSV-based approach
 */

import { youtubeAnalyticsClient } from './youtube-analytics-api';
import { supabase } from './supabase';

export interface DailyAnalyticsData {
  video_id: string;
  date: string;
  // View Metrics
  views: number;
  engaged_views?: number;
  red_views?: number;
  viewer_percentage?: number;
  // Watch Time Metrics
  estimated_minutes_watched: number;
  estimated_red_minutes_watched?: number;
  average_view_duration: number;
  average_view_percentage: number;
  // Engagement Metrics
  likes?: number;
  dislikes?: number;
  comments?: number;
  shares?: number;
  subscribers_gained?: number;
  subscribers_lost?: number;
  videos_added_to_playlists?: number;
  videos_removed_from_playlists?: number;
  // Annotation Metrics
  annotation_click_through_rate?: number;
  annotation_close_rate?: number;
  annotation_impressions?: number;
  annotation_clickable_impressions?: number;
  annotation_closable_impressions?: number;
  annotation_clicks?: number;
  annotation_closes?: number;
  // Card Metrics
  card_click_rate?: number;
  card_teaser_click_rate?: number;
  card_impressions?: number;
  card_teaser_impressions?: number;
  card_clicks?: number;
  card_teaser_clicks?: number;
  // Revenue Metrics
  estimated_revenue?: number;
  estimated_ad_revenue?: number;
  estimated_red_partner_revenue?: number;
  gross_revenue?: number;
  // Ad Performance Metrics
  cpm?: number;
  playback_based_cpm?: number;
  ad_impressions?: number;
  monetized_playbacks?: number;
  // JSONB fields for future extension
  audience_watch_ratio?: any;
  relative_retention_performance?: any;
  // Metadata
  created_at?: string;
  updated_at?: string;
}

export interface DailyImportProgress {
  totalVideos: number;
  processedVideos: number;
  successfulImports: number;
  failedImports: number;
  quotaUsed: number;
  estimatedTimeRemaining?: number;
  currentVideo?: string;
  currentBatch?: number;
  totalBatches?: number;
  queriesPerMinute?: number;
  rateLimitStatus?: {
    queriesInCurrentWindow: number;
    windowStartTime: number;
    maxQueriesPerMinute: number;
    recommendedDelay: number;
  };
  errors: string[];
  startTime?: number;
  lastUpdateTime?: number;
}

export class YouTubeAnalyticsDailyService {
  private baseUrl = 'https://youtubeanalytics.googleapis.com/v2/reports';
  private quotaPerRequest = 1; // Each video requires 1 Analytics API call (comprehensive approach)
  private maxQueriesPerMinute = 720; // YouTube Analytics API limit (confirmed from Google Console)
  private targetUtilization = 0.45; // Target 45% utilization for optimal speed vs safety
  private queryTracker = {
    queries: [] as number[], // Timestamps of queries
    getQueriesInWindow: () => {
      const now = Date.now();
      const oneMinuteAgo = now - 60000;
      return this.queryTracker.queries.filter(timestamp => timestamp > oneMinuteAgo).length;
    },
    addQuery: () => {
      const now = Date.now();
      this.queryTracker.queries.push(now);
      // Clean old queries (older than 1 minute)
      const oneMinuteAgo = now - 60000;
      this.queryTracker.queries = this.queryTracker.queries.filter(timestamp => timestamp > oneMinuteAgo);
    },
    getRecommendedDelay: () => {
      const queriesInWindow = this.queryTracker.getQueriesInWindow();
      const utilizationPercent = (queriesInWindow / this.maxQueriesPerMinute) * 100;
      
      if (utilizationPercent > 70) {
        return 2000; // 2 second delay if over 70%
      } else if (utilizationPercent > 50) {
        return 800; // 800ms delay if over 50%
      } else if (utilizationPercent > 30) {
        return 400; // 400ms delay if over 30%
      } else {
        return 200; // 200ms minimum delay for fast processing
      }
    }
  };

  /**
   * Get all video IDs that need daily analytics collection
   */
  async getVideoIdsForAnalytics(): Promise<string[]> {
    const { data: videos, error } = await supabase
      .from('videos')
      .select('id')
      .eq('channel_id', 'Make or Break Shop') // Filter to specific channel
      .not('id', 'in', '(CHANNEL_TOTAL)') // Exclude invalid IDs
      .order('created_at', { ascending: false });

    if (error) {
      console.error('❌ Error fetching video IDs:', error);
      throw new Error(`Failed to fetch video IDs: ${error.message}`);
    }

    return videos?.map(v => v.id) || [];
  }

  /**
   * Import daily analytics for a specific date with token refresh support
   */
  async importDailyAnalytics(
    targetDate: string, // YYYY-MM-DD format
    accessToken: string,
    progressCallback?: (progress: DailyImportProgress) => void,
    refreshTokenCallback?: () => Promise<string | null>
  ): Promise<DailyImportProgress> {
    console.log(`🚀 Starting daily analytics import for ${targetDate}`);

    // Validate access token
    if (!accessToken) {
      throw new Error('Access token is required');
    }

    // Get all video IDs
    const videoIds = await this.getVideoIdsForAnalytics();
    console.log(`📊 Found ${videoIds.length} videos to process`);

    // Process videos with adaptive batch sizing based on rate limits
    let batchSize = this.calculateOptimalBatchSize();
    
    const progress: DailyImportProgress = {
      totalVideos: videoIds.length,
      processedVideos: 0,
      successfulImports: 0,
      failedImports: 0,
      quotaUsed: 0,
      errors: [],
      startTime: Date.now(),
      lastUpdateTime: Date.now(),
      totalBatches: Math.ceil(videoIds.length / batchSize),
      currentBatch: 0
    };
    const results: DailyAnalyticsData[] = [];

    for (let i = 0; i < videoIds.length; i += batchSize) {
      const batch = videoIds.slice(i, i + batchSize);
      progress.currentBatch = Math.floor(i / batchSize) + 1;
      progress.currentVideo = `Batch ${progress.currentBatch}/${progress.totalBatches} (${batch.length} videos)`;
      
      // Log batch start with progress summary
      console.log(`📊 Batch ${progress.currentBatch}/${progress.totalBatches}: Processing ${batch.length} videos (${progress.processedVideos}/${videoIds.length} complete)`);
      
      // Update rate limit status
      progress.rateLimitStatus = {
        queriesInCurrentWindow: this.queryTracker.getQueriesInWindow(),
        windowStartTime: Date.now() - 60000,
        maxQueriesPerMinute: this.maxQueriesPerMinute,
        recommendedDelay: this.queryTracker.getRecommendedDelay()
      };
      progress.queriesPerMinute = progress.rateLimitStatus.queriesInCurrentWindow;
      
      // Process batch sequentially to maintain rate limit control
      for (const videoId of batch) {
        try {
          // Check if we need to wait before making the next query
          const queriesInWindow = this.queryTracker.getQueriesInWindow();
          const targetQueries = Math.floor(this.maxQueriesPerMinute * this.targetUtilization);
          if (queriesInWindow >= targetQueries) {
            const waitTime = 15000; // Wait 15 seconds to let window reset
            console.log(`⏳ Rate limit pause: ${queriesInWindow}/${targetQueries} queries (${Math.round((queriesInWindow/this.maxQueriesPerMinute)*100)}%), waiting ${waitTime/1000}s`);
            await new Promise(resolve => setTimeout(resolve, waitTime));
          }
          
          const analyticsData = await this.getComprehensiveVideoAnalytics(
            videoId, 
            targetDate, 
            targetDate, 
            accessToken,
            refreshTokenCallback
          );
          
          progress.quotaUsed++;
          progress.processedVideos++;
          
          if (analyticsData.length > 0) {
            progress.successfulImports++;
            results.push(analyticsData[0]);
          } else {
            progress.failedImports++;
            progress.errors.push(`No data found for video ${videoId}`);
          }
          
        } catch (error) {
          progress.failedImports++;
          progress.processedVideos++;
          const errorMessage = error instanceof Error ? error.message : String(error);
          progress.errors.push(`Failed to import ${videoId}: ${errorMessage}`);
          // Only log errors, not every successful video
          console.error(`❌ Failed to import ${videoId}:`, errorMessage);
        }
        
        // Smart delay between individual requests
        const recommendedDelay = this.queryTracker.getRecommendedDelay();
        if (batch.indexOf(videoId) < batch.length - 1) {
          await new Promise(resolve => setTimeout(resolve, recommendedDelay));
        }
      }

      // Update progress with more detailed timing info
      progress.lastUpdateTime = Date.now();
      progress.estimatedTimeRemaining = this.calculateETA(progress, videoIds.length);
      
      // Log batch completion summary
      const successRate = ((progress.successfulImports / progress.processedVideos) * 100).toFixed(1);
      const rateLimitPercent = ((progress.rateLimitStatus.queriesInCurrentWindow / this.maxQueriesPerMinute) * 100).toFixed(1);
      console.log(`✅ Batch complete: ${progress.successfulImports}/${progress.processedVideos} successful (${successRate}%) | Rate: ${rateLimitPercent}% | ETA: ${Math.round((progress.estimatedTimeRemaining || 0) / 60)}min`);
      
      if (progressCallback) {
        progressCallback({ ...progress });
      }

      // Adaptive batch sizing for next iteration
      batchSize = this.calculateOptimalBatchSize();
      
      // Minimal batch-level delay for optimized processing
      if (i + batchSize < videoIds.length) {
        const batchDelay = Math.min(this.queryTracker.getRecommendedDelay() / 4, 500);
        await new Promise(resolve => setTimeout(resolve, batchDelay));
      }
    }

    // Bulk insert results into database
    if (results.length > 0) {
      await this.bulkInsertAnalyticsData(results);
    }

    console.log(`✅ Daily import complete for ${targetDate}`);
    console.log(`📊 Processed: ${progress.processedVideos} videos`);
    console.log(`✅ Successful: ${progress.successfulImports} imports`);
    console.log(`❌ Failed: ${progress.failedImports} imports`);
    console.log(`💰 Quota used: ${progress.quotaUsed} units`);

    return progress;
  }

  /**
   * Get comprehensive video analytics using Google's documented approach
   */
  private async getComprehensiveVideoAnalytics(
    videoId: string,
    startDate: string,
    endDate: string,
    accessToken: string,
    refreshTokenCallback?: () => Promise<string | null>
  ): Promise<DailyAnalyticsData[]> {
    // ALL AVAILABLE VIDEO-LEVEL METRICS (comprehensive approach)
    // This attempts to get every single metric available for individual videos
    const allMetrics = [
      // View Metrics
      'views', 'engagedViews', 'redViews',
      // Watch Time Metrics  
      'estimatedMinutesWatched', 'estimatedRedMinutesWatched', 'averageViewDuration', 'averageViewPercentage',
      // Engagement Metrics
      'comments', 'likes', 'dislikes', 'shares', 'subscribersGained', 'subscribersLost',
      // Playlist Metrics
      'videosAddedToPlaylists', 'videosRemovedFromPlaylists',
      // Annotation Metrics
      'annotationClickThroughRate', 'annotationCloseRate', 'annotationImpressions', 'annotationClickableImpressions', 'annotationClosableImpressions', 'annotationClicks', 'annotationCloses',
      // Card Metrics
      'cardClickRate', 'cardTeaserClickRate', 'cardImpressions', 'cardTeaserImpressions', 'cardClicks', 'cardTeaserClicks',
      // Revenue Metrics
      'estimatedRevenue', 'estimatedAdRevenue', 'grossRevenue', 'estimatedRedPartnerRevenue',
      // Ad Performance Metrics
      'monetizedPlaybacks', 'playbackBasedCpm', 'adImpressions', 'cpm'
    ].join(',');
    
    const analyticsData = await this.makeAnalyticsCall(
      videoId,
      startDate,
      endDate,
      allMetrics,
      accessToken,
      undefined,
      refreshTokenCallback
    );

    return this.transformSingleCallResponse(analyticsData, videoId, startDate);
  }

  /**
   * Calculate optimal batch size based on current rate limit usage
   */
  private calculateOptimalBatchSize(): number {
    const queriesInWindow = this.queryTracker.getQueriesInWindow();
    const utilizationPercent = (queriesInWindow / this.maxQueriesPerMinute) * 100;
    
    if (utilizationPercent > 60) {
      return 8; // Conservative when approaching target
    } else if (utilizationPercent > 40) {
      return 12; // Moderate batch size
    } else if (utilizationPercent > 20) {
      return 18; // Larger batches for efficiency
    } else {
      return 25; // Maximum batch size when usage is very low
    }
  }

  /**
   * Make a YouTube Analytics API call with token refresh support and rate limit tracking
   */
  private async makeAnalyticsCall(
    videoId: string,
    startDate: string,
    endDate: string,
    metrics: string,
    accessToken: string,
    dimensions?: string,
    refreshTokenCallback?: () => Promise<string | null>,
    retryCount: number = 0
  ): Promise<any> {
    const url = new URL(this.baseUrl);
    url.searchParams.append('ids', `channel==UCjWkNxpp3UHdEavpM_19--Q`);
    url.searchParams.append('startDate', startDate);
    url.searchParams.append('endDate', endDate);
    url.searchParams.append('metrics', metrics);
    url.searchParams.append('filters', `video==${videoId}`);
    
    if (dimensions) {
      url.searchParams.append('dimensions', dimensions);
    }

    // Track this query for rate limiting
    this.queryTracker.addQuery();
    
    const response = await fetch(url.toString(), {
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Accept': 'application/json'
      }
    });

    // Handle token expiration with refresh
    if (response.status === 401 && refreshTokenCallback && retryCount < 2) {
      console.log(`🔄 Token expired for video ${videoId}, refreshing and retrying...`);
      const newToken = await refreshTokenCallback();
      if (newToken) {
        return await this.makeAnalyticsCall(
          videoId,
          startDate,
          endDate,
          metrics,
          newToken,
          dimensions,
          refreshTokenCallback,
          retryCount + 1
        );
      }
    }

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`Analytics API Error for video ${videoId}:`, {
        status: response.status,
        statusText: response.statusText,
        errorText,
        url: url.toString(),
        metrics
      });
      throw new Error(`Analytics API error ${response.status}: ${errorText}`);
    }

    return response.json();
  }

  /**
   * Transform Analytics API response to our database format (using 2 API calls due to metric restrictions)
   */
  private transformAnalyticsResponse(coreData: any, revenueData: any, advancedData: any, videoId: string, startDate: string): DailyAnalyticsData[] {
    if (!coreData.rows || coreData.rows.length === 0) {
      return [];
    }

    // Parse core metrics (10 metrics)
    const coreRow = coreData.rows[0] || [];
    // Parse revenue metrics (2 metrics)
    const revenueRow = revenueData.rows?.[0] || [];
    // Parse advanced metrics (5 metrics)
    const advancedRow = advancedData.rows?.[0] || [];

    const analyticsData: DailyAnalyticsData = {
      video_id: videoId,
      date: startDate,
      // Core View Metrics
      views: Number(coreRow[0]) || 0,
      engaged_views: Number(advancedRow[0]) || null,
      red_views: null, // Not available in standard API
      viewer_percentage: null, // Not available in standard API
      // Watch Time Metrics
      estimated_minutes_watched: Number(coreRow[1]) || 0,
      estimated_red_minutes_watched: null, // Not available
      average_view_duration: Number(coreRow[2]) || 0,
      average_view_percentage: Number(coreRow[3]) || 0,
      // Engagement Metrics
      likes: Number(coreRow[4]) || null,
      dislikes: Number(coreRow[5]) || null,
      comments: Number(coreRow[6]) || null,
      shares: Number(coreRow[7]) || null,
      subscribers_gained: Number(coreRow[8]) || null,
      subscribers_lost: Number(coreRow[9]) || null,
      videos_added_to_playlists: null, // Not available in this call combination
      videos_removed_from_playlists: null, // Not available in this call combination
      // Revenue Metrics
      estimated_revenue: Number(revenueRow[0]) || null,
      estimated_ad_revenue: Number(revenueRow[1]) || null,
      estimated_red_partner_revenue: null, // Not available
      gross_revenue: null, // Not available
      // Ad Performance Metrics
      cpm: Number(advancedRow[2]) || null,
      playback_based_cpm: Number(advancedRow[3]) || null,
      ad_impressions: Number(advancedRow[1]) || null,
      monetized_playbacks: Number(advancedRow[4]) || null,
    };

    return [analyticsData];
  }

  /**
   * Transform ALL METRICS API response - complete video analytics data
   */
  private transformSingleCallResponse(data: any, videoId: string, startDate: string): DailyAnalyticsData[] {
    if (!data.rows || data.rows.length === 0) {
      return [];
    }

    const row = data.rows[0] || [];
    
    // Map ALL 36 metrics in order:
    // views,engagedViews,redViews,estimatedMinutesWatched,estimatedRedMinutesWatched,averageViewDuration,averageViewPercentage,
    // comments,likes,dislikes,shares,subscribersGained,subscribersLost,videosAddedToPlaylists,videosRemovedFromPlaylists,
    // annotationClickThroughRate,annotationCloseRate,annotationImpressions,annotationClickableImpressions,annotationClosableImpressions,annotationClicks,annotationCloses,
    // cardClickRate,cardTeaserClickRate,cardImpressions,cardTeaserImpressions,cardClicks,cardTeaserClicks,
    // estimatedRevenue,estimatedAdRevenue,grossRevenue,estimatedRedPartnerRevenue,monetizedPlaybacks,playbackBasedCpm,adImpressions,cpm

    const analyticsData: DailyAnalyticsData = {
      video_id: videoId,
      date: startDate,
      // View Metrics (3)
      views: Number(row[0]) || 0,
      engaged_views: Number(row[1]) || null,
      red_views: Number(row[2]) || null,
      // Watch Time Metrics (4)
      estimated_minutes_watched: Number(row[3]) || 0,
      estimated_red_minutes_watched: Number(row[4]) || null,
      average_view_duration: Number(row[5]) || 0,
      average_view_percentage: Number(row[6]) || null,
      // Engagement Metrics (6)
      comments: Number(row[7]) || null,
      likes: Number(row[8]) || null,
      dislikes: Number(row[9]) || null,
      shares: Number(row[10]) || null,
      subscribers_gained: Number(row[11]) || null,
      subscribers_lost: Number(row[12]) || null,
      // Playlist Metrics (2)
      videos_added_to_playlists: Number(row[13]) || null,
      videos_removed_from_playlists: Number(row[14]) || null,
      // Annotation Metrics (7) - now have dedicated columns
      annotation_click_through_rate: Number(row[15]) || null,
      annotation_close_rate: Number(row[16]) || null,
      annotation_impressions: Number(row[17]) || null,
      annotation_clickable_impressions: Number(row[18]) || null,
      annotation_closable_impressions: Number(row[19]) || null,
      annotation_clicks: Number(row[20]) || null,
      annotation_closes: Number(row[21]) || null,
      // Card Metrics (6) - now have dedicated columns
      card_click_rate: Number(row[22]) || null,
      card_teaser_click_rate: Number(row[23]) || null,
      card_impressions: Number(row[24]) || null,
      card_teaser_impressions: Number(row[25]) || null,
      card_clicks: Number(row[26]) || null,
      card_teaser_clicks: Number(row[27]) || null,
      // Revenue Metrics (4)
      estimated_revenue: Number(row[28]) || null,
      estimated_ad_revenue: Number(row[29]) || null,
      gross_revenue: Number(row[30]) || null,
      estimated_red_partner_revenue: Number(row[31]) || null,
      // Ad Performance Metrics (4)
      monetized_playbacks: Number(row[32]) || null,
      playback_based_cpm: Number(row[33]) || null,
      ad_impressions: Number(row[34]) || null,
      cpm: Number(row[35]) || null,
      // JSONB fields for future extension
      audience_watch_ratio: null,
      relative_retention_performance: null,
      // Not available via API
      viewer_percentage: null,
    };

    return [analyticsData];
  }

  /**
   * Bulk insert analytics data into database
   */
  private async bulkInsertAnalyticsData(data: DailyAnalyticsData[]): Promise<void> {
    const { error } = await supabase
      .from('daily_analytics')
      .upsert(data, {
        onConflict: 'video_id,date',
        ignoreDuplicates: false
      });

    if (error) {
      console.error('❌ Error inserting analytics data:', error);
      throw new Error(`Failed to insert analytics data: ${error.message}`);
    }

    console.log(`✅ Successfully inserted ${data.length} analytics records`);
  }

  /**
   * Historical backfill for date range with enhanced rate limiting and token refresh support
   */
  async backfillHistoricalData(
    startDate: string,
    endDate: string,
    accessToken: string,
    progressCallback?: (progress: DailyImportProgress) => void,
    refreshTokenCallback?: () => Promise<string | null>
  ): Promise<DailyImportProgress> {
    const start = new Date(startDate);
    const end = new Date(endDate);
    const dates: string[] = [];

    // Generate all dates in range
    for (const dt = new Date(start); dt <= end; dt.setDate(dt.getDate() + 1)) {
      dates.push(dt.toISOString().split('T')[0]);
    }

    console.log(`🔄 Starting historical backfill: ${dates.length} days`);

    const totalProgress: DailyImportProgress = {
      totalVideos: 0,
      processedVideos: 0,
      successfulImports: 0,
      failedImports: 0,
      quotaUsed: 0,
      errors: []
    };

    // Process each date with token refresh support
    let currentAccessToken = accessToken;
    for (let i = 0; i < dates.length; i++) {
      const date = dates[i];
      console.log(`📅 Processing date ${i + 1}/${dates.length}: ${date}`);

      try {
        const dayProgress = await this.importDailyAnalytics(date, currentAccessToken, progressCallback, refreshTokenCallback);
        
        // If we got a token refresh callback and this day had auth failures, refresh the token
        if (refreshTokenCallback && dayProgress.failedImports > 0 && 
            dayProgress.errors.some(error => error.includes('401') || error.includes('Unauthorized'))) {
          console.log('🔄 Detected auth failures, refreshing token for next batch...');
          const newToken = await refreshTokenCallback();
          if (newToken) {
            currentAccessToken = newToken;
            console.log('✅ Token refreshed, continuing with new token');
          }
        }
        
        // Aggregate progress
        totalProgress.totalVideos += dayProgress.totalVideos;
        totalProgress.processedVideos += dayProgress.processedVideos;
        totalProgress.successfulImports += dayProgress.successfulImports;
        totalProgress.failedImports += dayProgress.failedImports;
        totalProgress.quotaUsed += dayProgress.quotaUsed;
        totalProgress.errors.push(...dayProgress.errors);

        console.log(`✅ Completed ${date}: ${dayProgress.successfulImports} successful imports`);
      } catch (error) {
        console.error(`❌ Failed to process date ${date}:`, error);
        totalProgress.errors.push(`Failed to process ${date}: ${error}`);
      }

      // Rate limiting between days
      if (i < dates.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
    }

    console.log(`🎉 Historical backfill complete!`);
    console.log(`📊 Total processed: ${totalProgress.processedVideos} video-days`);
    console.log(`✅ Total successful: ${totalProgress.successfulImports} imports`);
    console.log(`💰 Total quota used: ${totalProgress.quotaUsed} units`);

    return totalProgress;
  }

  /**
   * Calculate estimated time remaining with improved accuracy
   */
  private calculateETA(progress: DailyImportProgress, totalVideos: number): number {
    if (progress.processedVideos === 0 || !progress.startTime) return 0;
    
    const elapsedMs = Date.now() - progress.startTime;
    const avgTimePerVideo = elapsedMs / progress.processedVideos;
    const remainingVideos = totalVideos - progress.processedVideos;
    
    // Factor in current rate limiting delays
    const currentDelay = this.queryTracker.getRecommendedDelay();
    const adjustedTimePerVideo = avgTimePerVideo + currentDelay;
    
    return Math.round((remainingVideos * adjustedTimePerVideo) / 1000); // seconds
  }

  /**
   * Validate quota usage for a date range
   */
  async validateQuotaUsage(startDate: string, endDate: string): Promise<{
    totalDays: number;
    totalVideos: number;
    estimatedQuotaUsage: number;
    dailyQuotaPercentage: number;
  }> {
    const videoIds = await this.getVideoIdsForAnalytics();
    const start = new Date(startDate);
    const end = new Date(endDate);
    const totalDays = Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)) + 1;
    
    const estimatedQuotaUsage = videoIds.length * totalDays * this.quotaPerRequest;
    const dailyQuotaPercentage = (estimatedQuotaUsage / 100000) * 100; // 100k daily quota (confirmed from Google Console)

    return {
      totalDays,
      totalVideos: videoIds.length,
      estimatedQuotaUsage,
      dailyQuotaPercentage
    };
  }
}

// Export singleton instance
export const youtubeAnalyticsDailyService = new YouTubeAnalyticsDailyService();