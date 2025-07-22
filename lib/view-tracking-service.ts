import { createClient } from '@supabase/supabase-js';
import { Database } from '@/types/database';
import { YouTubeQuotaTracker } from './youtube-quota-tracker';

export class ViewTrackingService {
  private supabase;
  private quotaTracker: YouTubeQuotaTracker;
  private youtubeApiKey: string;
  
  constructor() {
    this.supabase = createClient<Database>(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );
    this.quotaTracker = new YouTubeQuotaTracker(this.supabase);
    this.youtubeApiKey = process.env.YOUTUBE_API_KEY!;
  }

  /**
   * Main method to track views for prioritized videos
   * Efficiently uses YouTube API batch endpoints
   */
  async trackDailyViews(maxApiCalls: number = 2000) {
    console.log(`Starting daily view tracking with ${maxApiCalls} API calls (${maxApiCalls * 50} videos)`);
    
    // Check quota availability
    const quotaAvailable = await this.quotaTracker.checkQuotaAvailable(maxApiCalls);
    if (!quotaAvailable) {
      console.error('Insufficient YouTube API quota for view tracking');
      return;
    }

    // Get videos to track from the database
    // Calculate tier limits
    const totalQuota = maxApiCalls * 50;
    const tierLimits = {
      1: Math.floor(totalQuota * 0.25),
      2: Math.floor(totalQuota * 0.20),
      3: Math.floor(totalQuota * 0.20),
      4: Math.floor(totalQuota * 0.15),
      5: Math.floor(totalQuota * 0.15),
      6: Math.floor(totalQuota * 0.05)
    };
    
    console.log(`Requesting videos with quota: ${totalQuota}`, tierLimits);
    
    // Fetch videos for each tier separately to avoid RPC row limits
    const allVideosToTrack = [];
    
    for (const [tier, limit] of Object.entries(tierLimits)) {
      const tierNum = parseInt(tier);
      
      const { data: tierVideos, error } = await this.supabase
        .from('view_tracking_priority')
        .select(`
          video_id,
          priority_tier,
          videos!inner(
            published_at,
            view_count
          )
        `)
        .eq('priority_tier', tierNum)
        .or('next_track_date.is.null,next_track_date.lte.today()')
        .order('videos(published_at)', { ascending: false })
        .limit(limit);
      
      if (error) {
        console.error(`Error fetching tier ${tier} videos:`, error);
        continue;
      }
      
      if (tierVideos) {
        // Transform the data to match expected format
        const transformedVideos = tierVideos.map(v => ({
          video_id: v.video_id,
          priority_tier: v.priority_tier,
          days_since_published: Math.floor(
            (Date.now() - new Date(v.videos.published_at).getTime()) / (1000 * 60 * 60 * 24)
          )
        }));
        
        allVideosToTrack.push(...transformedVideos);
        console.log(`Tier ${tier}: fetched ${tierVideos.length} videos`);
      }
    }
    
    const videosToTrack = allVideosToTrack;

    console.log(`Found ${videosToTrack.length} videos to track`);
    console.log(`Requested up to ${maxApiCalls * 50} videos (${maxApiCalls} API calls)`);

    // Process in batches of 50
    const batchSize = 50;
    let totalProcessed = 0;
    
    for (let i = 0; i < videosToTrack.length; i += batchSize) {
      const batch = videosToTrack.slice(i, i + batchSize);
      await this.processBatch(batch);
      totalProcessed += batch.length;
      
      // Log progress every 1000 videos
      if (totalProcessed % 1000 === 0) {
        console.log(`Processed ${totalProcessed}/${videosToTrack.length} videos`);
      }
      
      // Add small delay every 100 batches (5,000 videos) to avoid any potential rate limiting
      if (i > 0 && i % (100 * batchSize) === 0) {
        console.log('Pausing for 1 second to avoid rate limits...');
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }

    console.log(`View tracking complete. Processed ${totalProcessed} videos`);
  }

  /**
   * Process a batch of up to 50 videos in a single API call
   */
  private async processBatch(videos: any[]) {
    const videoIds = videos.map(v => v.video_id).join(',');
    
    try {
      // Fetch current stats from YouTube
      const response = await fetch(
        `https://www.googleapis.com/youtube/v3/videos?` +
        `part=statistics&` +
        `id=${videoIds}&` +
        `key=${this.youtubeApiKey}`
      );

      if (!response.ok) {
        throw new Error(`YouTube API error: ${response.statusText}`);
      }

      const data = await response.json();
      
      // Track quota usage
      await this.quotaTracker.trackAPICall('videos.list', {
        description: `View tracking for ${videos.length} videos`,
        count: 1
      });

      // Get previous snapshots for all videos in this batch for rate calculation
      const videoIdsArray = data.items.map(item => item.id);
      const today = new Date().toISOString().split('T')[0];
      
      // Fetch most recent snapshots for all videos in one query
      const { data: previousSnapshots } = await this.supabase
        .from('view_snapshots')
        .select('video_id, view_count, snapshot_date')
        .in('video_id', videoIdsArray)
        .lt('snapshot_date', today)
        .order('snapshot_date', { ascending: false });
      
      // Group by video_id and keep only the most recent for each
      const latestSnapshots = new Map();
      if (previousSnapshots) {
        for (const snapshot of previousSnapshots) {
          if (!latestSnapshots.has(snapshot.video_id)) {
            latestSnapshots.set(snapshot.video_id, snapshot);
          }
        }
      }
      
      // Process results and insert snapshots
      const snapshots = [];
      
      for (const video of data.items) {
        const originalVideo = videos.find(v => v.video_id === video.id);
        if (!originalVideo) continue;

        const viewCount = parseInt(video.statistics.viewCount || '0');
        const likeCount = parseInt(video.statistics.likeCount || '0');
        const commentCount = parseInt(video.statistics.commentCount || '0');
        
        // Calculate daily growth rate if we have a previous snapshot
        let dailyViewsRate = null;
        const previousSnapshot = latestSnapshots.get(video.id);
        
        if (previousSnapshot && previousSnapshot.view_count) {
          const viewsGained = viewCount - previousSnapshot.view_count;
          const daysBetween = Math.ceil(
            (new Date(today).getTime() - new Date(previousSnapshot.snapshot_date).getTime()) / (1000 * 60 * 60 * 24)
          );
          if (daysBetween > 0) {
            dailyViewsRate = Math.round(viewsGained / daysBetween);
            
            // Debug logging to trace the calculation
            if (video.id === '6cSq6QxvKRo') {
              console.log('Debug daily_views_rate calculation:', {
                video_id: video.id,
                viewCount,
                previousViewCount: previousSnapshot.view_count,
                viewsGained,
                daysBetween,
                calculatedDailyRate: dailyViewsRate,
                expectedRate: Math.round(viewsGained / daysBetween),
                checkCalculation: viewsGained / daysBetween,
                roundedCheck: Math.round(viewsGained / daysBetween)
              });
              
              // Extra check
              console.log('Variable check:', {
                viewsGainedType: typeof viewsGained,
                daysBetweenType: typeof daysBetween,
                dailyViewsRateType: typeof dailyViewsRate,
                isCorrect: dailyViewsRate === Math.round(viewsGained / daysBetween)
              });
            }
          }
        }

        // Debug logging before push
        if (video.id === '6cSq6QxvKRo' && dailyViewsRate !== null) {
          console.log('Before push - dailyViewsRate:', dailyViewsRate);
        }
        
        snapshots.push({
          video_id: video.id,
          snapshot_date: today,
          view_count: viewCount,
          like_count: likeCount,
          comment_count: commentCount,
          days_since_published: originalVideo.days_since_published,
          daily_views_rate: dailyViewsRate
        });
      }

      // Bulk insert snapshots
      if (snapshots.length > 0) {
        // Debug: Log what we're about to insert
        const debugSnapshot = snapshots.find(s => s.video_id === '6cSq6QxvKRo');
        if (debugSnapshot) {
          console.log('About to upsert snapshot:', debugSnapshot);
        }
        
        const { error: insertError } = await this.supabase
          .from('view_snapshots')
          .upsert(snapshots, { onConflict: 'video_id,snapshot_date' });

        if (insertError) {
          console.error('Error inserting snapshots:', insertError);
        }

        // Update tracking dates
        const videoIds = snapshots.map(s => s.video_id);
        const { error: updateError } = await this.supabase
          .from('view_tracking_priority')
          .update({
            last_tracked: today,
            next_track_date: this.calculateNextTrackDate(videos[0].priority_tier),
            updated_at: new Date().toISOString()
          })
          .in('video_id', videoIds);

        if (updateError) {
          console.error('Error updating tracking dates:', updateError);
        }
      }
    } catch (error) {
      console.error('Error processing batch:', error);
    }
  }

  /**
   * Calculate next tracking date based on priority tier
   */
  private calculateNextTrackDate(priorityTier: number): string {
    let daysToAdd: number;
    
    switch (priorityTier) {
      case 1: daysToAdd = 1; break;     // Daily
      case 2: daysToAdd = 2; break;     // Every 2 days
      case 3: daysToAdd = 3; break;     // Every 3 days
      case 4: daysToAdd = 7; break;     // Weekly
      case 5: daysToAdd = 14; break;    // Every 2 weeks
      case 6: daysToAdd = 30; break;    // Monthly
      default: daysToAdd = 30; break;   // Default to monthly
    }
    
    const nextDate = new Date();
    nextDate.setDate(nextDate.getDate() + daysToAdd);
    return nextDate.toISOString().split('T')[0];
  }

  /**
   * Initialize tracking priorities for all videos
   * Run this once to set up the system
   */
  async initializeTrackingPriorities() {
    console.log('Initializing tracking priorities for all videos...');
    
    const { error } = await this.supabase.rpc('update_all_tracking_priorities');
    
    if (error) {
      console.error('Error initializing priorities:', error);
    } else {
      console.log('Tracking priorities initialized successfully');
    }
  }

  /**
   * Get tracking statistics
   */
  async getTrackingStats() {
    const { data, error } = await this.supabase
      .from('view_tracking_priority')
      .select('priority_tier')
      .order('priority_tier');

    if (error) {
      console.error('Error getting tracking stats:', error);
      return null;
    }

    const stats = data.reduce((acc, row) => {
      acc[`tier_${row.priority_tier}`] = (acc[`tier_${row.priority_tier}`] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);

    return {
      ...stats,
      total: data.length
    };
  }
}

export default ViewTrackingService;