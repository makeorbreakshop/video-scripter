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
      const tierVideos = [];
      let offset = 0;
      const chunkSize = 1000; // Supabase max limit per query
      
      // Fetch in chunks until we reach the tier limit
      while (tierVideos.length < limit) {
        const remainingNeeded = limit - tierVideos.length;
        const currentLimit = Math.min(chunkSize, remainingNeeded);
        
        const { data: chunk, error } = await this.supabase
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
          .range(offset, offset + currentLimit - 1);
        
        if (error) {
          console.error(`Error fetching tier ${tier} videos (offset ${offset}):`, error);
          break;
        }
        
        if (!chunk || chunk.length === 0) {
          // No more videos available for this tier
          break;
        }
        
        tierVideos.push(...chunk);
        offset += chunk.length;
        
        // If we got less than requested, we've exhausted this tier
        if (chunk.length < currentLimit) {
          break;
        }
      }
      
      if (tierVideos.length > 0) {
        // Transform the data to match expected format
        const transformedVideos = tierVideos.slice(0, limit).map(v => ({
          video_id: v.video_id,
          priority_tier: v.priority_tier,
          days_since_published: Math.floor(
            (Date.now() - new Date(v.videos.published_at).getTime()) / (1000 * 60 * 60 * 24)
          )
        }));
        
        allVideosToTrack.push(...transformedVideos);
        console.log(`Tier ${tier}: fetched ${transformedVideos.length} videos (requested ${limit})`);
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

        // REMOVED: Update videos table - just track snapshots for now

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
   * Update all videos that haven't been tracked in the last 24 hours
   * This is for bootstrapping or catching up on tracking
   */
  async updateAllStaleVideos(hoursThreshold: number = 24, jobId?: string) {
    // If hoursThreshold is 0, filter by current date only (no time-based filtering)
    const useCurrentDateOnly = hoursThreshold === 0;
    const filterDescription = useCurrentDateOnly ? 'today' : `the last ${hoursThreshold} hours`;
    
    console.log(`Starting update for all videos not tracked ${filterDescription}...`);
    
    try {
      let cutoffDateStr: string;
      
      if (useCurrentDateOnly) {
        // Filter by current date only (YYYY-MM-DD format)
        cutoffDateStr = new Date().toISOString().split('T')[0];
      } else {
        // Use time-based filtering (original behavior)
        const cutoffDate = new Date();
        cutoffDate.setHours(cutoffDate.getHours() - hoursThreshold);
        cutoffDateStr = cutoffDate.toISOString();
      }
      
      // Get total count of videos
      const { count: totalVideos } = await this.supabase
        .from('videos')
        .select('*', { count: 'exact', head: true });
      
      // Get count of videos with recent snapshots
      const snapshotQuery = this.supabase
        .from('view_snapshots')
        .select('video_id', { count: 'exact', head: true });
      
      if (useCurrentDateOnly) {
        snapshotQuery.eq('snapshot_date', cutoffDateStr);
      } else {
        snapshotQuery.gte('snapshot_date', cutoffDateStr);
      }
      
      const { count: recentCount } = await snapshotQuery;
      
      const totalCount = (totalVideos || 0) - (recentCount || 0);
      
      console.log(`Found ${totalCount} videos needing updates`);
      
      // Process in batches of 50 (API limit)
      const batchSize = 50;
      const CONCURRENT_BATCHES = 5; // Process 5 batches in parallel
      let totalProcessed = 0;
      
      // Get all videos that need updates (in chunks to avoid memory issues)
      const allVideosToProcess = [];
      const chunkSize = 5000;
      
      for (let offset = 0; offset < (totalVideos || 0); offset += chunkSize) {
        // Check if job was cancelled
        if (jobId) {
          const { data: job } = await this.supabase
            .from('jobs')
            .select('status')
            .eq('id', jobId)
            .single();
          
          if (job?.status === 'failed') {
            console.log('Job cancellation requested, stopping...');
            throw new Error('Job cancelled by user');
          }
        }
        
        const { data: videos } = await this.supabase
          .from('videos')
          .select(`
            id,
            published_at,
            view_count
          `)
          .range(offset, Math.min(offset + chunkSize - 1, (totalVideos || 0) - 1))
          .order('published_at', { ascending: false });
        
        if (videos) {
          allVideosToProcess.push(...videos);
        }
      }
      
      // Get recent snapshots to filter out
      const recentSnapshotsQuery = this.supabase
        .from('view_snapshots')
        .select('video_id');
      
      if (useCurrentDateOnly) {
        recentSnapshotsQuery.eq('snapshot_date', cutoffDateStr);
      } else {
        recentSnapshotsQuery.gte('snapshot_date', cutoffDateStr);
      }
      
      const { data: recentSnapshots } = await recentSnapshotsQuery;
      
      const recentVideoIds = new Set(recentSnapshots?.map(s => s.video_id) || []);
      
      // Filter videos that need processing
      const videosToTrack = allVideosToProcess
        .filter(v => !recentVideoIds.has(v.id))
        .map(v => ({
          video_id: v.id,
          priority_tier: 1,
          days_since_published: Math.floor(
            (Date.now() - new Date(v.published_at).getTime()) / (1000 * 60 * 60 * 24)
          )
        }));
      
      console.log(`Processing ${videosToTrack.length} videos in parallel batches of ${CONCURRENT_BATCHES}...`);
      
      // Process in parallel batches
      for (let i = 0; i < videosToTrack.length; i += batchSize * CONCURRENT_BATCHES) {
        // Check if job was cancelled
        if (jobId) {
          const { data: job } = await this.supabase
            .from('jobs')
            .select('status')
            .eq('id', jobId)
            .single();
          
          if (job?.status === 'failed') {
            console.log('Job cancellation requested, stopping...');
            throw new Error('Job cancelled by user');
          }
        }
        
        // Create concurrent batch promises
        const batchPromises = [];
        
        for (let j = 0; j < CONCURRENT_BATCHES; j++) {
          const start = i + j * batchSize;
          const end = Math.min(start + batchSize, videosToTrack.length);
          
          if (start < videosToTrack.length) {
            const batch = videosToTrack.slice(start, end);
            if (batch.length > 0) {
              batchPromises.push(this.processBatch(batch));
            }
          }
        }
        
        // Process all batches in parallel
        await Promise.all(batchPromises);
        
        totalProcessed += batchPromises.length * batchSize;
        const actualProcessed = Math.min(totalProcessed, videosToTrack.length);
        
        // Update job progress
        if (jobId) {
          await this.supabase
            .from('jobs')
            .update({
              data: {
                progress: Math.round((actualProcessed / videosToTrack.length) * 100),
                videosProcessed: actualProcessed,
                totalVideos: videosToTrack.length
              },
              updated_at: new Date().toISOString()
            })
            .eq('id', jobId);
        }
        
        // Progress update
        if (actualProcessed % 1000 === 0 || actualProcessed === videosToTrack.length) {
          console.log(`Processed ${actualProcessed}/${videosToTrack.length} videos (${Math.round((actualProcessed / videosToTrack.length) * 100)}%)...`);
        }
      }
      
      console.log(`Update complete! Processed ${videosToTrack.length} videos`);
      return videosToTrack.length;
      
    } catch (error) {
      console.error('Error in updateAllStaleVideos:', error);
      throw error;
    }
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