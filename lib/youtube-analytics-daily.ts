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
  private targetUtilization = 0.80; // Target 80% utilization - reduced from 85% to prevent rate limit violations
  private tokenRefreshMutex = false; // Prevent concurrent token refreshes
  private currentAccessToken = ''; // Track current token to avoid redundant refreshes
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
      
      // Enhanced delay structure aligned with 80% target utilization
      if (utilizationPercent > 95) {
        return 10000; // Very large delay when dangerously close to limit
      } else if (utilizationPercent > 90) {
        return 5000; // Large delay to prevent rate limit hits
      } else if (utilizationPercent > 85) {
        return 3000; // Significant delay when well above target
      } else if (utilizationPercent > 80) {
        return 2000; // Large delay when exceeding new target
      } else if (utilizationPercent > 75) {
        return 1000; // Moderate delay approaching target
      } else if (utilizationPercent > 60) {
        return 500; // Small delay for sustained processing
      } else if (utilizationPercent > 40) {
        return 200; // Minimal delay at moderate usage
      } else if (utilizationPercent > 20) {
        return 100; // Very small delay at low usage
      } else {
        return 50; // Small buffer delay for consistency
      }
    }
  };

  /**
   * Get video IDs that need daily analytics collection, optionally filtered by publication date
   * @param targetDate Optional YYYY-MM-DD date to filter videos published before this date
   */
  async getVideoIdsForAnalytics(targetDate?: string): Promise<string[]> {
    let query = supabase
      .from('videos')
      .select('id, published_at')
      .eq('channel_id', 'Make or Break Shop') // Filter to specific channel
      .not('id', 'in', '(CHANNEL_TOTAL)'); // Exclude invalid IDs
    
    // Only include videos published before or on the target date to avoid wasting API calls
    if (targetDate) {
      query = query.lte('published_at', targetDate);
    }
    
    const { data: videos, error } = await query.order('published_at', { ascending: false });

    if (error) {
      console.error('❌ Error fetching video IDs:', error);
      throw new Error(`Failed to fetch video IDs: ${error.message}`);
    }

    const videoIds = videos?.map(v => v.id) || [];
    
    if (targetDate) {
      console.log(`📊 Date-filtered videos: ${videoIds.length} videos published before ${targetDate}`);
    } else {
      console.log(`📊 All channel videos: ${videoIds.length} videos`);
    }

    return videoIds;
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

    // Get video IDs filtered by target date to avoid wasting API calls on unpublished videos
    const videoIds = await this.getVideoIdsForAnalytics(targetDate);
    console.log(`📊 Found ${videoIds.length} videos to process for ${targetDate}`);

    // Initialize current access token
    this.currentAccessToken = accessToken;

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
      
      // Process batch with centralized token refresh handling
      let batchResults = await this.processBatchWithTokenHandling(
        batch,
        targetDate,
        refreshTokenCallback
      );
      
      // Process results and update progress
      for (const result of batchResults) {
        progress.quotaUsed++;
        progress.processedVideos++;
        
        if (result.success && result.data) {
          progress.successfulImports++;
          results.push(result.data);
        } else {
          progress.failedImports++;
          if (result.success) {
            progress.errors.push(`No data found for video ${result.videoId}`);
          } else {
            progress.errors.push(`Failed to import ${result.videoId}: ${result.error}`);
          }
        }
      }

      // Dynamic delay based on conservative rate limiting
      const currentUtilization = (this.queryTracker.getQueriesInWindow() / this.maxQueriesPerMinute) * 100;
      const recommendedDelay = this.queryTracker.getRecommendedDelay();
      if (recommendedDelay > 0) {
        await new Promise(resolve => setTimeout(resolve, recommendedDelay));
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

      // Keep batch size consistent to avoid overlap/duplicate issues
      // batchSize = this.calculateOptimalBatchSize(); // Disabled to prevent duplicate processing
      
      // Conservative delay between batches for sustainable processing
      if (i + batchSize < videoIds.length) {
        const currentUtilization = (this.queryTracker.getQueriesInWindow() / this.maxQueriesPerMinute) * 100;
        const betweenBatchDelay = this.queryTracker.getRecommendedDelay();
        if (betweenBatchDelay > 0) {
          await new Promise(resolve => setTimeout(resolve, betweenBatchDelay));
        }
        // Always add small base delay for long-term stability
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    }

    // Bulk insert results into database with deduplication
    if (results.length > 0) {
      // Deduplicate results by video_id to prevent constraint violations
      const uniqueResults = results.reduce((acc, current) => {
        const existing = acc.find(item => item.video_id === current.video_id);
        if (!existing) {
          acc.push(current);
        }
        return acc;
      }, [] as DailyAnalyticsData[]);
      
      console.log(`📊 Deduplication: ${results.length} total → ${uniqueResults.length} unique results`);
      await this.bulkInsertAnalyticsData(uniqueResults);
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
   * Process a batch of videos with centralized token refresh handling
   */
  private async processBatchWithTokenHandling(
    batch: string[],
    targetDate: string,
    refreshTokenCallback?: () => Promise<string | null>
  ): Promise<Array<{success: boolean, videoId: string, data?: any, error?: string}>> {
    
    // First attempt with current token
    let batchResults = await this.executeVideoBatch(batch, targetDate);
    
    // Check for authentication failures
    const authFailures = batchResults.filter(result => 
      !result.success && result.error?.includes('unauthorized')
    );
    
    // If we have auth failures and a refresh callback, refresh token once for entire batch
    if (authFailures.length > 0 && refreshTokenCallback && !this.tokenRefreshMutex) {
      this.tokenRefreshMutex = true;
      console.log(`🔄 Refreshing access token for continued backfill...`);
      
      try {
        const newToken = await refreshTokenCallback();
        if (newToken && newToken !== this.currentAccessToken) {
          this.currentAccessToken = newToken;
          console.log(`✅ Access token refreshed successfully`);
          
          // Retry only the failed videos with new token
          const failedVideoIds = authFailures.map(f => f.videoId);
          const retryResults = await this.executeVideoBatch(failedVideoIds, targetDate);
          
          // Replace failed results with retry results
          for (const retryResult of retryResults) {
            const originalIndex = batchResults.findIndex(r => r.videoId === retryResult.videoId);
            if (originalIndex >= 0) {
              batchResults[originalIndex] = retryResult;
            }
          }
        }
      } catch (error) {
        console.error('❌ Failed to refresh access token:', error);
      } finally {
        this.tokenRefreshMutex = false;
      }
    }
    
    return batchResults;
  }

  /**
   * Execute a batch of video analytics requests
   */
  private async executeVideoBatch(
    batch: string[],
    targetDate: string
  ): Promise<Array<{success: boolean, videoId: string, data?: any, error?: string}>> {
    const batchPromises = batch.map(async (videoId) => {
      try {
        const analyticsData = await this.getComprehensiveVideoAnalytics(
          videoId, 
          targetDate, 
          targetDate, 
          this.currentAccessToken,
          undefined // No individual refresh callback
        );
        
        return {
          success: true,
          videoId,
          data: analyticsData.length > 0 ? analyticsData[0] : null
        };
        
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        return {
          success: false,
          videoId,
          error: errorMessage
        };
      }
    });

    return await Promise.all(batchPromises);
  }

  /**
   * Calculate optimal batch size based on current rate limit usage - optimized for sustainability
   */
  private calculateOptimalBatchSize(): number {
    const queriesInWindow = this.queryTracker.getQueriesInWindow();
    const utilizationPercent = (queriesInWindow / this.maxQueriesPerMinute) * 100;
    
    // Conservative batch sizing aligned with 80% target utilization
    if (utilizationPercent > 95) {
      return 5; // Very small batches when dangerously close to limit
    } else if (utilizationPercent > 90) {
      return 10; // Small batches to prevent rate limit hits
    } else if (utilizationPercent > 85) {
      return 15; // Small batches when well above target
    } else if (utilizationPercent > 80) {
      return 20; // Reduced batches when exceeding new target
    } else if (utilizationPercent > 75) {
      return 30; // Moderate batches approaching target
    } else if (utilizationPercent > 60) {
      return 50; // Good batch size at moderate usage
    } else if (utilizationPercent > 40) {
      return 70; // Larger batches at low usage
    } else if (utilizationPercent > 20) {
      return 90; // Large batches at very low usage
    } else {
      return 100; // Max batch size when usage is minimal
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
    // Check rate limits BEFORE making call and wait if needed
    const currentUtilization = (this.queryTracker.getQueriesInWindow() / this.maxQueriesPerMinute) * 100;
    const recommendedDelay = this.queryTracker.getRecommendedDelay();
    
    // Always enforce delays for parallel processing safety
    if (currentUtilization > 75) {
      // Back off when exceeding target
      const safetyDelay = Math.max(recommendedDelay, 300 + (currentUtilization - 75) * 50);
      await new Promise(resolve => setTimeout(resolve, safetyDelay));
    } else if (recommendedDelay > 0) {
      await new Promise(resolve => setTimeout(resolve, recommendedDelay));
    }

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

    // Handle token expiration - let batch-level refresh handle this
    if (response.status === 401) {
      throw new Error('unauthorized');
    }

    if (!response.ok) {
      const errorText = await response.text();
      
      // Handle rate limiting errors with exponential backoff
      if (response.status === 429) {
        const retryDelay = Math.min(5000 * Math.pow(2, retryCount), 30000); // 5s, 10s, 20s, 30s max
        console.warn(`⚠️  Rate limit exceeded for video ${videoId}, waiting ${retryDelay}ms before retry ${retryCount + 1}/3`);
        
        if (retryCount < 3) {
          await new Promise(resolve => setTimeout(resolve, retryDelay));
          return await this.makeAnalyticsCall(
            videoId,
            startDate,
            endDate,
            metrics,
            accessToken,
            dimensions,
            refreshTokenCallback,
            retryCount + 1
          );
        } else {
          console.error(`❌ Max retries exceeded for video ${videoId} due to rate limiting`);
          return { rows: [] }; // Give up after 3 retries
        }
      }
      
      // Handle YouTube API 500 errors gracefully - these are temporary backend issues
      if (response.status === 500) {
        console.warn(`⚠️  YouTube API backend error for video ${videoId} (temporary issue):`, {
          status: response.status,
          message: 'YouTube backend error - skipping this video'
        });
        // Return empty result instead of throwing - let the process continue
        return { rows: [] };
      }
      
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

    const backfillStartTime = Date.now();
    const totalProgress: DailyImportProgress = {
      totalVideos: 0,
      processedVideos: 0,
      successfulImports: 0,
      failedImports: 0,
      quotaUsed: 0,
      errors: [],
      startTime: backfillStartTime
    };

    // Process dates sequentially for safer rate limiting (parallel processing caused utilization spikes)
    const maxConcurrentDates = 1;
    const dateChunks = [];
    for (let i = 0; i < dates.length; i += maxConcurrentDates) {
      dateChunks.push(dates.slice(i, i + maxConcurrentDates));
    }

    let currentAccessToken = accessToken;
    
    for (const dateChunk of dateChunks) {
      console.log(`📅 Processing ${dateChunk.length} dates in parallel: ${dateChunk.join(', ')}`);
      
      // Process chunk of dates concurrently
      const chunkPromises = dateChunk.map(async (date) => {
        try {
          return await this.importDailyAnalytics(date, currentAccessToken, progressCallback, refreshTokenCallback);
        } catch (error) {
          console.error(`❌ Failed to process date ${date}:`, error);
          return {
            totalVideos: 0,
            processedVideos: 0,
            successfulImports: 0,
            failedImports: 0,
            quotaUsed: 0,
            errors: [`Failed to process ${date}: ${error}`]
          };
        }
      });

      const chunkResults = await Promise.all(chunkPromises);
      
      // Aggregate results from parallel processing
      for (let i = 0; i < chunkResults.length; i++) {
        const dayProgress = chunkResults[i];
        const date = dateChunk[i];
        
        // Check for auth failures and refresh token if needed
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
      }
    }

    // Generate comprehensive performance report
    await this.generateBackfillReport(totalProgress, dates.length, Date.now() - backfillStartTime);

    return totalProgress;
  }

  /**
   * Generate comprehensive backfill performance report
   */
  private async generateBackfillReport(progress: DailyImportProgress, totalDays: number, totalTimeMs: number): Promise<void> {
    const totalMinutes = totalTimeMs / 60000;
    const totalHours = totalMinutes / 60;
    
    console.log(`\n🎉 HISTORICAL BACKFILL COMPLETE!`);
    console.log(`${'='.repeat(60)}`);
    
    // Basic Stats
    console.log(`\n📊 BASIC METRICS:`);
    console.log(`   Days processed: ${totalDays}`);
    console.log(`   Total video-days: ${progress.processedVideos}`);
    console.log(`   Successful imports: ${progress.successfulImports}`);
    console.log(`   Failed imports: ${progress.failedImports}`);
    console.log(`   Success rate: ${((progress.successfulImports / progress.processedVideos) * 100).toFixed(1)}%`);
    console.log(`   Quota used: ${progress.quotaUsed} units`);
    
    // Performance Analysis
    console.log(`\n⚡ PERFORMANCE ANALYSIS:`);
    console.log(`   Total runtime: ${totalMinutes.toFixed(1)} minutes (${totalHours.toFixed(2)} hours)`);
    console.log(`   Videos per minute: ${(progress.processedVideos / totalMinutes).toFixed(1)}`);
    console.log(`   Videos per hour: ${(progress.processedVideos / totalHours).toFixed(0)}`);
    console.log(`   Average per day: ${(progress.processedVideos / totalDays).toFixed(0)} videos`);
    console.log(`   API calls per minute: ${(progress.quotaUsed / totalMinutes).toFixed(1)}`);
    
    // Rate Limiting Analysis
    const currentUtilization = (this.queryTracker.getQueriesInWindow() / this.maxQueriesPerMinute) * 100;
    const avgUtilization = (progress.quotaUsed / totalMinutes / this.maxQueriesPerMinute) * 100;
    console.log(`\n🎯 RATE LIMITING ANALYSIS:`);
    console.log(`   Current utilization: ${currentUtilization.toFixed(1)}%`);
    console.log(`   Average utilization: ${avgUtilization.toFixed(1)}%`);
    console.log(`   Target utilization: ${(this.targetUtilization * 100).toFixed(0)}%`);
    console.log(`   Rate limit buffer: ${(100 - avgUtilization).toFixed(1)}% unused capacity`);
    console.log(`   Max theoretical: ${this.maxQueriesPerMinute} queries/min`);
    console.log(`   Actual average: ${(progress.quotaUsed / totalMinutes).toFixed(0)} queries/min`);
    
    // Error Analysis
    if (progress.errors.length > 0) {
      console.log(`\n❌ ERROR ANALYSIS:`);
      console.log(`   Total errors: ${progress.errors.length}`);
      console.log(`   Error rate: ${((progress.errors.length / progress.processedVideos) * 100).toFixed(2)}%`);
      
      // Categorize errors
      const errorTypes = new Map<string, number>();
      progress.errors.forEach(error => {
        if (error.includes('429') || error.includes('rate limit')) {
          errorTypes.set('Rate Limiting', (errorTypes.get('Rate Limiting') || 0) + 1);
        } else if (error.includes('401') || error.includes('Unauthorized')) {
          errorTypes.set('Authentication', (errorTypes.get('Authentication') || 0) + 1);
        } else if (error.includes('500')) {
          errorTypes.set('YouTube Backend', (errorTypes.get('YouTube Backend') || 0) + 1);
        } else if (error.includes('No data found')) {
          errorTypes.set('No Data Available', (errorTypes.get('No Data Available') || 0) + 1);
        } else {
          errorTypes.set('Other', (errorTypes.get('Other') || 0) + 1);
        }
      });
      
      console.log(`   Error breakdown:`);
      errorTypes.forEach((count, type) => {
        console.log(`     - ${type}: ${count} (${((count / progress.errors.length) * 100).toFixed(1)}%)`);
      });
      
      if (progress.errors.length <= 10) {
        console.log(`   Recent errors:`);
        progress.errors.slice(-5).forEach((error, i) => {
          console.log(`     ${i + 1}. ${error.slice(0, 80)}${error.length > 80 ? '...' : ''}`);
        });
      }
    }
    
    // Optimization Recommendations
    console.log(`\n🔧 OPTIMIZATION RECOMMENDATIONS:`);
    
    if (avgUtilization < 50) {
      console.log(`   ✅ INCREASE THROUGHPUT: Only using ${avgUtilization.toFixed(1)}% of capacity`);
      console.log(`      → Consider increasing target utilization to 85-90%`);
      console.log(`      → Could process ~${Math.round((0.85 * this.maxQueriesPerMinute) / (progress.quotaUsed / totalMinutes))}x faster`);
    } else if (avgUtilization > 85) {
      console.log(`   ⚠️  REDUCE THROUGHPUT: Using ${avgUtilization.toFixed(1)}% - too aggressive`);
      console.log(`      → Consider reducing target utilization to 70-75%`);
    } else {
      console.log(`   ✅ OPTIMAL UTILIZATION: ${avgUtilization.toFixed(1)}% is well balanced`);
    }
    
    if (progress.failedImports / progress.processedVideos > 0.05) {
      console.log(`   ⚠️  HIGH ERROR RATE: ${((progress.failedImports / progress.processedVideos) * 100).toFixed(1)}% failures`);
      console.log(`      → Consider reducing batch sizes or adding retry logic`);
    }
    
    // Scaling Projections
    console.log(`\n📈 SCALING PROJECTIONS (at current performance):`);
    const videosPerHour = progress.processedVideos / totalHours;
    const hoursFor30Days = (30 * 215) / videosPerHour;
    const hoursFor90Days = (90 * 215) / videosPerHour;
    const hoursFor365Days = (365 * 215) / videosPerHour;
    const hoursFor8Years = (8 * 365 * 215) / videosPerHour;
    
    console.log(`   30 days (6,450 videos): ~${hoursFor30Days.toFixed(1)} hours`);
    console.log(`   90 days (19,350 videos): ~${hoursFor90Days.toFixed(1)} hours`);
    console.log(`   1 year (78,475 videos): ~${hoursFor365Days.toFixed(1)} hours (${(hoursFor365Days/24).toFixed(1)} days)`);
    console.log(`   8 years (627,800 videos): ~${hoursFor8Years.toFixed(0)} hours (${(hoursFor8Years/24).toFixed(0)} days)`);
    
    // Next Run Recommendations
    console.log(`\n🎯 NEXT RUN RECOMMENDATIONS:`);
    if (avgUtilization < 60 && progress.failedImports / progress.processedVideos < 0.02) {
      console.log(`   ✅ SCALE UP: Performance is stable and efficient`);
      console.log(`      → Safe to increase to 30-60 days`);
      console.log(`      → Consider increasing target utilization to 85%`);
    } else if (progress.failedImports / progress.processedVideos > 0.05) {
      console.log(`   ⚠️  OPTIMIZE FIRST: High error rate needs investigation`);
      console.log(`      → Stick with current timeframe until errors are resolved`);
      console.log(`      → Review error patterns above`);
    } else {
      console.log(`   ✅ GRADUAL SCALE: Current settings are working well`);
      console.log(`      → Safe to double the timeframe (${totalDays * 2} days)`);
    }
    
    console.log(`\n💡 SETTINGS FOR NEXT RUN:`);
    console.log(`   Recommended timeframe: ${Math.min(totalDays * 2, 60)} days`);
    console.log(`   Suggested target utilization: ${avgUtilization < 50 ? '85' : avgUtilization > 85 ? '70' : Math.round(this.targetUtilization * 100 + 5)}%`);
    console.log(`   Expected runtime: ~${((Math.min(totalDays * 2, 60) * 215) / videosPerHour).toFixed(1)} hours`);
    
    // Data Coverage Analysis for Smart Recommendations
    await this.analyzeDataCoverage();
    
    console.log(`${'='.repeat(60)}\n`);
  }

  /**
   * Analyze existing data coverage to provide smart backfill recommendations
   */
  private async analyzeDataCoverage(): Promise<void> {
    try {
      const { supabase } = await import('@/lib/supabase-client');
      
      // Get data coverage summary
      const { data: coverageData, error: coverageError } = await supabase
        .from('daily_analytics')
        .select('date')
        .order('date');
      
      if (coverageError) {
        console.log(`\n⚠️  Could not analyze data coverage: ${coverageError.message}`);
        return;
      }
      
      if (!coverageData || coverageData.length === 0) {
        console.log(`\n📊 DATA COVERAGE: No existing data found - starting fresh!`);
        return;
      }
      
      const dates = coverageData.map(d => d.date).sort();
      const oldestDate = dates[0];
      const newestDate = dates[dates.length - 1];
      const uniqueDates = new Set(dates).size;
      
      // Calculate gaps
      const dateRange = [];
      const start = new Date(oldestDate);
      const end = new Date(newestDate);
      
      for (let dt = new Date(start); dt <= end; dt.setDate(dt.getDate() + 1)) {
        dateRange.push(dt.toISOString().split('T')[0]);
      }
      
      const expectedDays = dateRange.length;
      const missingDates = dateRange.filter(date => !dates.includes(date));
      
      console.log(`\n📊 DATA COVERAGE ANALYSIS:`);
      console.log(`   Oldest data: ${oldestDate}`);
      console.log(`   Newest data: ${newestDate}`);
      console.log(`   Days with data: ${uniqueDates}`);
      console.log(`   Expected days in range: ${expectedDays}`);
      console.log(`   Coverage: ${((uniqueDates / expectedDays) * 100).toFixed(1)}%`);
      
      if (missingDates.length > 0) {
        console.log(`   Missing days: ${missingDates.length}`);
        if (missingDates.length <= 10) {
          console.log(`   Missing dates: ${missingDates.join(', ')}`);
        } else {
          console.log(`   Sample missing dates: ${missingDates.slice(0, 5).join(', ')}, ... (+${missingDates.length - 5} more)`);
        }
      }
      
      // Smart recommendations for working backwards
      console.log(`\n🎯 BACKWARD FILL RECOMMENDATIONS:`);
      
      const today = new Date().toISOString().split('T')[0];
      const oldestDateObj = new Date(oldestDate);
      const daysSinceOldest = Math.floor((Date.now() - oldestDateObj.getTime()) / (1000 * 60 * 60 * 24));
      
      if (oldestDate === today || daysSinceOldest < 7) {
        console.log(`   ✅ VERY RECENT DATA: Oldest data is ${daysSinceOldest} days old`);
        console.log(`      → Start with 30-60 days backward from ${oldestDate}`);
        console.log(`      → Safe to use higher utilization (85%+) for recent data`);
      } else if (daysSinceOldest < 30) {
        console.log(`   ✅ RECENT DATA: Oldest data is ${daysSinceOldest} days old`);
        console.log(`      → Start with 60-90 days backward from ${oldestDate}`);
        console.log(`      → Use current utilization settings (75%)`);
      } else if (daysSinceOldest < 365) {
        console.log(`   ⚠️  MODERATE AGE: Oldest data is ${daysSinceOldest} days old`);
        console.log(`      → Start with 90-180 days backward from ${oldestDate}`);
        console.log(`      → Consider reducing utilization to 65-70% for stability`);
      } else {
        console.log(`   ⚠️  OLD DATA: Oldest data is ${daysSinceOldest} days old (${(daysSinceOldest/365).toFixed(1)} years)`);
        console.log(`      → Start with 180-365 days backward from ${oldestDate}`);
        console.log(`      → Use conservative utilization (60-65%) for historical data`);
      }
      
      // Calculate recommended start date
      const suggestedDaysBack = daysSinceOldest < 7 ? 30 : daysSinceOldest < 30 ? 60 : daysSinceOldest < 365 ? 90 : 180;
      const recommendedStartDate = new Date(oldestDateObj);
      recommendedStartDate.setDate(recommendedStartDate.getDate() - suggestedDaysBack);
      const recommendedStart = recommendedStartDate.toISOString().split('T')[0];
      
      console.log(`\n💡 NEXT BACKWARD FILL COMMAND:`);
      console.log(`   Recommended date range: ${recommendedStart} to ${oldestDate}`);
      console.log(`   Duration: ${suggestedDaysBack} days`);
      console.log(`   Estimated videos: ${suggestedDaysBack * 215} video-days`);
      
      // Check if we should fill gaps first
      if (missingDates.length > 0 && missingDates.length < 10) {
        console.log(`\n🔧 FILL GAPS FIRST:`);
        console.log(`   You have ${missingDates.length} missing days in your current range`);
        console.log(`   Consider filling these gaps before going backward:`);
        console.log(`   Missing dates: ${missingDates.join(', ')}`);
      }
      
    } catch (error) {
      console.log(`\n⚠️  Error analyzing data coverage: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
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
    // Use start date for filtering to get accurate count for the earliest date in range
    const videoIds = await this.getVideoIdsForAnalytics(startDate);
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