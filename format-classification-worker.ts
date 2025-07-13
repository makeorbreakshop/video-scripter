#!/usr/bin/env node

import { createClient } from '@supabase/supabase-js';
import { LLMFormatClassificationService } from './lib/llm-format-classification-service.ts';
import os from 'os';

// Initialize Supabase client with service role for bypassing RLS
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// Worker configuration
const WORKER_ID = `format-classifier-${os.hostname()}-${process.pid}`;
const POLL_INTERVAL = 30000; // 30 seconds
const BATCH_SIZE = 500; // Process 500 videos at a time (service handles sub-batching)

class FormatClassificationWorker {
  private llmService: LLMFormatClassificationService;
  private isShuttingDown: boolean = false;
  private isProcessing: boolean = false;
  private hasShownInitialState: boolean = false;
  private stats = {
    processedCount: 0,
    errorCount: 0,
    tokensUsed: 0,
    lastProcessedAt: null as Date | null,
    startTime: Date.now()
  };

  constructor() {
    this.llmService = new LLMFormatClassificationService();
    
    // Handle graceful shutdown
    process.on('SIGINT', () => this.shutdown());
    process.on('SIGTERM', () => this.shutdown());
  }

  async start() {
    console.log(`🚀 Format Classification Worker ${WORKER_ID} starting...`);
    console.log(`📊 Processing batches of ${BATCH_SIZE} videos`);
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
            const stats = await this.getClassificationStats();
            console.log(`\n✅ Worker enabled via UI`);
            console.log(`📈 Initial state: ${stats.totalVideos} total videos, ${stats.unclassified} need classification`);
            console.log(`📊 Already classified: ${stats.classified} (${stats.llmClassified} via LLM)`);
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
        await this.sleep(5000); // Check every 5 seconds
      } catch (error) {
        console.error('❌ Worker loop error:', error);
        await this.sleep(10000); // Wait 10s on error
      }
    }
  }

  async isWorkerEnabled(): Promise<boolean> {
    try {
      const { data, error } = await supabase
        .from('worker_control')
        .select('is_enabled')
        .eq('worker_type', 'format_classification')
        .single();
      
      if (error) {
        // If worker control doesn't exist, create it
        if (error.code === 'PGRST116') {
          await this.createWorkerControl();
          return false;
        }
        console.error('❌ Error checking worker control:', error);
        return false;
      }
      
      return data?.is_enabled || false;
    } catch (error) {
      console.error('❌ Error checking worker control:', error);
      return false;
    }
  }

  async createWorkerControl() {
    try {
      const { error } = await supabase
        .from('worker_control')
        .insert({
          worker_type: 'format_classification',
          is_enabled: false,
          last_heartbeat: new Date().toISOString()
        });
      
      if (error) {
        console.error('❌ Error creating worker control:', error);
      } else {
        console.log('✅ Created worker control entry');
      }
    } catch (error) {
      console.error('❌ Error creating worker control:', error);
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
      // Update heartbeat
      await this.updateHeartbeat();
      
      // Process continuously while enabled and there's work to do
      while (hasMoreWork && !this.isShuttingDown && await this.isWorkerEnabled()) {
        try {
          // Get batch of videos without format classification
          const { data: videos, error } = await supabase
            .from('videos')
            .select('id, title, channel_name, description')
            .is('format_type', null)
            .not('title', 'is', null)
            .not('channel_id', 'is', null)
            .limit(BATCH_SIZE)
            .order('published_at', { ascending: false });
          
          if (error) {
            console.error('❌ Error fetching videos:', error);
            consecutiveErrors++;
            if (consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
              console.error('❌ Too many consecutive errors, pausing processing');
              break;
            }
            await this.sleep(5000);
            continue;
          }
          
          if (!videos || videos.length === 0) {
            const stats = await this.getClassificationStats();
            if (stats.unclassified === 0) {
              console.log('✅ All videos have been classified!');
            } else {
              console.log(`📭 No videos in current batch, but ${stats.unclassified} remain unclassified`);
            }
            hasMoreWork = false;
            break;
          }
          
          console.log(`\n🎬 Processing batch of ${videos.length} videos...`);
          const startTime = Date.now();
          
          // Use the LLM service to classify videos
          const result = await this.llmService.classifyBatch(
            videos.map(v => ({
              id: v.id,
              title: v.title || '',
              channel: v.channel_name || undefined,
              description: v.description || undefined
            }))
          );
          
          // Store classifications
          await this.llmService.storeClassifications(result.classifications);
          
          // Update stats
          this.stats.processedCount += result.classifications.length;
          this.stats.tokensUsed += result.totalTokens;
          this.stats.lastProcessedAt = new Date();
          
          const duration = ((Date.now() - startTime) / 1000).toFixed(1);
          console.log(`✅ Batch completed in ${duration}s: ${result.classifications.length} videos classified`);
          console.log(`💰 Tokens used: ${result.totalTokens.toLocaleString()} (total session: ${this.stats.tokensUsed.toLocaleString()})`);
          console.log(`⚡ Processing speed: ${(videos.length / (result.processingTimeMs / 1000)).toFixed(1)} videos/second`);
          
          // Log progress periodically
          if (this.stats.processedCount % 1000 === 0 || videos.length < BATCH_SIZE) {
            const stats = await this.getClassificationStats();
            const rate = (this.stats.processedCount / ((Date.now() - this.stats.startTime) / 1000 / 60)).toFixed(0);
            console.log(`\n📊 Progress Report:`);
            console.log(`   Processed this session: ${this.stats.processedCount}`);
            console.log(`   Tokens used: ${this.stats.tokensUsed.toLocaleString()}`);
            console.log(`   Processing rate: ${rate} videos/min`);
            console.log(`   Total classified: ${stats.classified}/${stats.totalVideos} (${((stats.classified/stats.totalVideos)*100).toFixed(1)}%)`);
            console.log(`   Remaining: ${stats.unclassified}`);
          }
          
          // Reset consecutive errors on success
          consecutiveErrors = 0;
          
          // Brief pause between batches
          await this.sleep(2000);
          
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

  async getClassificationStats() {
    try {
      const [totalResult, classifiedResult, llmResult] = await Promise.all([
        // Total videos with channels
        supabase
          .from('videos')
          .select('id', { count: 'exact', head: true })
          .not('channel_id', 'is', null),
        
        // Videos with format classification
        supabase
          .from('videos')
          .select('id', { count: 'exact', head: true })
          .not('format_type', 'is', null)
          .not('channel_id', 'is', null),
        
        // Videos classified with LLM
        supabase
          .from('videos')
          .select('id', { count: 'exact', head: true })
          .eq('classification_llm_used', true)
          .not('channel_id', 'is', null)
      ]);
      
      const totalVideos = totalResult.count || 0;
      const classified = classifiedResult.count || 0;
      const llmClassified = llmResult.count || 0;
      const unclassified = totalVideos - classified;
      
      return {
        totalVideos,
        classified,
        unclassified,
        llmClassified
      };
    } catch (error) {
      console.error('❌ Error getting classification stats:', error);
      return {
        totalVideos: 0,
        classified: 0,
        unclassified: 0,
        llmClassified: 0
      };
    }
  }

  async updateHeartbeat() {
    try {
      const { error } = await supabase
        .from('worker_control')
        .update({ 
          last_heartbeat: new Date().toISOString(),
          worker_info: {
            workerId: WORKER_ID,
            processedCount: this.stats.processedCount,
            tokensUsed: this.stats.tokensUsed,
            lastProcessedAt: this.stats.lastProcessedAt
          }
        })
        .eq('worker_type', 'format_classification');
      
      if (error) {
        console.error('❌ Error updating heartbeat:', error);
      }
    } catch (error) {
      console.error('❌ Error updating heartbeat:', error);
    }
  }

  async shutdown() {
    console.log('\n🛑 Shutting down format classification worker...');
    this.isShuttingDown = true;
    
    // Wait for active processing to complete
    if (this.isProcessing) {
      console.log('⏳ Waiting for current batch to complete...');
      while (this.isProcessing) {
        await this.sleep(1000);
      }
    }
    
    // Log final statistics
    try {
      const stats = await this.llmService.getStatistics();
      console.log(`\n📊 Final Statistics:`);
      console.log(`   Total classified: ${stats.totalClassified}`);
      console.log(`   Average confidence: ${(stats.averageConfidence * 100).toFixed(1)}%`);
      console.log(`   Format distribution:`);
      
      const sortedFormats = Object.entries(stats.formatDistribution)
        .sort(([,a], [,b]) => b - a)
        .filter(([,count]) => count > 0);
      
      for (const [format, count] of sortedFormats) {
        const percentage = ((count / stats.totalClassified) * 100).toFixed(1);
        console.log(`     ${format}: ${count} (${percentage}%)`);
      }
    } catch (error) {
      console.error('❌ Error getting final statistics:', error);
    }
    
    console.log(`\n📊 Session stats: ${this.stats.processedCount} processed, ${this.stats.errorCount} errors`);
    console.log(`💰 Total tokens used: ${this.stats.tokensUsed.toLocaleString()}`);
    console.log('✅ Worker shutdown complete');
    process.exit(0);
  }

  sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// Start the worker
async function main() {
  console.log('📋 Format Classification Worker');
  console.log('==============================');
  
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

  const worker = new FormatClassificationWorker();
  await worker.start();
}

main().catch(error => {
  console.error('❌ Worker startup failed:', error);
  process.exit(1);
});