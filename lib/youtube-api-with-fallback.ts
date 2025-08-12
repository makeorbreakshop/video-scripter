import { quotaTracker } from './youtube-quota-tracker.ts';

export class YouTubeAPIWithFallback {
  private primaryKey: string | null;
  private backupKey: string | null;
  private usingBackup: boolean = false;
  private primaryQuotaExhausted: boolean = false;
  private lastQuotaReset: Date;

  constructor() {
    this.primaryKey = process.env.YOUTUBE_API_KEY || null;
    this.backupKey = process.env.YOUTUBE_API_KEY_BACKUP || null;
    this.lastQuotaReset = this.getLastMidnightPT();
    
    // Check if we've passed midnight PT and should reset
    this.checkQuotaReset();
  }

  /**
   * Get the last midnight Pacific Time
   */
  private getLastMidnightPT(): Date {
    const now = new Date();
    const ptOffset = -8 * 60; // PT is UTC-8 (or UTC-7 during DST, but quotas use standard time)
    const utcHours = now.getUTCHours();
    const utcMinutes = now.getUTCMinutes();
    
    // Convert to PT
    const ptTotalMinutes = (utcHours * 60 + utcMinutes) + ptOffset;
    
    // If it's past midnight PT today, use today's midnight
    // Otherwise use yesterday's midnight
    const midnightPT = new Date(now);
    midnightPT.setUTCHours(8, 0, 0, 0); // Midnight PT is 8 AM UTC
    
    if (now < midnightPT) {
      // Haven't hit midnight yet today, use yesterday's
      midnightPT.setDate(midnightPT.getDate() - 1);
    }
    
    return midnightPT;
  }

  /**
   * Check if we should reset quota status
   */
  private checkQuotaReset() {
    const currentMidnight = this.getLastMidnightPT();
    
    if (currentMidnight > this.lastQuotaReset) {
      console.log('🔄 Midnight PT passed - resetting quota status');
      this.primaryQuotaExhausted = false;
      this.usingBackup = false;
      this.lastQuotaReset = currentMidnight;
    }
  }

  /**
   * Get the current API key to use
   */
  getCurrentKey(): string | null {
    this.checkQuotaReset();
    
    if (!this.primaryKey && !this.backupKey) {
      throw new Error('No YouTube API keys configured');
    }
    
    // Use backup if primary is exhausted and backup exists
    if (this.primaryQuotaExhausted && this.backupKey) {
      if (!this.usingBackup) {
        console.log('🔄 Switching to backup YouTube API key');
        this.usingBackup = true;
      }
      return this.backupKey;
    }
    
    return this.primaryKey;
  }

  /**
   * Make an API request with automatic failover
   */
  async makeRequest(url: string, options: RequestInit = {}): Promise<Response> {
    const currentKey = this.getCurrentKey();
    if (!currentKey) {
      throw new Error('No API key available');
    }

    // Add API key to URL
    const urlWithKey = url.includes('?') 
      ? `${url}&key=${currentKey}`
      : `${url}?key=${currentKey}`;

    const response = await fetch(urlWithKey, options);
    
    // Check for quota exceeded error
    if (response.status === 403) {
      const text = await response.text();
      
      if (text.includes('quotaExceeded') || text.includes('quota')) {
        console.log(`⚠️ Quota exceeded on ${this.usingBackup ? 'backup' : 'primary'} key`);
        
        if (!this.usingBackup && this.backupKey) {
          // Mark primary as exhausted and try backup
          this.primaryQuotaExhausted = true;
          console.log('🔄 Attempting request with backup key...');
          
          // Retry with backup key
          return this.makeRequest(url, options);
        } else if (this.usingBackup) {
          // Both keys exhausted
          console.error('❌ Both API keys have exceeded quota');
          
          // Return the original response so caller knows about quota issue
          return new Response(text, {
            status: 403,
            statusText: 'Quota Exceeded on both keys',
            headers: response.headers
          });
        }
      }
    }
    
    return response;
  }

  /**
   * Helper to make a channels.list request with failover
   */
  async getChannels(channelIds: string[]): Promise<any> {
    const url = `https://www.googleapis.com/youtube/v3/channels?part=snippet,statistics,contentDetails&id=${channelIds.join(',')}`;
    
    const response = await this.makeRequest(url);
    
    if (response.ok) {
      // Track the successful call
      await quotaTracker.trackAPICall('channels.list', {
        description: `Fetch ${channelIds.length} channels (${this.usingBackup ? 'backup' : 'primary'} key)`,
        count: 1
      });
      
      return response.json();
    }
    
    throw new Error(`API request failed: ${response.status}`);
  }

  /**
   * Get status of API keys
   */
  getStatus() {
    return {
      hasPrimary: !!this.primaryKey,
      hasBackup: !!this.backupKey,
      usingBackup: this.usingBackup,
      primaryExhausted: this.primaryQuotaExhausted,
      nextReset: this.getNextMidnightPT()
    };
  }

  /**
   * Get next midnight PT for quota reset
   */
  private getNextMidnightPT(): Date {
    const next = new Date(this.lastQuotaReset);
    next.setDate(next.getDate() + 1);
    return next;
  }
}

// Export singleton instance
export const youtubeAPIWithFallback = new YouTubeAPIWithFallback();