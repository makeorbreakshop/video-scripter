#!/usr/bin/env node

import { createClient } from '@supabase/supabase-js';
import { batchGenerateThumbnailEmbeddings } from './lib/thumbnail-embeddings.ts';
import { pineconeService } from './lib/pinecone-service.ts';
import os from 'os';

// Initialize Supabase client with service role for bypassing RLS
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// Worker configuration
const WORKER_ID = `thumbnail-vectorizer-${os.hostname()}-${process.pid}`;
const POLL_INTERVAL = 90000; // 90 seconds (slower for thumbnail processing)
const BATCH_SIZE = 20; // Smaller batch size for thumbnails (API rate limits)

// Replicate API doesn't have public rate limits, but based on experience:
// - Can handle about 5-10 requests per second
// - Each request takes 1-3 seconds to process
// Pinecone limits: ~100 vectors per upsert request, 2MB max request size
const REPLICATE_RPS_LIMIT = 5; // Conservative estimate
const PINECONE_BATCH_SIZE = 100; // Max vectors per upsert

class ThumbnailVectorizationWorker {
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
      requestsThisSecond: 0,
      secondStartTime: Date.now()
    };
    
    // Handle graceful shutdown
    process.on('SIGINT', () => this.shutdown());
    process.on('SIGTERM', () => this.shutdown());
  }

  async start() {
    console.log(`🚀 Thumbnail Vectorization Worker ${WORKER_ID} starting...`);
    console.log(`📊 Processing batches of ${BATCH_SIZE} thumbnails`);
    console.log(`⏱️  Polling every ${POLL_INTERVAL / 1000} seconds`);
    console.log('🎮 Worker controlled via UI - waiting for enable signal...');
    
    // Main worker loop
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
            console.log(`📈 Initial state: ${totalCount} total videos, ${remainingCount} need thumbnail embeddings`);
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
        await this.sleep(5000); // Check every 5 seconds instead of 90
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
        .eq('worker_type', 'thumbnail_vectorization')
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
          // Get batch of videos without thumbnail embeddings
          const { data: videos, error } = await supabase
            .from('videos')
            .select('id, title, thumbnail_url, channel_id, channel_name, published_at')
            .or('embedding_thumbnail_synced.is.null,embedding_thumbnail_synced.eq.false')
            .not('thumbnail_url', 'is', null)
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
              console.log('✅ All thumbnails have been embedded!');
            } else {
              console.log('📭 No videos in current batch, but ' + remainingCount + ' remain');
            }
            hasMoreWork = false;
            break;
          }
          
          // Check rate limits (per second for Replicate)
          const currentSecond = Math.floor((Date.now() - this.rateLimit.secondStartTime) / 1000);
          if (currentSecond > 0) {
            // Reset counter for new second
            this.rateLimit.requestsThisSecond = 0;
            this.rateLimit.secondStartTime = Date.now();
          }
          
          // Calculate how many we can process based on rate limits
          const remainingRequests = REPLICATE_RPS_LIMIT - this.rateLimit.requestsThisSecond;
          const maxVideos = Math.min(videos.length, remainingRequests, BATCH_SIZE);
          
          if (maxVideos <= 0) {
            // We've hit rate limits, wait until next second
            const waitTime = 1000 - (Date.now() - this.rateLimit.secondStartTime);
            console.log(`⏸️  Rate limit reached (${this.rateLimit.requestsThisSecond}/${REPLICATE_RPS_LIMIT} requests), waiting ${waitTime}ms...`);
            await this.sleep(waitTime);
            continue;
          }
          
          // Process only what we can within rate limits
          const videosToProcess = videos.slice(0, maxVideos);
          
          console.log(`\n🖼️  Processing batch of ${videosToProcess.length} thumbnails (${remainingRequests} requests remaining this second)...`);
          const startTime = Date.now();
          
          // Update rate limit counter
          this.rateLimit.requestsThisSecond += videosToProcess.length;
          
          // Prepare data for batch processing
          const videoData = videosToProcess.map(v => ({
            id: v.id,
            thumbnailUrl: v.thumbnail_url
          }));
          
          // Generate embeddings
          const results = await batchGenerateThumbnailEmbeddings(
            videoData,
            maxVideos,
            (progress) => {
              console.log(`📸 Batch progress: ${progress.success}/${progress.total} processed`);
            },
            true // Use adaptive rate limiting
          );
          
          // Process results and store in Pinecone
          let successCount = 0;
          let errorCount = 0;
          
          for (const result of results) {
            if (result.success && result.embedding) {
              try {
                // Store in Pinecone
                await pineconeService.upsertThumbnailVector({
                  id: result.id,
                  embedding: result.embedding,
                  metadata: {
                    title: videos.find(v => v.id === result.id)?.title || '',
                    channel_id: videos.find(v => v.id === result.id)?.channel_id || '',
                    thumbnail_url: videos.find(v => v.id === result.id)?.thumbnail_url || ''
                  }
                });
                
                // Update database
                await supabase
                  .from('videos')
                  .update({
                    embedding_thumbnail_synced: true,
                    thumbnail_embedding_version: 'clip-vit-base-patch32'
                  })
                  .eq('id', result.id);
                
                successCount++;
                this.stats.processedCount++;
              } catch (error) {
                errorCount++;
                this.stats.errorCount++;
                console.error(`❌ Failed to store thumbnail embedding for video ${result.id}:`, error);
              }
            } else {
              errorCount++;
              this.stats.errorCount++;
              console.error(`❌ Failed to generate embedding for video ${result.id}: ${result.error}`);
            }
          }
          
          const duration = ((Date.now() - startTime) / 1000).toFixed(1);
          console.log(`✅ Batch completed in ${duration}s: ${successCount} success, ${errorCount} errors`);
          
          // Update stats
          this.stats.lastProcessedAt = new Date();
          
          // Log progress every 5 batches or when significant progress made
          if (this.stats.processedCount % 100 === 0 || successCount === 0) {
            const remainingCount = await this.getRemainingCount();
            const rate = (this.stats.processedCount / ((Date.now() - this.stats.startTime) / 1000 / 60)).toFixed(0);
            console.log(`📊 Progress: ${this.stats.processedCount} processed, ${this.stats.errorCount} errors, ${remainingCount} remaining (${rate} thumbnails/min)`);
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
              await this.sleep(30000); // 30s backoff on high errors (thumbnails are more rate limited)
            } else {
              await this.sleep(10000); // 10s on some errors
            }
          } else {
            // Calculate optimal delay based on rate limits
            // Replicate processes ~5 requests/second, so space them out
            const optimalDelay = Math.max(1000, Math.floor(1000 / REPLICATE_RPS_LIMIT * videosToProcess.length));
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
          const backoffTime = Math.min(consecutiveErrors * 10000, 60000);
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
        .not('thumbnail_url', 'is', null);
      
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
        .or('embedding_thumbnail_synced.is.null,embedding_thumbnail_synced.eq.false')
        .not('thumbnail_url', 'is', null);
      
      if (error) throw error;
      return count || 0;
    } catch (error) {
      console.error('❌ Error getting remaining count:', error);
      return 0;
    }
  }

  async shutdown() {
    console.log('\n🛑 Shutting down thumbnail vectorization worker...');
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
  console.log('📋 Thumbnail Vectorization Worker');
  console.log('================================');
  
  // Check environment variables
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    console.error('❌ Missing required environment variables:');
    console.error('   - NEXT_PUBLIC_SUPABASE_URL');
    console.error('   - SUPABASE_SERVICE_ROLE_KEY');
    process.exit(1);
  }
  
  if (!process.env.REPLICATE_API_TOKEN) {
    console.error('❌ Missing required environment variable:');
    console.error('   - REPLICATE_API_TOKEN');
    process.exit(1);
  }

  const worker = new ThumbnailVectorizationWorker();
  await worker.start();
}

main().catch(error => {
  console.error('❌ Worker startup failed:', error);
  process.exit(1);
});