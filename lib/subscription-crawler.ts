// Subscription Network Crawler Service
// Discovers new channels through subscription network mapping

import { supabase } from './supabase-client.ts';
import type { SubscriptionResult, ChannelValidationResult } from './youtube-discovery-api.ts';
import { youtubeDiscoveryAPI } from './youtube-discovery-api.ts';

export interface CrawlResult {
  sourceChannelId: string;
  channelsDiscovered: number;
  channelsValidated: number;
  channelsFiltered: number;
  quotaUsed: number;
  errors: string[];
}

export interface CrawlSession {
  id: string;
  totalChannels: number;
  processedChannels: number;
  channelsDiscovered: number;
  quotaUsed: number;
  status: 'running' | 'completed' | 'failed' | 'paused';
  startTime: Date;
  endTime?: Date;
  errors: string[];
}

export interface ValidationCriteria {
  minSubscribers: number;
  minVideos: number;
  maxAgeDays: number;
  excludeExisting: boolean;
}

export class SubscriptionCrawler {
  private session: CrawlSession | null = null;
  private defaultCriteria: ValidationCriteria = {
    minSubscribers: 1000,
    minVideos: 10,
    maxAgeDays: 180, // Active within last 6 months
    excludeExisting: true
  };

  /**
   * Starts a new crawl session for the given source channels
   */
  async startCrawlSession(
    sourceChannelIds: string[],
    criteria: Partial<ValidationCriteria> = {}
  ): Promise<CrawlSession> {
    if (this.session && this.session.status === 'running') {
      throw new Error('Crawl session already in progress');
    }

    const mergedCriteria = { ...this.defaultCriteria, ...criteria };
    
    this.session = {
      id: `crawl_${Date.now()}`,
      totalChannels: sourceChannelIds.length,
      processedChannels: 0,
      channelsDiscovered: 0,
      quotaUsed: 0,
      status: 'running',
      startTime: new Date(),
      errors: []
    };

    console.log(`🕷️ Starting subscription crawl session: ${this.session.id}`);
    console.log(`📊 Target channels: ${sourceChannelIds.length}`);
    console.log(`⚙️ Criteria:`, mergedCriteria);

    // Process channels in batches to manage quota and performance
    try {
      for (let i = 0; i < sourceChannelIds.length; i += 5) {
        if (this.session.status !== 'running') break;

        const batch = sourceChannelIds.slice(i, i + 5);
        console.log(`📦 Processing batch ${Math.floor(i/5) + 1}/${Math.ceil(sourceChannelIds.length/5)}`);

        await this.processBatch(batch, mergedCriteria);
        
        // Update session progress
        this.session.processedChannels = Math.min(i + 5, sourceChannelIds.length);

        // Add delay between batches to be respectful to API
        if (i + 5 < sourceChannelIds.length) {
          await this.delay(1000);
        }
      }

      this.session.status = 'completed';
      this.session.endTime = new Date();
      
      console.log(`✅ Crawl session completed: ${this.session.id}`);
      console.log(`📈 Total discovered: ${this.session.channelsDiscovered} channels`);
      console.log(`📊 Quota used: ${this.session.quotaUsed} units`);

    } catch (error) {
      this.session.status = 'failed';
      this.session.endTime = new Date();
      this.session.errors.push((error as Error).message);
      
      console.error(`❌ Crawl session failed: ${this.session.id}`, error);
      throw error;
    }

    return this.session;
  }

  /**
   * Processes a batch of source channels
   */
  private async processBatch(
    sourceChannelIds: string[],
    criteria: ValidationCriteria
  ): Promise<void> {
    const results = await Promise.allSettled(
      sourceChannelIds.map(channelId => this.crawlChannel(channelId, criteria))
    );

    for (const result of results) {
      if (result.status === 'fulfilled') {
        this.session!.channelsDiscovered += result.value.channelsDiscovered;
        this.session!.quotaUsed += result.value.quotaUsed;
        
        if (result.value.errors.length > 0) {
          this.session!.errors.push(...result.value.errors);
        }
      } else {
        this.session!.errors.push(`Batch processing error: ${result.reason}`);
      }
    }
  }

  /**
   * Crawls subscriptions for a single source channel
   */
  private async crawlChannel(
    sourceChannelId: string,
    criteria: ValidationCriteria
  ): Promise<CrawlResult> {
    const result: CrawlResult = {
      sourceChannelId,
      channelsDiscovered: 0,
      channelsValidated: 0,
      channelsFiltered: 0,
      quotaUsed: 0,
      errors: []
    };

    try {
      console.log(`🔍 Crawling subscriptions for: ${sourceChannelId}`);

      // Get all subscriptions for this channel
      const subscriptionsResult = await youtubeDiscoveryAPI.getAllChannelSubscriptions(sourceChannelId);
      result.quotaUsed += subscriptionsResult.totalQuotaUsed;

      console.log(`📋 Found ${subscriptionsResult.subscriptions.length} subscriptions`);

      if (subscriptionsResult.subscriptions.length === 0) {
        console.log(`⚠️ No subscriptions found for ${sourceChannelId} (private or no subscriptions)`);
        return result;
      }

      // Extract channel IDs
      const discoveredChannelIds = subscriptionsResult.subscriptions.map(sub => sub.channelId);

      // Filter out existing channels if requested
      const filteredChannelIds = criteria.excludeExisting 
        ? await this.filterExistingChannels(discoveredChannelIds, sourceChannelId)
        : discoveredChannelIds;

      result.channelsFiltered = discoveredChannelIds.length - filteredChannelIds.length;

      if (filteredChannelIds.length === 0) {
        console.log(`📭 No new channels to validate for ${sourceChannelId}`);
        return result;
      }

      console.log(`🔍 Validating ${filteredChannelIds.length} new channels`);

      // Validate channels in batches
      const validationResult = await youtubeDiscoveryAPI.validateChannels(filteredChannelIds);
      result.quotaUsed += validationResult.quotaUsed;
      result.channelsValidated = validationResult.channels.length;

      // Apply criteria filters
      const validChannels = validationResult.channels.filter(channel => 
        this.meetsValidationCriteria(channel, criteria)
      );

      console.log(`✅ ${validChannels.length}/${validationResult.channels.length} channels meet criteria`);

      // Store discoveries in database
      if (validChannels.length > 0) {
        await this.storeDiscoveries(sourceChannelId, validChannels, subscriptionsResult.subscriptions);
        result.channelsDiscovered = validChannels.length;
      }

    } catch (error) {
      const errorMsg = `Error crawling ${sourceChannelId}: ${(error as Error).message}`;
      result.errors.push(errorMsg);
      console.error(errorMsg);
    }

    return result;
  }

  /**
   * Filters out channels that already exist in our system
   */
  private async filterExistingChannels(
    channelIds: string[], 
    sourceChannelId: string
  ): Promise<string[]> {
    try {
      // Check against existing imported channels
      const { data: existingVideos } = await supabase
        .from('videos')
        .select('channel_id')
        .in('channel_id', channelIds);

      const existingChannelIds = new Set(existingVideos?.map(v => v.channel_id) || []);

      // Check against previously discovered channels
      const { data: existingDiscoveries } = await supabase
        .from('channel_discovery')
        .select('discovered_channel_id')
        .in('discovered_channel_id', channelIds);

      const discoveredChannelIds = new Set(existingDiscoveries?.map(d => d.discovered_channel_id) || []);

      // Filter out existing channels
      const newChannelIds = channelIds.filter(id => 
        !existingChannelIds.has(id) && 
        !discoveredChannelIds.has(id) &&
        id !== sourceChannelId // Don't discover the source channel itself
      );

      console.log(`🔍 Filtered: ${channelIds.length} → ${newChannelIds.length} (removed ${channelIds.length - newChannelIds.length} existing)`);

      return newChannelIds;
    } catch (error) {
      console.error('Error filtering existing channels:', error);
      // If filtering fails, return all channels to be safe
      return channelIds;
    }
  }

  /**
   * Checks if a channel meets validation criteria
   */
  private meetsValidationCriteria(
    channel: ChannelValidationResult,
    criteria: ValidationCriteria
  ): boolean {
    // Check subscriber count
    if (channel.subscriberCount < criteria.minSubscribers) {
      return false;
    }

    // Check video count
    if (channel.videoCount < criteria.minVideos) {
      return false;
    }

    // Check channel age (rough activity indicator)
    const channelAge = Date.now() - new Date(channel.publishedAt).getTime();
    const maxAge = criteria.maxAgeDays * 24 * 60 * 60 * 1000;
    
    // For very old channels, we assume they might still be active if they have many videos
    if (channelAge > maxAge && channel.videoCount < criteria.minVideos * 10) {
      return false;
    }

    return true;
  }

  /**
   * Stores discovered channels in the database
   */
  private async storeDiscoveries(
    sourceChannelId: string,
    validChannels: ChannelValidationResult[],
    subscriptions: SubscriptionResult[]
  ): Promise<void> {
    try {
      const discoveries = validChannels.map(channel => {
        const subscription = subscriptions.find(sub => sub.channelId === channel.channelId);
        
        return {
          source_channel_id: sourceChannelId,
          discovered_channel_id: channel.channelId,
          discovery_method: 'subscription',
          subscriber_count: channel.subscriberCount,
          video_count: channel.videoCount,
          validation_status: 'pending',
          import_status: 'pending',
          discovery_context: {
            subscriptionPublishedAt: subscription?.publishedAt
          },
          channel_metadata: {
            title: channel.title,
            description: channel.description,
            thumbnailUrl: channel.thumbnailUrl,
            customUrl: channel.customUrl,
            publishedAt: channel.publishedAt,
            viewCount: channel.viewCount
          }
        };
      });

      const { error } = await supabase
        .from('channel_discovery')
        .upsert(discoveries, { 
          onConflict: 'source_channel_id,discovered_channel_id,discovery_method',
          ignoreDuplicates: false 
        });

      if (error) {
        throw new Error(`Database storage error: ${error.message}`);
      }

      console.log(`💾 Stored ${discoveries.length} discoveries from ${sourceChannelId}`);
    } catch (error) {
      console.error('Error storing discoveries:', error);
      throw error;
    }
  }

  /**
   * Updates daily metrics
   */
  async updateDailyMetrics(date: Date = new Date()): Promise<void> {
    const dateStr = date.toISOString().split('T')[0];
    const quotaUsage = youtubeDiscoveryAPI.getQuotaUsage();

    try {
      // Get discovery counts for today
      const { data: discoveries } = await supabase
        .from('channel_discovery')
        .select('validation_status, import_status')
        .gte('discovery_date', `${dateStr}T00:00:00Z`)
        .lt('discovery_date', `${dateStr}T23:59:59Z`);

      const stats = {
        channels_discovered: discoveries?.length || 0,
        channels_validated: discoveries?.filter(d => d.validation_status !== 'pending').length || 0,
        channels_approved: discoveries?.filter(d => d.validation_status === 'approved').length || 0,
        channels_imported: discoveries?.filter(d => d.import_status === 'completed').length || 0,
      };

      const metrics = {
        date: dateStr,
        quota_used_subscriptions: quotaUsage.subscriptions,
        quota_used_channels: quotaUsage.channels,
        quota_used_total: quotaUsage.total,
        ...stats,
        success_rate: stats.channels_discovered > 0 ? 
          (stats.channels_approved / stats.channels_discovered * 100) : 0,
        relevance_rate: stats.channels_validated > 0 ? 
          (stats.channels_approved / stats.channels_validated * 100) : 0,
      };

      const { error } = await supabase
        .from('discovery_metrics')
        .upsert(metrics, { onConflict: 'date' });

      if (error) {
        console.error('Error updating metrics:', error);
      } else {
        console.log(`📊 Updated daily metrics for ${dateStr}`);
      }
    } catch (error) {
      console.error('Error calculating daily metrics:', error);
    }
  }

  /**
   * Gets current session status
   */
  getSessionStatus(): CrawlSession | null {
    return this.session ? { ...this.session } : null;
  }

  /**
   * Pauses current session
   */
  pauseSession(): void {
    if (this.session && this.session.status === 'running') {
      this.session.status = 'paused';
    }
  }

  /**
   * Resumes paused session
   */
  resumeSession(): void {
    if (this.session && this.session.status === 'paused') {
      this.session.status = 'running';
    }
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// Singleton instance
export const subscriptionCrawler = new SubscriptionCrawler();