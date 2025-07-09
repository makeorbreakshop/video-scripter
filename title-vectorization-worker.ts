#!/usr/bin/env node

import { createClient } from '@supabase/supabase-js';
import { batchSyncVideosToPinecone } from './lib/title-embeddings.ts';
import os from 'os';

// Initialize Supabase client with service role for bypassing RLS
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// Worker configuration
const WORKER_ID = `title-vectorizer-${os.hostname()}-${process.pid}`;
const POLL_INTERVAL = 60000; // 60 seconds
const BATCH_SIZE = 50; // Process 50 videos at a time

// OpenAI Rate Limits (conservative estimates for safety)
// Tier 1: 500 RPM, 200K TPM
// Tier 2: 3,500 RPM, 5M TPM
// Tier 3: 5,000 RPM, 10M TPM
// We'll assume Tier 2 and use conservative limits
const OPENAI_RPM_LIMIT = 3000; // Leave some headroom
const OPENAI_TPM_LIMIT = 4000000; // 4M tokens per minute (conservative)
const TOKENS_PER_TITLE = 20; // Average title is ~15 tokens, use 20 for safety

// Pinecone Limits
const PINECONE_BATCH_SIZE = 50; // Conservative batch size for title embeddings (512-dim vectors)

class TitleVectorizationWorker {
  constructor() {
    this.isShuttingDown = false;
    this.isProcessing = false;
    this.hasShownInitialState = false;
    this.stats = {
      processedCount: 0,
      errorCount: 0,
      lastProcessedAt: null,
      startTime: Date.now()
    };
    
    // Rate limiting tracking
    this.rateLimit = {
      requestsThisMinute: 0,
      tokensThisMinute: 0,
      minuteStartTime: Date.now()
    };
    
    // Handle graceful shutdown
    process.on('SIGINT', () => this.shutdown());
    process.on('SIGTERM', () => this.shutdown());
  }

  async start() {
    console.log(`🚀 Title Vectorization Worker ${WORKER_ID} starting...`);
    console.log(`📊 Processing batches of ${BATCH_SIZE} videos`);
    console.log(`⏱️  Polling every ${POLL_INTERVAL / 1000} seconds`);
    console.log('🎮 Worker controlled via UI - waiting for enable signal...');
    
    // Main worker loop - now checks enabled state more frequently
    while (!this.isShuttingDown) {
      try {
        // Check if worker is enabled
        const isEnabled = await this.isWorkerEnabled();
        
        if (isEnabled) {
          // Only show initial state once when enabled
          if (!this.hasShownInitialState) {
            const totalCount = await this.getTotalVideoCount();
            const remainingCount = await this.getRemainingCount();
            console.log(`\n✅ Worker enabled via UI`);
            console.log(`📈 Initial state: ${totalCount} total videos, ${remainingCount} need embeddings`);
            this.hasShownInitialState = true;
          }
          
          await this.processBatch();
        } else {
          // Reset the initial state flag when disabled
          if (this.hasShownInitialState) {
            console.log('\n⏸️  Worker disabled via UI - pausing processing...');
            this.hasShownInitialState = false;
          }
        }
        
        // Check more frequently for enable/disable changes
        await this.sleep(5000); // Check every 5 seconds instead of 60
      } catch (error) {
        console.error('❌ Worker loop error:', error);
        await this.sleep(10000); // Wait 10s on error
      }
    }
  }

  async isWorkerEnabled() {
    try {
      const { data, error } = await supabase
        .from('worker_control')
        .select('is_enabled')
        .eq('worker_type', 'title_vectorization')
        .single();
      
      if (error) {
        console.error('❌ Error checking worker control:', error);
        return false;
      }
      
      return data?.is_enabled || false;
    } catch (error) {
      console.error('❌ Error checking worker control:', error);
      return false;
    }
  }

  async processBatch() {
    if (this.isProcessing) {
      console.log('⏳ Previous batch still processing, skipping...');
      return;
    }

    this.isProcessing = true;
    let hasMoreWork = true;
    let consecutiveErrors = 0;
    const MAX_CONSECUTIVE_ERRORS = 3;
    
    try {
      // Process continuously while enabled and there's work to do
      while (hasMoreWork && !this.isShuttingDown && await this.isWorkerEnabled()) {
        try {
          // Get batch of videos without title embeddings
          const { data: videos, error } = await supabase
            .from('videos')
            .select('*')
            .or('pinecone_embedded.is.null,pinecone_embedded.eq.false')
            .not('title', 'is', null)
            .limit(BATCH_SIZE)
            .order('published_at', { ascending: false });
          
          if (error) {
            console.error('❌ Error fetching videos:', error);
            consecutiveErrors++;
            if (consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
              console.error('❌ Too many consecutive errors, pausing processing');
              break;
            }
            await this.sleep(5000); // Wait 5s on error
            continue;
          }
          
          if (!videos || videos.length === 0) {
            const remainingCount = await this.getRemainingCount();
            if (remainingCount === 0) {
              console.log('✅ All videos have been embedded!');
            } else {
              console.log('📭 No videos in current batch, but ' + remainingCount + ' remain');
            }
            hasMoreWork = false;
            break;
          }
          
          // Check rate limits
          const currentMinute = Math.floor((Date.now() - this.rateLimit.minuteStartTime) / 60000);
          if (currentMinute > 0) {
            // Reset counters for new minute
            this.rateLimit.requestsThisMinute = 0;
            this.rateLimit.tokensThisMinute = 0;
            this.rateLimit.minuteStartTime = Date.now();
          }
          
          // Calculate how many we can process based on rate limits
          const remainingRequests = OPENAI_RPM_LIMIT - this.rateLimit.requestsThisMinute;
          const remainingTokens = OPENAI_TPM_LIMIT - this.rateLimit.tokensThisMinute;
          const maxByTokens = Math.floor(remainingTokens / TOKENS_PER_TITLE);
          const maxVideos = Math.min(videos.length, remainingRequests, maxByTokens);
          
          if (maxVideos <= 0) {
            // We've hit rate limits, wait until next minute
            const waitTime = 60000 - (Date.now() - this.rateLimit.minuteStartTime);
            console.log(`⏸️  Rate limit reached (${this.rateLimit.requestsThisMinute} requests, ${this.rateLimit.tokensThisMinute} tokens), waiting ${(waitTime/1000).toFixed(0)}s...`);
            await this.sleep(waitTime);
            continue;
          }
          
          // Process only what we can within rate limits
          const videosToProcess = videos.slice(0, maxVideos);
          
          console.log(`\n🎬 Processing batch of ${videosToProcess.length} videos (rate limit: ${remainingRequests} req, ${remainingTokens} tokens remaining)...`);
          const startTime = Date.now();
          
          // Update rate limit counters
          this.rateLimit.requestsThisMinute += videosToProcess.length;
          this.rateLimit.tokensThisMinute += videosToProcess.length * TOKENS_PER_TITLE;
          
          // Generate and store embeddings
          const results = await batchSyncVideosToPinecone(videosToProcess, process.env.OPENAI_API_KEY);
          
          // Count successes and errors
          let successCount = 0;
          let errorCount = 0;
          
          for (const result of results) {
            if (result.success) {
              successCount++;
              this.stats.processedCount++;
            } else {
              errorCount++;
              this.stats.errorCount++;
              console.error(`❌ Failed to embed video ${result.id}: ${result.error}`);
            }
          }
          
          const duration = ((Date.now() - startTime) / 1000).toFixed(1);
          console.log(`✅ Batch completed in ${duration}s: ${successCount} success, ${errorCount} errors`);
          
          // Update stats
          this.stats.lastProcessedAt = new Date();
          
          // Log progress every 10 batches or when significant progress made
          if (this.stats.processedCount % 500 === 0 || successCount === 0) {
            const remainingCount = await this.getRemainingCount();
            const rate = (this.stats.processedCount / ((Date.now() - this.stats.startTime) / 1000 / 60)).toFixed(0);
            console.log(`📊 Progress: ${this.stats.processedCount} processed, ${this.stats.errorCount} errors, ${remainingCount} remaining (${rate} videos/min)`);
          }
          
          // Reset consecutive errors on success
          if (successCount > 0) {
            consecutiveErrors = 0;
          }
          
          // Brief pause between batches to avoid overwhelming the API
          // Adaptive delay based on error rate
          if (errorCount > 0) {
            const errorRate = errorCount / videos.length;
            if (errorRate > 0.5) {
              console.log('⚠️ High error rate detected, backing off...');
              await this.sleep(10000); // 10s backoff on high errors
            } else {
              await this.sleep(2000); // 2s on some errors
            }
          } else {
            // Calculate optimal delay based on rate limits
            const requestsPerSecond = OPENAI_RPM_LIMIT / 60;
            const optimalDelay = Math.max(200, Math.floor(1000 / requestsPerSecond * videosToProcess.length));
            await this.sleep(optimalDelay);
          }
          
        } catch (error) {
          console.error('❌ Batch processing error:', error);
          this.stats.errorCount++;
          consecutiveErrors++;
          
          if (consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
            console.error('❌ Too many consecutive errors, pausing processing');
            break;
          }
          
          // Exponential backoff on errors
          const backoffTime = Math.min(consecutiveErrors * 5000, 30000);
          console.log(`⏳ Backing off for ${backoffTime / 1000}s...`);
          await this.sleep(backoffTime);
        }
      }
      
    } finally {
      this.isProcessing = false;
    }
  }

  async getTotalVideoCount() {
    try {
      const { count, error } = await supabase
        .from('videos')
        .select('id', { count: 'exact', head: true })
        .not('title', 'is', null);
      
      if (error) throw error;
      return count || 0;
    } catch (error) {
      console.error('❌ Error getting total count:', error);
      return 0;
    }
  }

  async getRemainingCount() {
    try {
      const { count, error } = await supabase
        .from('videos')
        .select('id', { count: 'exact', head: true })
        .or('pinecone_embedded.is.null,pinecone_embedded.eq.false')
        .not('title', 'is', null);
      
      if (error) throw error;
      return count || 0;
    } catch (error) {
      console.error('❌ Error getting remaining count:', error);
      return 0;
    }
  }

  async shutdown() {
    console.log('\n🛑 Shutting down title vectorization worker...');
    this.isShuttingDown = true;
    
    // Wait for active processing to complete
    if (this.isProcessing) {
      console.log('⏳ Waiting for current batch to complete...');
      while (this.isProcessing) {
        await this.sleep(1000);
      }
    }
    
    console.log(`📊 Final stats: ${this.stats.processedCount} processed, ${this.stats.errorCount} errors`);
    console.log('✅ Worker shutdown complete');
    process.exit(0);
  }

  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// Start the worker
async function main() {
  console.log('📋 Title Vectorization Worker');
  console.log('===========================');
  
  // Check environment variables
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    console.error('❌ Missing required environment variables:');
    console.error('   - NEXT_PUBLIC_SUPABASE_URL');
    console.error('   - SUPABASE_SERVICE_ROLE_KEY');
    process.exit(1);
  }
  
  if (!process.env.OPENAI_API_KEY) {
    console.error('❌ Missing required environment variable:');
    console.error('   - OPENAI_API_KEY');
    process.exit(1);
  }

  const worker = new TitleVectorizationWorker();
  await worker.start();
}

main().catch(error => {
  console.error('❌ Worker startup failed:', error);
  process.exit(1);
});