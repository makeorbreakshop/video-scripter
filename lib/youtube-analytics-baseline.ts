/**
 * YouTube Analytics API Baseline Collection Service
 * 
 * Collects lifetime cumulative analytics data for all videos from publication date to present.
 * Uses Analytics API for historical totals (329 quota units one-time investment).
 * Stores results in baseline_analytics table with same 43-field schema as daily_analytics.
 */

interface BaselineAnalyticsData {
  video_id: string;
  baseline_date: string;
  views: number;
  engaged_views: number;
  estimated_minutes_watched: number;
  average_view_percentage: number;
  likes: number;
  comments: number;
  shares: number;
  subscribers_gained: number;
  subscribers_lost: number;
  estimated_revenue: number;
  estimated_ad_revenue: number;
  cpm: number;
  monetized_playbacks: number;
  playback_based_cpm: number;
  ad_impressions: number;
  country_views: Record<string, number>;
  top_age_groups: Record<string, number>;
  gender_breakdown: Record<string, number>;
  mobile_views: number;
  desktop_views: number;
  tablet_views: number;
  tv_views: number;
  search_views: number;
  suggested_views: number;
  external_views: number;
  direct_views: number;
  channel_views: number;
  playlist_views: number;
  cards_impressions: number;
  cards_clicks: number;
  cards_click_rate: number;
  end_screen_impressions: number;
  end_screen_clicks: number;
  end_screen_click_rate: number;
  red_views: number;
  red_watch_time_minutes: number;
  annotation_impressions: number;
  annotation_clicks: number;
  annotation_click_rate: number;
}

interface BaselineCollectionProgress {
  isRunning: boolean;
  totalVideos: number;
  processedVideos: number;
  successfulVideos: number;
  failedVideos: number;
  currentVideo: string;
  quotaUsed: number;
  errors: string[];
  estimatedTimeRemaining: string;
}

export class YouTubeAnalyticsBaseline {
  private baseUrl = 'https://youtubeanalytics.googleapis.com/v2/reports';
  private channelId = 'UCjWkNxpp3UHdEavpM_19--Q'; // Make or Break Shop channel

  /**
   * Get lifetime analytics for a single video (publication date → today)
   */
  async getVideoBaselineAnalytics(
    videoId: string,
    publishedDate: string,
    accessToken: string
  ): Promise<BaselineAnalyticsData> {
    const today = new Date().toISOString().split('T')[0];
    
    try {
      // Core metrics call
      const coreMetrics = await this.makeAnalyticsCall(
        videoId,
        publishedDate,
        today,
        'views,estimatedMinutesWatched,averageViewDuration,averageViewPercentage,likes,comments,shares,subscribersGained,subscribersLost',
        accessToken
      );

      // Revenue metrics call (may not be available for all videos)
      const revenueMetrics = await this.makeAnalyticsCall(
        videoId,
        publishedDate,
        today,
        'estimatedRevenue,estimatedAdRevenue',
        accessToken
      ).catch(() => ({ rows: [[0, 0]] })); // Fallback to zeros

      // Geographic data
      const geoData = await this.makeAnalyticsCall(
        videoId,
        publishedDate,
        today,
        'views',
        accessToken,
        'country'
      ).catch(() => ({ rows: [] }));

      // Device data
      const deviceData = await this.makeAnalyticsCall(
        videoId,
        publishedDate,
        today,
        'views',
        accessToken,
        'deviceType'
      ).catch(() => ({ rows: [] }));

      // Traffic source data
      const trafficData = await this.makeAnalyticsCall(
        videoId,
        publishedDate,
        today,
        'views',
        accessToken,
        'trafficSourceType'
      ).catch(() => ({ rows: [] }));

      // Parse core metrics
      const coreRow = coreMetrics.rows?.[0] || [];
      const revenueRow = revenueMetrics.rows?.[0] || [];

      // Transform geographic data
      const countryViews: Record<string, number> = {};
      geoData.rows?.forEach((row: any[]) => {
        if (row[0] && row[1]) {
          countryViews[row[0]] = row[1];
        }
      });

      // Transform device data
      let mobileViews = 0, desktopViews = 0, tabletViews = 0, tvViews = 0;
      deviceData.rows?.forEach((row: any[]) => {
        const deviceType = row[0]?.toLowerCase();
        const views = row[1] || 0;
        if (deviceType === 'mobile') mobileViews = views;
        else if (deviceType === 'desktop') desktopViews = views;
        else if (deviceType === 'tablet') tabletViews = views;
        else if (deviceType === 'tv') tvViews = views;
      });

      // Transform traffic source data
      let searchViews = 0, suggestedViews = 0, externalViews = 0, directViews = 0;
      trafficData.rows?.forEach((row: any[]) => {
        const trafficType = row[0];
        const views = row[1] || 0;
        // YouTube Analytics API traffic source mappings
        if (trafficType === 1) searchViews = views; // YouTube search
        else if (trafficType === 2) suggestedViews = views; // Suggested videos
        else if (trafficType === 3) externalViews = views; // External sources
        else if (trafficType === 4) directViews = views; // Direct/channel
      });

      return {
        video_id: videoId,
        baseline_date: today,
        // Core metrics
        views: coreRow[0] || 0,
        engaged_views: 0, // Not available in Analytics API
        estimated_minutes_watched: coreRow[1] || 0,
        average_view_percentage: coreRow[3] || 0,
        likes: coreRow[4] || 0,
        comments: coreRow[5] || 0,
        shares: coreRow[6] || 0,
        subscribers_gained: coreRow[7] || 0,
        subscribers_lost: coreRow[8] || 0,
        // Revenue metrics (simplified to documented metrics only)
        estimated_revenue: revenueRow[0] || 0,
        estimated_ad_revenue: revenueRow[1] || 0,
        cpm: 0, // Not available in simplified call
        monetized_playbacks: 0, // Not available in simplified call
        playback_based_cpm: 0, // Not available in simplified call
        ad_impressions: 0, // Not available in simplified call
        // Geographic and demographic (limited in Analytics API)
        country_views: countryViews,
        top_age_groups: {}, // Not easily available
        gender_breakdown: {}, // Not easily available
        // Device analytics
        mobile_views: mobileViews,
        desktop_views: desktopViews,
        tablet_views: tabletViews,
        tv_views: tvViews,
        // Traffic sources
        search_views: searchViews,
        suggested_views: suggestedViews,
        external_views: externalViews,
        direct_views: directViews,
        channel_views: 0, // Will be calculated from direct
        playlist_views: 0, // Not easily available
        // Engagement patterns (limited availability)
        cards_impressions: 0,
        cards_clicks: 0,
        cards_click_rate: 0,
        end_screen_impressions: 0,
        end_screen_clicks: 0,
        end_screen_click_rate: 0,
        // Advanced metrics (limited availability)
        red_views: 0,
        red_watch_time_minutes: 0,
        annotation_impressions: 0,
        annotation_clicks: 0,
        annotation_click_rate: 0
      };

    } catch (error) {
      console.error(`Error getting baseline analytics for video ${videoId}:`, error);
      throw error;
    }
  }

  /**
   * Make a YouTube Analytics API call
   */
  private async makeAnalyticsCall(
    videoId: string,
    startDate: string,
    endDate: string,
    metrics: string,
    accessToken: string,
    dimensions?: string
  ): Promise<any> {
    const url = new URL(this.baseUrl);
    url.searchParams.append('ids', `channel==${this.channelId}`);
    url.searchParams.append('startDate', startDate);
    url.searchParams.append('endDate', endDate);
    url.searchParams.append('metrics', metrics);
    url.searchParams.append('filters', `video==${videoId}`);
    
    if (dimensions) {
      url.searchParams.append('dimensions', dimensions);
    }

    const response = await fetch(url.toString(), {
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Accept': 'application/json'
      }
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Analytics API error ${response.status}: ${errorText}`);
    }

    return response.json();
  }

  /**
   * Collect baseline analytics for all videos in the database
   */
  async collectAllBaselines(
    accessToken: string,
    onProgress?: (progress: BaselineCollectionProgress) => void,
    videoIds?: string[]
  ): Promise<BaselineAnalyticsData[]> {
    // Get all videos from database
    const { supabase } = await import('@/lib/supabase-client');
    
    // Handle test mode with limited videos
    let query = supabase
      .from('videos')
      .select('id, published_at')
      .order('published_at');
    
    // If videoIds contains 'test', limit to first 5 videos for testing
    if (videoIds?.includes('test')) {
      query = query.limit(5);
    } else if (videoIds?.length) {
      query = query.in('id', videoIds);
    }

    const { data: videos, error: videosError } = await query;

    if (videosError) {
      throw new Error(`Failed to fetch videos: ${videosError.message}`);
    }

    if (!videos?.length) {
      throw new Error('No videos found in database');
    }

    const results: BaselineAnalyticsData[] = [];
    const progress: BaselineCollectionProgress = {
      isRunning: true,
      totalVideos: videos.length,
      processedVideos: 0,
      successfulVideos: 0,
      failedVideos: 0,
      currentVideo: '',
      quotaUsed: 0,
      errors: [],
      estimatedTimeRemaining: 'Calculating...'
    };

    const startTime = Date.now();
    const batchSize = 10; // Process 10 videos in parallel for speed

    // Process videos in batches for better performance
    for (let i = 0; i < videos.length; i += batchSize) {
      const batch = videos.slice(i, i + batchSize);
      console.log(`📦 Processing batch ${Math.floor(i/batchSize) + 1}/${Math.ceil(videos.length/batchSize)}: ${batch.length} videos`);
      
      // Process batch in parallel
      const batchPromises = batch.map(async (video) => {
        try {
          const publishedDate = new Date(video.published_at).toISOString().split('T')[0];
          const baselineData = await this.getVideoBaselineAnalytics(
            video.id,
            publishedDate,
            accessToken
          );
          return { success: true, data: baselineData, video };
        } catch (error) {
          console.error(`Failed to get baseline for video ${video.id}:`, error);
          return { 
            success: false, 
            error: error instanceof Error ? error.message : 'Unknown error',
            video 
          };
        }
      });

      // Wait for batch to complete
      const batchResults = await Promise.all(batchPromises);
      
      // Process results and update progress
      for (const result of batchResults) {
        progress.processedVideos++;
        progress.currentVideo = result.video.id;
        
        if (result.success) {
          results.push(result.data);
          progress.successfulVideos++;
          progress.quotaUsed += 5;
        } else {
          progress.failedVideos++;
          progress.errors.push(`Video ${result.video.id}: ${result.error}`);
        }
      }

      // Calculate estimated time remaining
      if (progress.processedVideos > 0) {
        const elapsed = Date.now() - startTime;
        const avgTimePerVideo = elapsed / progress.processedVideos;
        const remaining = (progress.totalVideos - progress.processedVideos) * avgTimePerVideo;
        progress.estimatedTimeRemaining = `${Math.round(remaining / 60000)} minutes`;
      }

      onProgress?.(progress);

      // Small delay between batches to respect rate limits
      if (i + batchSize < videos.length) {
        await new Promise(resolve => setTimeout(resolve, 500));
      }
    }

    progress.isRunning = false;
    progress.estimatedTimeRemaining = 'Complete';
    onProgress?.(progress);

    return results;
  }

  /**
   * Save baseline analytics to database
   */
  async saveBaselines(baselines: BaselineAnalyticsData[]): Promise<void> {
    const { supabase } = await import('@/lib/supabase-client');

    // Batch insert with upsert logic
    const { error } = await supabase
      .from('baseline_analytics')
      .upsert(baselines, {
        onConflict: 'video_id,baseline_date',
        ignoreDuplicates: false
      });

    if (error) {
      throw new Error(`Failed to save baselines: ${error.message}`);
    }
  }

  /**
   * Get existing baseline data for analysis
   */
  async getExistingBaselines(videoIds?: string[]): Promise<BaselineAnalyticsData[]> {
    const { supabase } = await import('@/lib/supabase-client');

    let query = supabase
      .from('baseline_analytics')
      .select('*')
      .order('baseline_date', { ascending: false });

    if (videoIds?.length) {
      query = query.in('video_id', videoIds);
    }

    const { data, error } = await query;

    if (error) {
      throw new Error(`Failed to fetch baselines: ${error.message}`);
    }

    return data || [];
  }
}

export const youtubeAnalyticsBaseline = new YouTubeAnalyticsBaseline();