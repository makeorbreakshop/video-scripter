// REAL educational spider that actually web scrapes and discovers new channels
import puppeteer from 'puppeteer';
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import path from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.join(__dirname, '../.env') });

// Get arguments from command line
const nicheId = process.argv[2];
const configStr = process.argv[3];
const mode = process.argv[4] || 'test';

if (!nicheId || !configStr) {
  console.error('Usage: node run-real-educational-spider.js <nicheId> <configJson> [mode]');
  process.exit(1);
}

const config = JSON.parse(configStr);

// Educational search terms for each niche
const educationalSearchTerms = {
  'language': [
    'learn spanish tutorial',
    'french lessons beginner',
    'english grammar course',
    'language learning tips',
    'pronunciation practice'
  ],
  'cooking': [
    'cooking tutorial beginner',
    'baking techniques course',
    'knife skills lesson',
    'cooking fundamentals',
    'culinary school basics'
  ],
  'diy': [
    'woodworking tutorial',
    'diy home improvement',
    'crafting techniques',
    'maker projects tutorial',
    'workshop basics'
  ],
  'fitness': [
    'workout tutorial beginner',
    'exercise form guide',
    'fitness training course',
    'strength training basics',
    'nutrition education'
  ]
};

async function scrapeYouTubeSearch(browser, searchTerm, maxResults = 20) {
  const page = await browser.newPage();
  const discoveredChannels = [];
  
  try {
    // Set user agent to avoid detection
    await page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
    
    console.log(`Searching YouTube for: "${searchTerm}"`);
    
    // Search YouTube
    await page.goto(`https://www.youtube.com/results?search_query=${encodeURIComponent(searchTerm)}`, {
      waitUntil: 'networkidle2',
      timeout: 30000
    });
    
    // Wait for results to load
    await page.waitForSelector('ytd-video-renderer, ytd-channel-renderer', { timeout: 10000 }).catch(() => {
      console.log('Warning: Standard selectors not found, trying alternative selectors');
    });
    
    // Extract channels from search results
    const channels = await page.evaluate((maxResults) => {
      console.log('Starting channel extraction...');
      
      // Try multiple selector strategies
      let channelElements = document.querySelectorAll('ytd-video-renderer #channel-info, ytd-channel-renderer');
      
      if (channelElements.length === 0) {
        // Try alternative selectors
        channelElements = document.querySelectorAll('ytd-video-renderer, ytd-channel-renderer');
        console.log(`Found ${channelElements.length} video/channel elements with alternative selector`);
      } else {
        console.log(`Found ${channelElements.length} channel elements with standard selector`);
      }
      
      const channels = [];
      
      for (let i = 0; i < Math.min(channelElements.length, maxResults); i++) {
        const element = channelElements[i];
        
        let channelName, channelHandle, channelUrl, subscriberCount;
        
        // Try multiple strategies to extract channel info
        let nameElement, subElement;
        
        // Strategy 1: Video renderer channel info
        if (element.classList.contains('ytd-video-renderer') || element.closest('ytd-video-renderer')) {
          nameElement = element.querySelector('#channel-name a, #text a, .ytd-channel-name a');
          subElement = element.querySelector('#owner-sub-count, .style-scope.ytd-video-meta-block');
        }
        
        // Strategy 2: Direct channel renderer
        if (!nameElement && (element.classList.contains('ytd-channel-renderer') || element.closest('ytd-channel-renderer'))) {
          nameElement = element.querySelector('#channel-title a, .ytd-channel-name a, #text a');
          subElement = element.querySelector('#subscriber-count, .style-scope.ytd-video-meta-block');
        }
        
        // Strategy 3: Any channel link on the page
        if (!nameElement) {
          nameElement = element.querySelector('a[href*="/channel/"], a[href*="/@"]');
          subElement = element.querySelector('[class*="subscriber"], [class*="sub-count"]');
        }
        
        if (nameElement) {
          channelName = nameElement.textContent?.trim();
          channelUrl = nameElement.href;
          if (channelUrl) {
            channelHandle = channelUrl.split('/').pop();
          }
        }
        
        if (subElement) {
          const subText = subElement.textContent?.trim() || '';
          subscriberCount = parseSubscriberCount(subText);
        }
        
        if (channelName && channelUrl && !channels.find(c => c.channelUrl === channelUrl)) {
          console.log(`Found channel: ${channelName} (${subscriberCount || 0} subs)`);
          channels.push({
            channelName: channelName,
            channelHandle: channelHandle || '',
            channelUrl: channelUrl,
            subscriberCount: subscriberCount || 0
          });
        } else if (channelName) {
          console.log(`Skipping channel without URL: ${channelName}`);
        }
      }
      
      function parseSubscriberCount(text) {
        if (!text) return 0;
        const match = text.match(/([0-9,.]+)\s*([KMB]?)/i);
        if (!match) return 0;
        
        let num = parseFloat(match[1].replace(/,/g, ''));
        const suffix = match[2].toUpperCase();
        
        if (suffix === 'K') num *= 1000;
        else if (suffix === 'M') num *= 1000000;
        else if (suffix === 'B') num *= 1000000000;
        
        return Math.floor(num);
      }
      
      return channels;
    }, maxResults);
    
    console.log(`Found ${channels.length} channels for "${searchTerm}"`);
    
    // Add search term to each channel
    const channelsWithSearchTerm = channels.map(channel => ({
      ...channel,
      searchTerm: searchTerm
    }));
    
    discoveredChannels.push(...channelsWithSearchTerm);
    
  } catch (error) {
    console.error(`Error scraping search term "${searchTerm}":`, error.message);
  } finally {
    await page.close();
  }
  
  return discoveredChannels;
}

async function discoverRelatedChannels(browser, channelUrl, maxResults = 10) {
  const page = await browser.newPage();
  const relatedChannels = [];
  
  try {
    console.log(`Discovering related channels from: ${channelUrl}`);
    
    await page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
    
    // Go to channel's channels tab
    const channelsTabUrl = channelUrl.includes('/channels') ? channelUrl : `${channelUrl}/channels`;
    await page.goto(channelsTabUrl, {
      waitUntil: 'networkidle2',
      timeout: 30000
    });
    
    // Wait for channel list
    await page.waitForSelector('ytd-grid-channel-renderer, ytd-mini-channel-renderer', { timeout: 5000 });
    
    const channels = await page.evaluate((maxResults) => {
      const channelElements = document.querySelectorAll('ytd-grid-channel-renderer, ytd-mini-channel-renderer');
      const channels = [];
      
      for (let i = 0; i < Math.min(channelElements.length, maxResults); i++) {
        const element = channelElements[i];
        
        const nameElement = element.querySelector('#channel-title a, .ytd-channel-name a');
        const subElement = element.querySelector('#subscriber-count, .subscribers');
        
        if (nameElement) {
          const channelName = nameElement.textContent?.trim();
          const channelUrl = nameElement.href;
          const channelHandle = channelUrl?.split('/').pop();
          
          let subscriberCount = 0;
          if (subElement) {
            const subText = subElement.textContent?.trim() || '';
            subscriberCount = parseSubscriberCount(subText);
          }
          
          if (channelName && channelUrl) {
            channels.push({
              channelName,
              channelHandle: channelHandle || '',
              channelUrl,
              subscriberCount,
              discoveryMethod: 'related_channels'
            });
          }
        }
      }
      
      function parseSubscriberCount(text) {
        if (!text) return 0;
        const match = text.match(/([0-9,.]+)\s*([KMB]?)/i);
        if (!match) return 0;
        
        let num = parseFloat(match[1].replace(/,/g, ''));
        const suffix = match[2].toUpperCase();
        
        if (suffix === 'K') num *= 1000;
        else if (suffix === 'M') num *= 1000000;
        else if (suffix === 'B') num *= 1000000000;
        
        return Math.floor(num);
      }
      
      return channels;
    }, maxResults);
    
    console.log(`Found ${channels.length} related channels`);
    relatedChannels.push(...channels);
    
  } catch (error) {
    console.error(`Error discovering related channels:`, error.message);
  } finally {
    await page.close();
  }
  
  return relatedChannels;
}

async function runRealEducationalDiscovery() {
  let browser;
  
  try {
    const searchTerms = educationalSearchTerms[nicheId];
    if (!searchTerms) {
      throw new Error(`No search terms defined for niche: ${nicheId}`);
    }
    
    console.log(`Starting REAL educational discovery for niche: ${nicheId}`);
    console.log('Search terms:', searchTerms);
    
    // Launch Puppeteer
    browser = await puppeteer.launch({
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
    
    // Create Supabase client
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY
    );
    
    // Check for existing channels
    const { data: existingChannels } = await supabase
      .from('discovered_channels')
      .select('channel_id, channel_title');
    
    const existingChannelNames = new Set(existingChannels?.map(c => c.channel_title?.toLowerCase()) || []);
    const existingChannelIds = new Set(existingChannels?.map(c => c.channel_id) || []);
    
    const targetChannels = config.maxChannels || (mode === 'test' ? 5 : 20);
    const discoveredChannels = [];
    const allFoundChannels = [];
    let skippedCount = 0;
    
    // Scrape each search term
    for (const searchTerm of searchTerms) {
      if (discoveredChannels.length >= targetChannels) break;
      
      const searchResults = await scrapeYouTubeSearch(browser, searchTerm, 20);
      allFoundChannels.push(...searchResults);
      
      // Also discover related channels from promising results
      for (const result of searchResults.slice(0, 3)) {
        if (discoveredChannels.length >= targetChannels) break;
        
        const relatedChannels = await discoverRelatedChannels(browser, result.channelUrl, 10);
        allFoundChannels.push(...relatedChannels);
      }
      
      // Add delay between searches
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
    
    console.log(`Found ${allFoundChannels.length} total channels from web scraping`);
    
    // Process and filter discovered channels
    const uniqueChannels = [];
    const seenUrls = new Set();
    
    for (const channel of allFoundChannels) {
      if (seenUrls.has(channel.channelUrl)) continue;
      seenUrls.add(channel.channelUrl);
      
      console.log(`Processing channel: ${channel.channelName} (${channel.subscriberCount} subs)`);
      
      // Apply filters
      if (channel.subscriberCount < (config.minSubscribers || 1000)) {
        console.log(`Filtered out ${channel.channelName}: ${channel.subscriberCount} < ${config.minSubscribers || 1000} subscribers`);
        continue;
      }
      
      // Extract channel ID from URL
      const channelId = channel.channelUrl.split('/').pop() || channel.channelHandle;
      
      // Skip if already exists
      if (existingChannelIds.has(channelId) || existingChannelNames.has(channel.channelName?.toLowerCase())) {
        console.log(`Skipping existing channel: ${channel.channelName}`);
        skippedCount++;
        continue;
      }
      
      // Stop if we have enough
      if (discoveredChannels.length >= targetChannels) break;
      
      const processedChannel = {
        channelId: channelId,
        channelTitle: channel.channelName,
        channelHandle: channel.channelHandle,
        subscriberCount: channel.subscriberCount,
        discoveryMethod: channel.discoveryMethod || 'youtube_search',
        searchTerm: channel.searchTerm,
        educationalScore: 0.8, // Could be improved with content analysis
        hasProducts: null, // Would need deeper analysis
        description: `Educational ${nicheId} channel discovered via web scraping`
      };
      
      discoveredChannels.push(processedChannel);
      
      // Insert into database
      try {
        const { error } = await supabase
          .from('discovered_channels')
          .insert({
            channel_id: processedChannel.channelId,
            channel_title: processedChannel.channelTitle,
            channel_handle: processedChannel.channelHandle,
            subscriber_count: processedChannel.subscriberCount,
            discovery_method: processedChannel.discoveryMethod,
            discovered_from_channel_id: 'web_scraping',
            discovered_at: new Date().toISOString(),
            is_processed: false,
            meets_threshold: true,
            api_verified: false
          });
          
        if (error) {
          console.error('Error inserting channel:', error);
        } else {
          console.log(`✅ Discovered NEW channel: ${processedChannel.channelTitle} (${processedChannel.subscriberCount} subs)`);
        }
      } catch (dbError) {
        console.error('Database error:', dbError);
      }
      
      uniqueChannels.push(channel);
    }
    
    const foundEnough = discoveredChannels.length >= targetChannels;
    const message = foundEnough 
      ? `REAL discovery completed for ${nicheId}: found ${discoveredChannels.length} NEW channels via web scraping (${skippedCount} already existed)`
      : `REAL discovery for ${nicheId}: found ${discoveredChannels.length}/${targetChannels} NEW channels via web scraping (${skippedCount} already existed)`;
    
    // Output the final result as JSON
    console.log(JSON.stringify({
      success: true,
      discovered: discoveredChannels,
      message: message,
      count: discoveredChannels.length,
      target: targetChannels,
      skipped: skippedCount,
      totalScraped: allFoundChannels.length,
      uniqueFound: uniqueChannels.length,
      foundEnough: foundEnough,
      niche: nicheId,
      searchTerms: searchTerms,
      method: 'web_scraping'
    }));
    
  } catch (error) {
    console.error(JSON.stringify({
      success: false,
      error: error.message,
      stack: error.stack
    }));
    process.exit(1);
  } finally {
    if (browser) {
      await browser.close();
    }
  }
}

runRealEducationalDiscovery();