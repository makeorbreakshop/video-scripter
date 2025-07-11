import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import { Browser, Page } from 'puppeteer';
import { createClient } from '@supabase/supabase-js';
import type { Database } from '@/types/database';
import { 
  EducationalNiche, 
  getNicheSeeds, 
  detectNicheFromChannel,
  getEducationalSignals 
} from './educational-niches';

puppeteer.use(StealthPlugin());

export interface EnhancedSpiderConfig {
  minSubscribers: number;
  maxDaysSinceUpload: number;
  maxChannels: number;
  maxDepth: number;
  batchSize: number;
  targetNiches: string[];
  enableSearchDiscovery: boolean;
  enablePlaylistDiscovery: boolean;
  searchTermsPerNiche: number;
}

export interface EducationalChannel extends DiscoveredChannel {
  educationalScore: number;
  detectedNiches: string[];
  hasProducts: boolean;
  courseIndicators: string[];
  recentVideoTitles: string[];
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

export class EnhancedYouTubeSpider {
  private supabase: ReturnType<typeof createClient<Database>>;
  private config: EnhancedSpiderConfig;
  private browser: Browser | null = null;
  private visited: Set<string> = new Set();
  private queue: Array<{ channelId: string; channelHandle?: string; depth: number; sourceNiche?: string }> = [];
  private discovered: EducationalChannel[] = [];
  private runId: string | null = null;
  private educationalSignals: string[];

  constructor(
    supabaseUrl: string,
    supabaseKey: string,
    config: EnhancedSpiderConfig
  ) {
    this.supabase = createClient<Database>(supabaseUrl, supabaseKey);
    this.config = config;
    this.educationalSignals = getEducationalSignals();
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
        '--disable-gpu',
        '--disable-blink-features=AutomationControlled',
        '--user-agent=Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      ]
    });
  }

  async cleanup() {
    if (this.browser) {
      await this.browser.close();
    }
  }

  async discoverByNiche(nicheId: string, userId?: string): Promise<EducationalChannel[]> {
    const niche = getNicheSeeds(nicheId);
    if (!niche) {
      throw new Error(`Unknown niche: ${nicheId}`);
    }

    try {
      await this.initialize();
      
      // Create discovery run
      const { data: runData } = await this.supabase
        .from('discovery_runs')
        .insert({
          seed_channel_id: `niche:${nicheId}`,
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

      // Phase 1: Seed with known channels
      await this.seedFromNiche(niche);
      
      // Phase 2: YouTube search discovery
      if (this.config.enableSearchDiscovery) {
        await this.discoverViaSearch(niche);
      }
      
      // Phase 3: Traditional spider crawl
      await this.crawlNetwork();
      
      // Phase 4: Playlist discovery
      if (this.config.enablePlaylistDiscovery) {
        await this.discoverViaPlaylists(niche);
      }

      // Save final batch
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
            channels_meeting_threshold: this.discovered.filter(c => this.meetsEducationalThreshold(c)).length
          })
          .eq('id', this.runId);
      }

      return this.discovered;
      
    } finally {
      await this.cleanup();
    }
  }

  private async seedFromNiche(niche: EducationalNiche): Promise<void> {
    console.log(`Seeding from ${niche.seedChannels.length} known channels in ${niche.name}`);
    
    for (const seed of niche.seedChannels) {
      if (seed.channelId) {
        this.queue.push({ channelId: seed.channelId, depth: 0, sourceNiche: niche.id });
      } else if (seed.handle) {
        this.queue.push({ channelId: '', channelHandle: seed.handle, depth: 0, sourceNiche: niche.id });
      }
    }
  }

  private async discoverViaSearch(niche: EducationalNiche): Promise<void> {
    console.log(`Discovering via search for ${niche.name}`);
    const page = await this.browser!.newPage();
    
    try {
      const searchTerms = niche.searchTerms.slice(0, this.config.searchTermsPerNiche);
      
      for (const searchTerm of searchTerms) {
        try {
          await this.searchYouTube(page, searchTerm, niche.id);
          await this.delay(3000 + Math.random() * 2000); // Random delay between searches
        } catch (error) {
          console.error(`Error searching for "${searchTerm}":`, error);
        }
      }
    } finally {
      await page.close();
    }
  }

  private async searchYouTube(page: Page, searchTerm: string, nicheId: string): Promise<void> {
    const searchUrl = `https://www.youtube.com/results?search_query=${encodeURIComponent(searchTerm)}&sp=CAASAhAB`; // Filter for channels
    
    await page.goto(searchUrl, { waitUntil: 'networkidle2', timeout: 30000 });
    await this.delay(2000);

    // Scroll to load more results
    await page.evaluate(() => {
      window.scrollTo(0, document.body.scrollHeight);
    });
    await this.delay(2000);

    const channels = await page.evaluate(() => {
      const channelElements = document.querySelectorAll('ytd-channel-renderer, ytd-video-renderer');
      const found: Array<{ channelId: string; channelHandle?: string; fromVideo?: boolean }> = [];
      
      channelElements.forEach(element => {
        // Direct channel results
        const channelLink = element.querySelector('a#main-link');
        if (channelLink) {
          const href = channelLink.getAttribute('href') || '';
          const channelMatch = href.match(/\/channel\/(UC[\w-]+)/);
          const handleMatch = href.match(/\/@([\w-]+)/);
          
          if (channelMatch) {
            found.push({ channelId: channelMatch[1] });
          } else if (handleMatch) {
            found.push({ channelId: '', channelHandle: handleMatch[1] });
          }
        }
        
        // Channel from video results
        const authorLink = element.querySelector('a.yt-simple-endpoint[href*="/channel/"], a.yt-simple-endpoint[href*="/@"]');
        if (authorLink) {
          const href = authorLink.getAttribute('href') || '';
          const channelMatch = href.match(/\/channel\/(UC[\w-]+)/);
          const handleMatch = href.match(/\/@([\w-]+)/);
          
          if (channelMatch) {
            found.push({ channelId: channelMatch[1], fromVideo: true });
          } else if (handleMatch) {
            found.push({ channelId: '', channelHandle: handleMatch[1], fromVideo: true });
          }
        }
      });
      
      return found;
    });

    // Add unique channels to queue
    for (const channel of channels) {
      const key = channel.channelId || channel.channelHandle || '';
      if (key && !this.visited.has(key)) {
        this.queue.push({
          channelId: channel.channelId,
          channelHandle: channel.channelHandle,
          depth: 1,
          sourceNiche: nicheId
        });
      }
    }

    console.log(`Found ${channels.length} channels from search: "${searchTerm}"`);
  }

  private async crawlNetwork(): Promise<void> {
    console.log(`Starting network crawl with ${this.queue.length} channels in queue`);
    
    while (this.queue.length > 0 && this.discovered.length < this.config.maxChannels) {
      const current = this.queue.shift();
      if (!current) continue;
      
      const key = current.channelId || current.channelHandle || '';
      if (this.visited.has(key)) continue;
      
      this.visited.add(key);
      
      if (current.depth >= this.config.maxDepth) continue;
      
      const page = await this.browser!.newPage();
      
      try {
        const channelData = await this.scrapeEducationalChannel(page, current.channelId, current.channelHandle);
        
        if (channelData && this.meetsEducationalThreshold(channelData)) {
          // Enhanced channel with educational analysis
          const enhancedChannel: EducationalChannel = {
            ...channelData,
            discoveredFrom: current.channelId || current.channelHandle || 'search',
            depth: current.depth,
            educationalScore: this.calculateEducationalScore(channelData),
            detectedNiches: detectNicheFromChannel(
              channelData.channelTitle,
              channelData.description || '',
              channelData.recentVideoTitles || []
            ),
            hasProducts: this.detectProducts(channelData.description || ''),
            courseIndicators: this.findCourseIndicators(channelData.recentVideoTitles || [])
          };
          
          this.discovered.push(enhancedChannel);
          
          // Find related channels
          const relatedChannels = await this.findRelatedChannels(page, current.channelId, channelData.channelHandle);
          
          for (const related of relatedChannels) {
            const relatedKey = related.channelId || related.channelHandle || '';
            if (!this.visited.has(relatedKey)) {
              this.queue.push({
                channelId: related.channelId,
                channelHandle: related.channelHandle,
                depth: current.depth + 1,
                sourceNiche: current.sourceNiche
              });
            }
          }
          
          // Save batch periodically
          if (this.discovered.length % this.config.batchSize === 0) {
            await this.saveBatch();
          }
        }
        
        // Update progress
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
        console.error(`Error processing channel ${key}:`, error);
      } finally {
        await page.close();
      }
      
      // Rate limiting
      await this.delay(2000 + Math.random() * 3000);
    }
  }

  private async scrapeEducationalChannel(
    page: Page, 
    channelId: string, 
    channelHandle?: string
  ): Promise<Omit<EducationalChannel, 'discoveredFrom' | 'depth' | 'educationalScore' | 'detectedNiches' | 'hasProducts' | 'courseIndicators'> | null> {
    try {
      const url = channelHandle 
        ? `https://www.youtube.com/@${channelHandle}`
        : `https://www.youtube.com/channel/${channelId}`;
      
      await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });
      await page.waitForSelector('ytd-channel-name', { timeout: 10000 });
      
      // Extract basic channel data
      const channelData = await page.evaluate(() => {
        const getTextContent = (selector: string) => {
          const element = document.querySelector(selector);
          return element?.textContent?.trim() || null;
        };
        
        const title = getTextContent('ytd-channel-name yt-formatted-string') || '';
        const handleElement = document.querySelector('#channel-handle');
        const handle = handleElement?.textContent?.trim().replace('@', '') || '';
        
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
        
        const description = getTextContent('#description-container yt-formatted-string') || '';
        
        return { title, handle, subscriberCount: Math.floor(subscriberCount), description };
      });
      
      // Get recent video titles for educational analysis
      await page.goto(`${url}/videos`, { waitUntil: 'networkidle2', timeout: 30000 });
      await this.delay(2000);
      
      const recentVideoTitles = await page.evaluate(() => {
        const titleElements = document.querySelectorAll('#video-title');
        return Array.from(titleElements).slice(0, 10).map(el => el.textContent?.trim() || '');
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
        description: channelData.description,
        discoveryMethod: 'enhanced_scraping',
        recentVideoTitles
      };
      
    } catch (error) {
      console.error('Error scraping educational channel:', error);
      return null;
    }
  }

  private calculateEducationalScore(channel: any): number {
    let score = 0;
    const content = `${channel.channelTitle} ${channel.description} ${channel.recentVideoTitles?.join(' ')}`.toLowerCase();
    
    // Educational signals in title/description
    this.educationalSignals.forEach(signal => {
      if (content.includes(signal.toLowerCase())) {
        score += 1;
      }
    });
    
    // Course/tutorial indicators in recent videos
    const courseWords = ['tutorial', 'course', 'lesson', 'guide', 'how to', 'learn', 'beginner', 'advanced'];
    courseWords.forEach(word => {
      const matches = (content.match(new RegExp(word, 'gi')) || []).length;
      score += matches * 0.5;
    });
    
    // Subscriber count bonus (educational channels often have good subscriber counts)
    if (channel.subscriberCount > 100000) score += 2;
    if (channel.subscriberCount > 500000) score += 1;
    
    return Math.round(score * 10) / 10;
  }

  private detectProducts(description: string): boolean {
    const productIndicators = [
      'course', 'buy', 'shop', 'store', 'product', 'purchase',
      'masterclass', 'training', 'certification', 'program',
      'affiliate', 'discount', 'promo', 'code'
    ];
    
    return productIndicators.some(indicator => 
      description.toLowerCase().includes(indicator)
    );
  }

  private findCourseIndicators(videoTitles: string[]): string[] {
    const indicators: string[] = [];
    const coursePatterns = [
      /course|tutorial|lesson/i,
      /part \d+|episode \d+|\d+ of \d+/i,
      /beginner|intermediate|advanced/i,
      /step \d+|chapter \d+/i
    ];
    
    videoTitles.forEach(title => {
      coursePatterns.forEach(pattern => {
        if (pattern.test(title)) {
          indicators.push(title);
        }
      });
    });
    
    return indicators;
  }

  private meetsEducationalThreshold(channel: EducationalChannel | any): boolean {
    // Check basic thresholds
    if (channel.subscriberCount && channel.subscriberCount < this.config.minSubscribers) {
      return false;
    }
    
    // Educational score threshold
    const educationalScore = channel.educationalScore || this.calculateEducationalScore(channel);
    if (educationalScore < 3) { // Minimum educational relevance
      return false;
    }
    
    return true;
  }

  private async discoverViaPlaylists(niche: EducationalNiche): Promise<void> {
    console.log(`Discovering via playlists for ${niche.name}`);
    const page = await this.browser!.newPage();
    
    try {
      // Search for educational playlists in this niche
      const playlistSearchTerms = niche.searchTerms.map(term => `${term} course playlist`);
      
      for (const searchTerm of playlistSearchTerms.slice(0, 3)) {
        try {
          const searchUrl = `https://www.youtube.com/results?search_query=${encodeURIComponent(searchTerm)}&sp=EgIQAw%253D%253D`; // Filter for playlists
          
          await page.goto(searchUrl, { waitUntil: 'networkidle2', timeout: 30000 });
          await this.delay(2000);
          
          const playlistChannels = await page.evaluate(() => {
            const playlistElements = document.querySelectorAll('ytd-playlist-renderer');
            const channels: Array<{ channelId: string; channelHandle?: string }> = [];
            
            playlistElements.forEach(element => {
              const channelLink = element.querySelector('a.yt-simple-endpoint[href*="/channel/"], a.yt-simple-endpoint[href*="/@"]');
              if (channelLink) {
                const href = channelLink.getAttribute('href') || '';
                const channelMatch = href.match(/\/channel\/(UC[\w-]+)/);
                const handleMatch = href.match(/\/@([\w-]+)/);
                
                if (channelMatch) {
                  channels.push({ channelId: channelMatch[1] });
                } else if (handleMatch) {
                  channels.push({ channelId: '', channelHandle: handleMatch[1] });
                }
              }
            });
            
            return channels;
          });
          
          // Add to queue
          for (const channel of playlistChannels) {
            const key = channel.channelId || channel.channelHandle || '';
            if (key && !this.visited.has(key)) {
              this.queue.push({
                channelId: channel.channelId,
                channelHandle: channel.channelHandle,
                depth: 1,
                sourceNiche: niche.id
              });
            }
          }
          
          await this.delay(3000 + Math.random() * 2000);
        } catch (error) {
          console.error(`Error searching playlists for "${searchTerm}":`, error);
        }
      }
    } finally {
      await page.close();
    }
  }

  private async findRelatedChannels(page: Page, channelId: string, channelHandle?: string): Promise<Array<{ channelId: string; channelHandle?: string }>> {
    // Reuse the existing implementation from the original spider
    const relatedChannels: Map<string, { channelId: string; channelHandle?: string }> = new Map();
    
    // Method 1: Channels tab
    try {
      const channelsTabUrl = channelHandle 
        ? `https://www.youtube.com/@${channelHandle}/channels`
        : `https://www.youtube.com/channel/${channelId}/channels`;
      
      await page.goto(channelsTabUrl, { waitUntil: 'networkidle2', timeout: 30000 });
      await this.delay(2000);
      
      const featuredChannels = await page.evaluate(() => {
        const channels: Array<{ channelId: string; channelHandle?: string }> = [];
        const channelElements = document.querySelectorAll('ytd-channel-renderer');
        
        channelElements.forEach(element => {
          const link = element.querySelector('a#main-link');
          const href = link?.getAttribute('href') || '';
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
    
    return Array.from(relatedChannels.values());
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
            meets_threshold: this.meetsEducationalThreshold(channel)
          }))
        );
      
      if (error) {
        console.error('Error saving channels to database:', error);
      } else {
        console.log(`Saved ${this.discovered.length} educational channels to database`);
        this.discovered = [];
      }
    } catch (error) {
      console.error('Error in saveBatch:', error);
    }
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}