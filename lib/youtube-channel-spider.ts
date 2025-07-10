import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import { Browser, Page } from 'puppeteer';
import { createClient } from '@supabase/supabase-js';
import type { Database } from '@/types/database';

puppeteer.use(StealthPlugin());

export interface SpiderConfig {
  minSubscribers: number;
  maxDaysSinceUpload: number;
  maxChannels: number;
  maxDepth: number;
  batchSize: number;
}

export interface DiscoveredChannel {
  channelId: string;
  channelTitle: string;
  channelHandle?: string;
  customUrl?: string;
  subscriberCount?: number;
  videoCount?: number;
  viewCount?: number;
  description?: string;
  lastUploadDate?: Date;
  discoveredFrom: string;
  discoveryMethod: string;
  depth: number;
}

export class YouTubeChannelSpider {
  private supabase: ReturnType<typeof createClient<Database>>;
  private config: SpiderConfig;
  private browser: Browser | null = null;
  private visited: Set<string> = new Set();
  private queue: Array<{ channelId: string; channelHandle?: string; depth: number }> = [];
  private discovered: DiscoveredChannel[] = [];
  private runId: string | null = null;

  constructor(
    supabaseUrl: string,
    supabaseKey: string,
    config: SpiderConfig
  ) {
    this.supabase = createClient<Database>(supabaseUrl, supabaseKey);
    this.config = config;
  }

  async initialize() {
    this.browser = await puppeteer.launch({
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-accelerated-2d-canvas',
        '--no-first-run',
        '--no-zygote',
        '--disable-gpu'
      ]
    });
  }

  async cleanup() {
    if (this.browser) {
      await this.browser.close();
    }
  }

  async spider(seedChannelId: string, userId?: string): Promise<DiscoveredChannel[]> {
    try {
      await this.initialize();
      
      // Create a discovery run record
      const { data: runData } = await this.supabase
        .from('discovery_runs')
        .insert({
          seed_channel_id: seedChannelId,
          min_subscribers: this.config.minSubscribers,
          max_days_since_upload: this.config.maxDaysSinceUpload,
          max_channels: this.config.maxChannels,
          max_depth: this.config.maxDepth,
          status: 'running',
          started_at: new Date().toISOString(),
          user_id: userId
        })
        .select()
        .single();
      
      this.runId = runData?.id;
      
      // Initialize with seed channel
      this.queue.push({ channelId: seedChannelId, depth: 0 });
      
      while (this.queue.length > 0 && this.discovered.length < this.config.maxChannels) {
        const current = this.queue.shift();
        if (!current || this.visited.has(current.channelId)) continue;
        
        this.visited.add(current.channelId);
        
        if (current.depth >= this.config.maxDepth) continue;
        
        const page = await this.browser!.newPage();
        
        try {
          // Scrape channel info and find related channels
          const channelData = await this.scrapeChannelPage(page, current.channelId, current.channelHandle);
          
          if (channelData) {
            // Add to discovered channels
            this.discovered.push({
              ...channelData,
              discoveredFrom: current.channelId,
              depth: current.depth
            });
            
            // Find related channels from various sources
            const relatedChannels = await this.findRelatedChannels(page, current.channelId, channelData.channelHandle);
            
            // Add related channels to queue
            for (const related of relatedChannels) {
              if (!this.visited.has(related.channelId)) {
                this.queue.push({ 
                  channelId: related.channelId, 
                  channelHandle: related.channelHandle,
                  depth: current.depth + 1 
                });
              }
            }
            
            // Save batch to database periodically
            if (this.discovered.length % this.config.batchSize === 0) {
              await this.saveBatch(userId);
            }
          }
          
          // Update run progress
          if (this.runId) {
            await this.supabase
              .from('discovery_runs')
              .update({
                channels_discovered: this.discovered.length,
                current_depth: current.depth,
                updated_at: new Date().toISOString()
              })
              .eq('id', this.runId);
          }
          
        } catch (error) {
          console.error(`Error processing channel ${current.channelId}:`, error);
        } finally {
          await page.close();
        }
        
        // Rate limiting
        await this.delay(2000 + Math.random() * 2000);
      }
      
      // Save any remaining channels
      if (this.discovered.length > 0) {
        await this.saveBatch(userId);
      }
      
      // Mark run as completed
      if (this.runId) {
        await this.supabase
          .from('discovery_runs')
          .update({
            status: 'completed',
            completed_at: new Date().toISOString(),
            channels_meeting_threshold: this.discovered.filter(c => this.meetsThreshold(c)).length
          })
          .eq('id', this.runId);
      }
      
      return this.discovered;
      
    } finally {
      await this.cleanup();
    }
  }

  private async scrapeChannelPage(page: Page, channelId: string, channelHandle?: string): Promise<Omit<DiscoveredChannel, 'discoveredFrom' | 'depth' | 'discoveryMethod'> | null> {
    try {
      // Navigate to channel page
      const url = channelHandle 
        ? `https://www.youtube.com/@${channelHandle}`
        : `https://www.youtube.com/channel/${channelId}`;
      
      await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });
      
      // Wait for channel info to load
      await page.waitForSelector('ytd-channel-name', { timeout: 10000 });
      
      // Extract channel data
      const channelData = await page.evaluate(() => {
        const getTextContent = (selector) => {
          const element = document.querySelector(selector);
          return element?.textContent?.trim() || null;
        };
        
        // Channel title
        const title = getTextContent('ytd-channel-name yt-formatted-string') || '';
        
        // Channel handle (@username)
        const handleElement = document.querySelector('#channel-handle');
        const handle = handleElement?.textContent?.trim().replace('@', '') || '';
        
        // Subscriber count
        const subscriberText = getTextContent('#subscriber-count') || '';
        const subscriberMatch = subscriberText.match(/(\d+(?:\.\d+)?)\s*([KMB]?)/);
        let subscriberCount = 0;
        if (subscriberMatch) {
          const num = parseFloat(subscriberMatch[1]);
          const multiplier = subscriberMatch[2];
          subscriberCount = multiplier === 'K' ? num * 1000 : 
                           multiplier === 'M' ? num * 1000000 : 
                           multiplier === 'B' ? num * 1000000000 : num;
        }
        
        // Video count from about page data if available
        const videoCountText = Array.from(document.querySelectorAll('yt-formatted-string'))
          .find(el => el.textContent?.includes('videos'))?.textContent || '';
        const videoMatch = videoCountText.match(/(\d+(?:,\d+)*)\s*videos/);
        const videoCount = videoMatch ? parseInt(videoMatch[1].replace(/,/g, '')) : 0;
        
        // Description
        const description = getTextContent('#description-container yt-formatted-string') || '';
        
        return {
          title,
          handle,
          subscriberCount: Math.floor(subscriberCount),
          videoCount,
          description
        };
      });
      
      // Get channel ID if we only had handle
      if (!channelId && channelHandle) {
        channelId = await page.evaluate(() => {
          const link = document.querySelector('link[rel="canonical"]');
          const href = link?.getAttribute('href') || '';
          const match = href.match(/channel\/(UC[\w-]+)/);
          return match ? match[1] : '';
        });
      }
      
      return {
        channelId,
        channelTitle: channelData.title,
        channelHandle: channelData.handle,
        subscriberCount: channelData.subscriberCount,
        videoCount: channelData.videoCount,
        description: channelData.description,
        discoveryMethod: 'channel_page'
      };
      
    } catch (error) {
      console.error('Error scraping channel page:', error);
      return null;
    }
  }

  private async findRelatedChannels(page: Page, channelId: string, channelHandle?: string): Promise<Array<{ channelId: string; channelHandle?: string }>> {
    const relatedChannels: Map<string, { channelId: string; channelHandle?: string }> = new Map();
    
    // Method 1: Scrape "Channels" tab
    try {
      const channelsTabUrl = channelHandle 
        ? `https://www.youtube.com/@${channelHandle}/channels`
        : `https://www.youtube.com/channel/${channelId}/channels`;
      
      await page.goto(channelsTabUrl, { waitUntil: 'networkidle2', timeout: 30000 });
      await this.delay(2000);
      
      const featuredChannels = await page.evaluate(() => {
        const channels: Array<{ channelId: string; channelHandle?: string }> = [];
        
        // Find all channel renderer elements
        const channelElements = document.querySelectorAll('ytd-channel-renderer');
        
        channelElements.forEach(element => {
          const link = element.querySelector('a#main-link');
          const href = link?.getAttribute('href') || '';
          
          // Extract channel ID or handle
          const channelMatch = href.match(/\/channel\/(UC[\w-]+)/);
          const handleMatch = href.match(/\/@([\w-]+)/);
          
          if (channelMatch) {
            channels.push({ channelId: channelMatch[1] });
          } else if (handleMatch) {
            channels.push({ channelId: '', channelHandle: handleMatch[1] });
          }
        });
        
        return channels;
      });
      
      featuredChannels.forEach(ch => {
        if (ch.channelId || ch.channelHandle) {
          const key = ch.channelId || ch.channelHandle || '';
          relatedChannels.set(key, ch);
        }
      });
      
    } catch (error) {
      console.error('Error scraping channels tab:', error);
    }
    
    // Method 2: Scrape recent video descriptions
    try {
      const videosUrl = channelHandle 
        ? `https://www.youtube.com/@${channelHandle}/videos`
        : `https://www.youtube.com/channel/${channelId}/videos`;
      
      await page.goto(videosUrl, { waitUntil: 'networkidle2', timeout: 30000 });
      await this.delay(2000);
      
      // Get first 3 video links
      const videoLinks = await page.evaluate(() => {
        const links = Array.from(document.querySelectorAll('a#video-title-link'))
          .slice(0, 3)
          .map(a => a.getAttribute('href'))
          .filter(href => href)
          .map(href => `https://www.youtube.com${href}`);
        return links;
      });
      
      // Visit each video and extract channel mentions
      for (const videoUrl of videoLinks) {
        try {
          await page.goto(videoUrl, { waitUntil: 'networkidle2', timeout: 30000 });
          await this.delay(1500);
          
          // Click "Show more" to expand description
          try {
            await page.click('#expand', { timeout: 2000 });
            await this.delay(500);
          } catch {}
          
          const mentionedChannels = await page.evaluate(() => {
            const channels: Array<{ channelId: string; channelHandle?: string }> = [];
            const description = document.querySelector('#description-inner')?.textContent || '';
            
            // Find @mentions
            const handleMatches = description.match(/@[\w-]+/g) || [];
            handleMatches.forEach(handle => {
              channels.push({ channelId: '', channelHandle: handle.substring(1) });
            });
            
            // Find channel links
            const links = document.querySelectorAll('#description-inner a');
            links.forEach(link => {
              const href = link.getAttribute('href') || '';
              const channelMatch = href.match(/\/channel\/(UC[\w-]+)/);
              const handleMatch = href.match(/\/@([\w-]+)/);
              
              if (channelMatch) {
                channels.push({ channelId: channelMatch[1] });
              } else if (handleMatch) {
                channels.push({ channelId: '', channelHandle: handleMatch[1] });
              }
            });
            
            return channels;
          });
          
          mentionedChannels.forEach(ch => {
            if (ch.channelId || ch.channelHandle) {
              const key = ch.channelId || ch.channelHandle || '';
              relatedChannels.set(key, ch);
            }
          });
          
        } catch (error) {
          console.error('Error extracting from video:', error);
        }
      }
      
    } catch (error) {
      console.error('Error scraping video descriptions:', error);
    }
    
    return Array.from(relatedChannels.values());
  }

  private meetsThreshold(channel: DiscoveredChannel): boolean {
    // Check subscriber count if available
    if (channel.subscriberCount && channel.subscriberCount < this.config.minSubscribers) {
      return false;
    }
    
    // Last upload date check would require API verification
    // For now, we'll mark all as meeting threshold and verify later
    return true;
  }

  private async saveBatch(userId?: string): Promise<void> {
    if (this.discovered.length === 0) return;
    
    try {
      const { error } = await this.supabase
        .from('discovered_channels')
        .insert(
          this.discovered.map(channel => ({
            channel_id: channel.channelId,
            channel_title: channel.channelTitle,
            channel_handle: channel.channelHandle,
            custom_url: channel.customUrl,
            subscriber_count: channel.subscriberCount,
            video_count: channel.videoCount,
            view_count: channel.viewCount,
            description: channel.description,
            last_upload_date: channel.lastUploadDate?.toISOString(),
            discovered_from_channel_id: channel.discoveredFrom,
            discovery_method: channel.discoveryMethod,
            discovery_depth: channel.depth,
            user_id: userId,
            meets_threshold: this.meetsThreshold(channel)
          }))
        );
      
      if (error) {
        console.error('Error saving channels to database:', error);
      } else {
        console.log(`Saved ${this.discovered.length} channels to database`);
        
        // Also save relationships
        const relationships = this.discovered
          .filter(ch => ch.discoveredFrom)
          .map(ch => ({
            source_channel_id: ch.discoveredFrom,
            target_channel_id: ch.channelId,
            relationship_type: 'discovered',
            discovery_method: ch.discoveryMethod
          }));
        
        if (relationships.length > 0) {
          await this.supabase
            .from('channel_relationships')
            .insert(relationships);
        }
        
        this.discovered = []; // Clear after successful save
      }
    } catch (error) {
      console.error('Error in saveBatch:', error);
    }
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}