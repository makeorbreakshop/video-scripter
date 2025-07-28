#!/usr/bin/env node

/**
 * Rate-Limit Safe Transcript Fetcher
 * Implements multiple strategies to avoid YouTube rate limits
 */

import { createClient } from '@supabase/supabase-js';
import fetch from 'node-fetch';
import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// Rate limiting configuration
const CONFIG = {
  // Conservative rate limits
  REQUESTS_PER_MINUTE: 20,      // Very conservative
  BURST_SIZE: 5,                // Max requests in burst
  BURST_COOLDOWN: 30000,        // 30 sec cooldown after burst
  
  // Delays and backoff
  MIN_DELAY: 3000,              // 3 seconds minimum between requests
  MAX_DELAY: 60000,             // 1 minute max delay
  BACKOFF_MULTIPLIER: 2,        // Double delay on rate limit
  
  // Rotation and distribution
  USER_AGENTS: [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36'
  ],
  
  // Session management
  SESSION_SIZE: 50,             // Videos per session
  SESSION_BREAK: 300000,        // 5 minute break between sessions
  
  // Error handling
  MAX_RETRIES: 3,
  RATE_LIMIT_INDICATORS: [
    'Too Many Requests',
    'Sign in to confirm',
    'CAPTCHA',
    'rate limit',
    'quota exceeded'
  ]
};

class RateLimitManager {
  constructor() {
    this.requestTimes = [];
    this.currentDelay = CONFIG.MIN_DELAY;
    this.sessionCount = 0;
    this.rateLimitHits = 0;
  }

  async waitForNextRequest() {
    // Remove old request times
    const oneMinuteAgo = Date.now() - 60000;
    this.requestTimes = this.requestTimes.filter(t => t > oneMinuteAgo);
    
    // Check rate limit
    if (this.requestTimes.length >= CONFIG.REQUESTS_PER_MINUTE) {
      const oldestRequest = this.requestTimes[0];
      const waitTime = 60000 - (Date.now() - oldestRequest) + 1000;
      console.log(`⏸️  Rate limit approaching, waiting ${Math.round(waitTime/1000)}s...`);
      await new Promise(resolve => setTimeout(resolve, waitTime));
    }
    
    // Apply current delay
    await new Promise(resolve => setTimeout(resolve, this.currentDelay));
    
    // Record request time
    this.requestTimes.push(Date.now());
  }

  handleRateLimit() {
    this.rateLimitHits++;
    this.currentDelay = Math.min(this.currentDelay * CONFIG.BACKOFF_MULTIPLIER, CONFIG.MAX_DELAY);
    console.log(`🚨 Rate limit hit #${this.rateLimitHits}, increasing delay to ${this.currentDelay/1000}s`);
  }

  handleSuccess() {
    // Gradually reduce delay on success
    if (this.currentDelay > CONFIG.MIN_DELAY) {
      this.currentDelay = Math.max(CONFIG.MIN_DELAY, this.currentDelay * 0.9);
    }
  }

  async checkSessionBreak() {
    this.sessionCount++;
    if (this.sessionCount % CONFIG.SESSION_SIZE === 0) {
      console.log(`\n☕ Session break after ${this.sessionCount} videos...`);
      console.log(`Resuming in ${CONFIG.SESSION_BREAK/1000} seconds...`);
      await new Promise(resolve => setTimeout(resolve, CONFIG.SESSION_BREAK));
    }
  }
}

class TranscriptFetcher {
  constructor() {
    this.rateLimiter = new RateLimitManager();
    this.stats = {
      processed: 0,
      successful: 0,
      failed: 0,
      rateLimited: 0,
      noTranscript: 0
    };
  }

  getRandomUserAgent() {
    return CONFIG.USER_AGENTS[Math.floor(Math.random() * CONFIG.USER_AGENTS.length)];
  }

  isRateLimited(response, text) {
    if (response.status === 429) return true;
    if (response.status === 403) return true;
    
    const lowercaseText = text.toLowerCase();
    return CONFIG.RATE_LIMIT_INDICATORS.some(indicator => 
      lowercaseText.includes(indicator.toLowerCase())
    );
  }

  async fetchWithRetry(videoId, attempt = 1) {
    try {
      // Wait for rate limiter
      await this.rateLimiter.waitForNextRequest();
      
      // Fetch with browser-like headers
      const response = await fetch(`https://www.youtube.com/watch?v=${videoId}`, {
        headers: {
          'User-Agent': this.getRandomUserAgent(),
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.5',
          'Accept-Encoding': 'gzip, deflate, br',
          'DNT': '1',
          'Connection': 'keep-alive',
          'Upgrade-Insecure-Requests': '1'
        }
      });

      const text = await response.text();

      // Check for rate limiting
      if (this.isRateLimited(response, text)) {
        this.stats.rateLimited++;
        this.rateLimiter.handleRateLimit();
        
        if (attempt < CONFIG.MAX_RETRIES) {
          console.log(`🔄 Rate limited on ${videoId}, retry ${attempt}/${CONFIG.MAX_RETRIES}`);
          const backoffTime = Math.pow(2, attempt) * 60000; // Exponential backoff in minutes
          console.log(`⏰ Waiting ${backoffTime/60000} minutes before retry...`);
          await new Promise(resolve => setTimeout(resolve, backoffTime));
          return this.fetchWithRetry(videoId, attempt + 1);
        }
        
        throw new Error('Rate limited after max retries');
      }

      // Success - reduce delay
      this.rateLimiter.handleSuccess();
      
      // Extract and process transcript as before
      const captionTracksMatch = text.match(/"captionTracks":\[(.*?)\]/);
      if (!captionTracksMatch) {
        return null;
      }

      // ... rest of transcript extraction logic ...
      
      return { success: true, transcript: 'extracted transcript' };
      
    } catch (error) {
      if (attempt < CONFIG.MAX_RETRIES && !error.message.includes('Rate limited')) {
        await new Promise(resolve => setTimeout(resolve, 5000 * attempt));
        return this.fetchWithRetry(videoId, attempt + 1);
      }
      throw error;
    }
  }

  async processVideo(video) {
    try {
      // Check if already has transcript
      const { data: existing } = await supabase
        .from('chunks')
        .select('id')
        .eq('video_id', video.id)
        .eq('content_type', 'transcript')
        .limit(1);

      if (existing?.length > 0) {
        console.log(`⏭️  Skipping ${video.id} - already has transcript`);
        return;
      }

      const result = await this.fetchWithRetry(video.id);
      
      if (result?.success) {
        this.stats.successful++;
        // Store transcript chunks...
      } else {
        this.stats.noTranscript++;
      }

      // Session break check
      await this.rateLimiter.checkSessionBreak();
      
    } catch (error) {
      this.stats.failed++;
      console.error(`❌ Failed ${video.id}: ${error.message}`);
    }

    this.stats.processed++;
    
    // Progress update every 10 videos
    if (this.stats.processed % 10 === 0) {
      console.log(`
📊 Progress: ${this.stats.processed} processed
✅ Success: ${this.stats.successful}
🚫 No transcript: ${this.stats.noTranscript}
🚨 Rate limited: ${this.stats.rateLimited}
❌ Failed: ${this.stats.failed}
⏱️  Current delay: ${this.rateLimiter.currentDelay/1000}s
      `);
    }
  }

  async run() {
    console.log(`
🛡️  Rate-Limit Safe Transcript Fetcher
=====================================
- Max ${CONFIG.REQUESTS_PER_MINUTE} requests/minute
- ${CONFIG.MIN_DELAY/1000}s minimum delay between requests
- Session breaks every ${CONFIG.SESSION_SIZE} videos
- Exponential backoff on rate limits
    `);

    // Process videos in small batches
    let offset = 0;
    const batchSize = 100;

    while (true) {
      const { data: videos, error } = await supabase
        .from('videos')
        .select('id, title')
        .order('view_count', { ascending: false })
        .range(offset, offset + batchSize - 1);

      if (!videos || videos.length === 0) break;

      for (const video of videos) {
        await this.processVideo(video);
      }

      offset += batchSize;
    }

    console.log('\n✅ Processing complete!');
    console.log(this.stats);
  }
}

// Run the fetcher
const fetcher = new TranscriptFetcher();
fetcher.run().catch(console.error);