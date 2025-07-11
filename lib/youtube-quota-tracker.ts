import { createClient } from '@supabase/supabase-js';

interface QuotaStatus {
  date: string;
  quota_used: number;
  quota_limit: number;
  quota_remaining: number;
  percentage_used: number;
}

interface QuotaEstimate {
  channelCalls: number;
  playlistCalls: number;
  videoCalls: number;
  searchCalls: number;
  total: number;
}

export class YouTubeQuotaTracker {
  private supabase;
  
  // Official YouTube API quota costs
  static readonly QUOTA_COSTS = {
    'channels.list': 1,
    'playlistItems.list': 1,
    'videos.list': 1,
    'search.list': 100,
    'commentThreads.list': 1,
    'comments.list': 1,
    'subscriptions.list': 1,
    'activities.list': 1,
    'channelSections.list': 1,
    'guideCategories.list': 1,
    'playlists.list': 1,
    'videoCategories.list': 1,
    'videos.insert': 1600,
    'videos.update': 50,
    'videos.delete': 50,
    'playlists.insert': 50,
    'playlists.update': 50,
    'playlists.delete': 50,
    'playlistItems.insert': 50,
    'playlistItems.update': 50,
    'playlistItems.delete': 50
  } as const;

  constructor() {
    this.supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );
  }

  /**
   * Track a YouTube API call
   */
  async trackAPICall(
    method: keyof typeof YouTubeQuotaTracker.QUOTA_COSTS,
    options: {
      description?: string;
      jobId?: string;
      count?: number;
    } = {}
  ): Promise<number> {
    const { description, jobId, count = 1 } = options;
    const cost = YouTubeQuotaTracker.QUOTA_COSTS[method] * count;
    
    try {
      const { error } = await this.supabase.rpc('log_youtube_api_call', {
        method,
        cost,
        description,
        job_id: jobId
      });
      
      if (error) {
        console.error('Failed to track API call:', error);
        return cost;
      }
      
      console.log(`📊 YouTube API: ${method} (${count}x) = ${cost} quota units`);
      return cost;
    } catch (error) {
      console.error('Error tracking API call:', error);
      return cost;
    }
  }

  /**
   * Check if we have enough quota remaining
   */
  async checkQuotaAvailable(estimatedCost: number): Promise<boolean> {
    try {
      const { data, error } = await this.supabase.rpc('check_quota_available', {
        estimated_cost: estimatedCost
      });
      
      if (error) {
        console.error('Error checking quota:', error);
        return false;
      }
      
      return data as boolean;
    } catch (error) {
      console.error('Error checking quota availability:', error);
      return false;
    }
  }

  /**
   * Get current quota status
   */
  async getQuotaStatus(): Promise<QuotaStatus | null> {
    try {
      const { data, error } = await this.supabase.rpc('get_quota_status');
      
      if (error) {
        console.error('Error getting quota status:', error);
        return null;
      }
      
      return data as QuotaStatus;
    } catch (error) {
      console.error('Error getting quota status:', error);
      return null;
    }
  }

  /**
   * Estimate quota cost for importing a channel
   */
  async estimateChannelQuota(channelId: string): Promise<QuotaEstimate> {
    try {
      // First get channel info to estimate video count
      const channelCost = await this.trackAPICall('channels.list', {
        description: `Estimate quota for channel ${channelId}`,
        count: 1
      });
      
      // Make actual API call to get video count
      const response = await fetch(
        `https://www.googleapis.com/youtube/v3/channels?part=statistics&id=${channelId}&key=${process.env.YOUTUBE_API_KEY}`
      );
      
      if (!response.ok) {
        throw new Error(`Failed to fetch channel info: ${response.statusText}`);
      }
      
      const data = await response.json();
      const videoCount = parseInt(data.items?.[0]?.statistics?.videoCount || '0');
      
      // Estimate based on video count
      const estimate: QuotaEstimate = {
        channelCalls: 2, // channel details + stats
        playlistCalls: Math.ceil(videoCount / 50), // 50 videos per playlist page
        videoCalls: Math.ceil(videoCount / 50), // batched video details (50 per call)
        searchCalls: 0, // shouldn't be using search
        total: 0
      };
      
      estimate.total = estimate.channelCalls + estimate.playlistCalls + estimate.videoCalls + estimate.searchCalls;
      
      console.log(`📊 Channel ${channelId} quota estimate:`, estimate);
      return estimate;
      
    } catch (error) {
      console.error('Error estimating channel quota:', error);
      
      // Return conservative estimate
      return {
        channelCalls: 2,
        playlistCalls: 10,
        videoCalls: 10,
        searchCalls: 0,
        total: 22
      };
    }
  }

  /**
   * Get today's API call breakdown
   */
  async getCallBreakdown(): Promise<any[]> {
    try {
      const { data, error } = await this.supabase
        .from('youtube_quota_calls')
        .select('*')
        .eq('date', new Date().toISOString().split('T')[0])
        .order('created_at', { ascending: false });
      
      if (error) {
        console.error('Error getting call breakdown:', error);
        return [];
      }
      
      return data || [];
    } catch (error) {
      console.error('Error getting call breakdown:', error);
      return [];
    }
  }

  /**
   * Get quota usage summary for recent days
   */
  async getUsageSummary(days: number = 7): Promise<any[]> {
    try {
      const { data, error } = await this.supabase
        .from('quota_daily_summary')
        .select('*')
        .order('date', { ascending: false })
        .limit(days);
      
      if (error) {
        console.error('Error getting usage summary:', error);
        return [];
      }
      
      return data || [];
    } catch (error) {
      console.error('Error getting usage summary:', error);
      return [];
    }
  }

  /**
   * Log a detailed API operation for debugging
   */
  async logAPIOperation(operation: string, details: any, jobId?: string): Promise<void> {
    console.log(`🔍 YouTube API Operation: ${operation}`, details);
    
    // You can extend this to log to a separate debugging table if needed
    if (jobId) {
      await this.trackAPICall('channels.list', {
        description: `${operation}: ${JSON.stringify(details)}`,
        jobId,
        count: 0 // Don't count this as quota usage
      });
    }
  }
}

// Singleton instance
export const quotaTracker = new YouTubeQuotaTracker();