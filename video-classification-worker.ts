#!/usr/bin/env node

import { createClient } from '@supabase/supabase-js';
import { VideoClassificationService } from './lib/video-classification-service.ts';
import os from 'os';
import fs from 'fs/promises';
import path from 'path';

// Initialize Supabase client with service role for bypassing RLS
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// Worker configuration
const WORKER_ID = `video-classifier-${os.hostname()}-${process.pid}`;
const POLL_INTERVAL = 30000; // 30 seconds
const BATCH_SIZE = 50; // Process 50 videos at a time (balanced for both operations)

class VideoClassificationWorker {
  private classificationService: VideoClassificationService;
  private isShuttingDown: boolean = false;
  private isProcessing: boolean = false;
  private hasShownInitialState: boolean = false;
  private clustersLoaded: boolean = false;
  private stats = {
    processedCount: 0,
    topicsClassified: 0,
    formatsClassified: 0,
    llmCallCount: 0,
    errorCount: 0,
    lastProcessedAt: null as Date | null,
    startTime: Date.now()
  };

  constructor() {
    this.classificationService = new VideoClassificationService();
    
    // Handle graceful shutdown
    process.on('SIGINT', () => this.shutdown());
    process.on('SIGTERM', () => this.shutdown());
  }

  async start() {
    console.log(`🚀 Video Classification Worker ${WORKER_ID} starting...`);
    console.log(`📊 Processing batches of ${BATCH_SIZE} videos`);
    console.log(`⏱️  Polling every ${POLL_INTERVAL / 1000} seconds`);
    console.log('🎮 Worker controlled via UI - waiting for enable signal...');
    
    // Try to load clusters at startup
    await this.loadClusters();
    
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
            console.log(`📈 Initial state:`);
            console.log(`   Total videos: ${stats.totalVideos}`);
            console.log(`   Need topic classification: ${stats.needTopic}`);
            console.log(`   Need format classification: ${stats.needFormat}`);
            console.log(`   Fully classified: ${stats.fullyClassified}`);
            this.hasShownInitialState = true;
          }
          
          // Ensure clusters are loaded
          if (!this.clustersLoaded) {
            await this.loadClusters();
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

  async loadClusters() {
    try {
      console.log('📊 Loading BERTopic clusters for topic detection...');
      
      // Check if we have a local cluster file first
      const clusterFilePath = path.join(process.cwd(), 'exports', 'bertopic_clusters.json');
      try {
        await fs.access(clusterFilePath);
        console.log('📂 Found local cluster file, loading from disk...');
        await this.classificationService.topicService.loadClusters(clusterFilePath);
      } catch {
        console.log('🌐 No local cluster file, loading from database...');
        await this.classificationService.topicService.loadClusters();
      }
      
      this.clustersLoaded = true;
      const clusters = this.classificationService.topicService.getAllClusters();
      console.log(`✅ Loaded ${clusters.length} BERTopic clusters`);
        
    } catch (error) {
      console.error('❌ Error loading clusters:', error);
      this.clustersLoaded = false;
    }
  }

  async isWorkerEnabled(): Promise<boolean> {
    try {
      const { data, error } = await supabase
        .from('worker_control')
        .select('is_enabled')
        .eq('worker_type', 'video_classification')
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
          worker_type: 'video_classification',
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
          // Get batch of videos that need either topic or format classification
          const { data: videos, error } = await supabase
            .from('videos')
            .select('id, title, title_embedding, channel_name, description, topic_domain, format_type')
            .or('topic_domain.is.null,format_type.is.null')
            .not('channel_id', 'is', null)
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
            await this.sleep(5000);
            continue;
          }
          
          if (!videos || videos.length === 0) {
            const stats = await this.getClassificationStats();
            if (stats.needTopic === 0 && stats.needFormat === 0) {
              console.log('✅ All videos have been fully classified!');
            } else {
              console.log(`📭 No videos in current batch`);
              if (stats.needTopic > 0) {
                console.log(`📊 ${stats.needTopic} videos still need topic classification`);
              }
              if (stats.needFormat > 0) {
                console.log(`📊 ${stats.needFormat} videos still need format classification`);
              }
            }
            hasMoreWork = false;
            break;
          }
          
          // Separate videos by what they need
          const needTopic = videos.filter(v => !v.topic_domain && v.title_embedding);
          const needFormat = videos.filter(v => !v.format_type);
          const needBoth = videos.filter(v => !v.topic_domain && !v.format_type && v.title_embedding);
          
          console.log(`\n🎬 Processing batch of ${videos.length} videos:`);
          console.log(`   Need topic only: ${needTopic.length - needBoth.length}`);
          console.log(`   Need format only: ${needFormat.length - needBoth.length}`);
          console.log(`   Need both: ${needBoth.length}`);
          console.log(`   Missing embeddings: ${videos.filter(v => !v.topic_domain && !v.title_embedding).length}`);
          
          const startTime = Date.now();
          let processedCount = 0;
          let topicsCount = 0;
          let formatsCount = 0;
          
          // Reset statistics tracking for this batch
          this.classificationService.resetStatistics();
          
          // Process each video
          for (const video of videos) {
            try {
              const needsTopicClassification = !video.topic_domain && video.title_embedding;
              const needsFormatClassification = !video.format_type;
              
              if (!needsTopicClassification && !needsFormatClassification) {
                continue; // Skip if already fully classified
              }
              
              if (needsTopicClassification && needsFormatClassification) {
                // Full classification needed
                const classification = await this.classificationService.classifyVideo(
                  video.id,
                  video.title || '',
                  this.parseEmbedding(video.title_embedding),
                  video.channel_name || undefined,
                  video.description || undefined
                );
                
                await this.classificationService.storeClassifications([classification]);
                processedCount++;
                topicsCount++;
                formatsCount++;
              } else if (needsTopicClassification) {
                // Only topic classification needed
                const topicAssignment = await this.classificationService.topicService.assignTopic(
                  this.parseEmbedding(video.title_embedding)
                );
                
                await supabase
                  .from('videos')
                  .update({
                    topic_domain: topicAssignment.domain,
                    topic_niche: topicAssignment.niche,
                    topic_micro: topicAssignment.microTopic,
                    topic_cluster_id: topicAssignment.clusterId,
                    topic_confidence: topicAssignment.confidence,
                    topic_reasoning: topicAssignment.reasoning,
                    topic_classified_at: new Date().toISOString()
                  })
                  .eq('id', video.id);
                
                processedCount++;
                topicsCount++;
              } else if (needsFormatClassification) {
                // Only format classification needed
                const formatResult = this.classificationService.formatService.detectFormat(
                  video.title || '',
                  video.channel_name || undefined,
                  video.description || undefined
                );
                
                // Use LLM if needed
                let finalFormat = formatResult;
                if (formatResult.requiresLLM || formatResult.confidence < 0.6) {
                  const classification = await this.classificationService.classifyVideo(
                    video.id,
                    video.title || '',
                    [], // Empty embedding since we only need format
                    video.channel_name || undefined,
                    video.description || undefined
                  );
                  
                  await supabase
                    .from('videos')
                    .update({
                      format_type: classification.format.type,
                      format_confidence: classification.format.confidence,
                      format_primary: classification.format.type,
                      classification_llm_used: classification.format.llmUsed,
                      classification_timestamp: classification.metadata.classifiedAt
                    })
                    .eq('id', video.id);
                } else {
                  await supabase
                    .from('videos')
                    .update({
                      format_type: formatResult.format,
                      format_confidence: formatResult.confidence,
                      format_primary: formatResult.format,
                      classification_llm_used: false,
                      classification_timestamp: new Date().toISOString()
                    })
                    .eq('id', video.id);
                }
                
                processedCount++;
                formatsCount++;
              }
            } catch (error) {
              console.error(`❌ Error processing video ${video.id}:`, error);
              this.stats.errorCount++;
            }
          }
          
          // Update stats
          this.stats.processedCount += processedCount;
          this.stats.topicsClassified += topicsCount;
          this.stats.formatsClassified += formatsCount;
          this.stats.lastProcessedAt = new Date();
          
          // Get batch statistics
          const batchStats = this.classificationService.getStatistics();
          this.stats.llmCallCount += batchStats.llmCallCount;
          
          const duration = ((Date.now() - startTime) / 1000).toFixed(1);
          console.log(`\n✅ Batch completed in ${duration}s:`);
          console.log(`   Processed: ${processedCount} videos`);
          console.log(`   Topics classified: ${topicsCount}`);
          console.log(`   Formats classified: ${formatsCount}`);
          console.log(`   LLM calls: ${batchStats.llmCallCount}`);
          console.log(`   Low confidence: ${batchStats.lowConfidenceCount}`);
          
          // Export low confidence cases for analysis
          if (batchStats.lowConfidenceCount > 0) {
            const lowConfidenceCases = this.classificationService.exportLowConfidenceCases();
            console.log('\n⚠️  Low confidence examples:');
            lowConfidenceCases.slice(0, 3).forEach(c => {
              console.log(`   "${c.title.substring(0, 60)}..."`);
              console.log(`   Topic: ${c.topic} (${(c.topicConfidence * 100).toFixed(0)}%)`);
              console.log(`   Format: ${c.format} (${(c.formatConfidence * 100).toFixed(0)}%)`);
            });
          }
          
          // Log progress periodically
          if (this.stats.processedCount % 500 === 0 || videos.length < BATCH_SIZE) {
            const stats = await this.getClassificationStats();
            const rate = (this.stats.processedCount / ((Date.now() - this.stats.startTime) / 1000 / 60)).toFixed(0);
            console.log(`\n📊 Progress Report:`);
            console.log(`   Processed this session: ${this.stats.processedCount}`);
            console.log(`   Topics classified: ${this.stats.topicsClassified}`);
            console.log(`   Formats classified: ${this.stats.formatsClassified}`);
            console.log(`   LLM calls: ${this.stats.llmCallCount}`);
            console.log(`   Processing rate: ${rate} videos/min`);
            console.log(`   Fully classified: ${stats.fullyClassified}/${stats.totalVideos} (${((stats.fullyClassified/stats.totalVideos)*100).toFixed(1)}%)`);
          }
          
          // Reset consecutive errors on success
          if (processedCount > 0) {
            consecutiveErrors = 0;
          }
          
          // Brief pause between batches
          await this.sleep(1000);
          
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

  parseEmbedding(embedding: any): number[] {
    if (!embedding) return [];
    
    if (Array.isArray(embedding)) {
      return embedding;
    }
    
    if (typeof embedding === 'string') {
      // Parse pgvector format [1,2,3]
      return embedding
        .slice(1, -1)
        .split(',')
        .map(Number);
    }
    
    return [];
  }

  async getClassificationStats() {
    try {
      const [totalResult, topicResult, formatResult, fullyResult] = await Promise.all([
        // Total videos with channels
        supabase
          .from('videos')
          .select('id', { count: 'exact', head: true })
          .not('channel_id', 'is', null),
        
        // Videos with topic classification
        supabase
          .from('videos')
          .select('id', { count: 'exact', head: true })
          .not('topic_domain', 'is', null)
          .not('channel_id', 'is', null),
        
        // Videos with format classification
        supabase
          .from('videos')
          .select('id', { count: 'exact', head: true })
          .not('format_type', 'is', null)
          .not('channel_id', 'is', null),
        
        // Fully classified videos
        supabase
          .from('videos')
          .select('id', { count: 'exact', head: true })
          .not('topic_domain', 'is', null)
          .not('format_type', 'is', null)
          .not('channel_id', 'is', null)
      ]);
      
      const totalVideos = totalResult.count || 0;
      const withTopic = topicResult.count || 0;
      const withFormat = formatResult.count || 0;
      const fullyClassified = fullyResult.count || 0;
      
      return {
        totalVideos,
        withTopic,
        withFormat,
        fullyClassified,
        needTopic: totalVideos - withTopic,
        needFormat: totalVideos - withFormat
      };
    } catch (error) {
      console.error('❌ Error getting classification stats:', error);
      return {
        totalVideos: 0,
        withTopic: 0,
        withFormat: 0,
        fullyClassified: 0,
        needTopic: 0,
        needFormat: 0
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
            topicsClassified: this.stats.topicsClassified,
            formatsClassified: this.stats.formatsClassified,
            llmCallCount: this.stats.llmCallCount,
            lastProcessedAt: this.stats.lastProcessedAt,
            clustersLoaded: this.clustersLoaded
          }
        })
        .eq('worker_type', 'video_classification');
      
      if (error) {
        console.error('❌ Error updating heartbeat:', error);
      }
    } catch (error) {
      console.error('❌ Error updating heartbeat:', error);
    }
  }

  async shutdown() {
    console.log('\n🛑 Shutting down video classification worker...');
    this.isShuttingDown = true;
    
    // Wait for active processing to complete
    if (this.isProcessing) {
      console.log('⏳ Waiting for current batch to complete...');
      while (this.isProcessing) {
        await this.sleep(1000);
      }
    }
    
    console.log(`\n📊 Session Statistics:`);
    console.log(`   Total processed: ${this.stats.processedCount}`);
    console.log(`   Topics classified: ${this.stats.topicsClassified}`);
    console.log(`   Formats classified: ${this.stats.formatsClassified}`);
    console.log(`   LLM calls made: ${this.stats.llmCallCount}`);
    console.log(`   Errors: ${this.stats.errorCount}`);
    
    const duration = (Date.now() - this.stats.startTime) / 1000 / 60;
    console.log(`   Duration: ${duration.toFixed(1)} minutes`);
    console.log(`   Average rate: ${(this.stats.processedCount / duration).toFixed(0)} videos/min`);
    
    console.log('✅ Worker shutdown complete');
    process.exit(0);
  }

  sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// Start the worker
async function main() {
  console.log('📋 Video Classification Worker');
  console.log('==============================');
  console.log('🔧 This worker performs both topic and format classification');
  
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

  const worker = new VideoClassificationWorker();
  await worker.start();
}

main().catch(error => {
  console.error('❌ Worker startup failed:', error);
  process.exit(1);
});