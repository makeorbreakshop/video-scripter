#!/usr/bin/env node

import { createClient } from '@supabase/supabase-js';
import { TopicDetectionService } from './lib/topic-detection-service.ts';
import os from 'os';
import fs from 'fs/promises';
import path from 'path';

// Initialize Supabase client with service role for bypassing RLS
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// Worker configuration
const WORKER_ID = `topic-classifier-${os.hostname()}-${process.pid}`;
const POLL_INTERVAL = 30000; // 30 seconds
const BATCH_SIZE = 100; // Process 100 videos at a time (topic detection is fast)

class TopicClassificationWorker {
  private topicService: TopicDetectionService;
  private isShuttingDown: boolean = false;
  private isProcessing: boolean = false;
  private hasShownInitialState: boolean = false;
  private clustersLoaded: boolean = false;
  private stats = {
    processedCount: 0,
    errorCount: 0,
    lastProcessedAt: null as Date | null,
    startTime: Date.now()
  };

  constructor() {
    // Use k=10 for better accuracy
    this.topicService = new TopicDetectionService(10);
    
    // Handle graceful shutdown
    process.on('SIGINT', () => this.shutdown());
    process.on('SIGTERM', () => this.shutdown());
  }

  async start() {
    console.log(`🚀 Topic Classification Worker ${WORKER_ID} starting...`);
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
            console.log(`📈 Initial state: ${stats.totalVideos} total videos, ${stats.unclassified} need topic classification`);
            console.log(`📊 Already classified: ${stats.classified}`);
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
      console.log('📊 Loading BERTopic clusters...');
      
      // Check if we have a local cluster file first
      const clusterFilePath = path.join(process.cwd(), 'exports', 'bertopic_clusters.json');
      try {
        await fs.access(clusterFilePath);
        console.log('📂 Found local cluster file, loading from disk...');
        await this.topicService.loadClusters(clusterFilePath);
      } catch {
        console.log('🌐 No local cluster file, loading from database...');
        await this.topicService.loadClusters();
      }
      
      this.clustersLoaded = true;
      const clusters = this.topicService.getAllClusters();
      console.log(`✅ Loaded ${clusters.length} BERTopic clusters`);
      
      // Show cluster distribution
      const domainCounts = new Map<string, number>();
      clusters.forEach(cluster => {
        domainCounts.set(cluster.grandparent_topic, (domainCounts.get(cluster.grandparent_topic) || 0) + 1);
      });
      
      console.log('📊 Cluster distribution by domain:');
      Array.from(domainCounts.entries())
        .sort(([,a], [,b]) => b - a)
        .slice(0, 10)
        .forEach(([domain, count]) => {
          console.log(`   ${domain}: ${count} clusters`);
        });
        
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
        .eq('worker_type', 'topic_classification')
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
          worker_type: 'topic_classification',
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
          // Get batch of videos without topic classification that have embeddings
          const { data: videos, error } = await supabase
            .from('videos')
            .select('id, title, title_embedding')
            .is('topic_domain', null)
            .not('title_embedding', 'is', null)
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
            if (stats.unclassified === 0 && stats.missingEmbeddings === 0) {
              console.log('✅ All videos have been topic classified!');
            } else {
              console.log(`📭 No videos with embeddings to classify`);
              if (stats.missingEmbeddings > 0) {
                console.log(`⚠️  ${stats.missingEmbeddings} videos are missing embeddings - run title vectorization first`);
              }
              if (stats.unclassified > 0) {
                console.log(`📊 ${stats.unclassified} videos remain unclassified`);
              }
            }
            hasMoreWork = false;
            break;
          }
          
          console.log(`\n🎬 Processing batch of ${videos.length} videos...`);
          const startTime = Date.now();
          
          // Process embeddings
          const embeddings = videos.map(v => ({
            videoId: v.id,
            embedding: this.parseEmbedding(v.title_embedding)
          }));
          
          // Assign topics using the service
          const assignments = await this.topicService.assignTopicsBatch(embeddings);
          
          // Update videos with topic assignments
          let successCount = 0;
          let errorCount = 0;
          
          for (const [videoId, assignment] of assignments.entries()) {
            try {
              const { error: updateError } = await supabase
                .from('videos')
                .update({
                  topic_domain: assignment.domain,
                  topic_niche: assignment.niche,
                  topic_micro: assignment.microTopic,
                  topic_cluster_id: assignment.clusterId,
                  topic_confidence: assignment.confidence,
                  topic_reasoning: assignment.reasoning,
                  topic_classified_at: new Date().toISOString()
                })
                .eq('id', videoId);
              
              if (updateError) {
                console.error(`❌ Error updating video ${videoId}:`, updateError);
                errorCount++;
              } else {
                successCount++;
              }
            } catch (error) {
              console.error(`❌ Error updating video ${videoId}:`, error);
              errorCount++;
            }
          }
          
          // Update stats
          this.stats.processedCount += successCount;
          this.stats.errorCount += errorCount;
          this.stats.lastProcessedAt = new Date();
          
          const duration = ((Date.now() - startTime) / 1000).toFixed(1);
          console.log(`✅ Batch completed in ${duration}s: ${successCount} success, ${errorCount} errors`);
          
          // Show some example classifications
          const examples = Array.from(assignments.entries()).slice(0, 3);
          console.log('📝 Example classifications:');
          for (const [videoId, assignment] of examples) {
            const video = videos.find(v => v.id === videoId);
            console.log(`   "${video?.title?.substring(0, 60)}..."`);
            console.log(`   → ${assignment.domain} > ${assignment.niche} > ${assignment.microTopic}`);
            console.log(`   Confidence: ${(assignment.confidence * 100).toFixed(0)}%`);
          }
          
          // Log progress periodically
          if (this.stats.processedCount % 500 === 0 || videos.length < BATCH_SIZE) {
            const stats = await this.getClassificationStats();
            const rate = (this.stats.processedCount / ((Date.now() - this.stats.startTime) / 1000 / 60)).toFixed(0);
            console.log(`\n📊 Progress Report:`);
            console.log(`   Processed this session: ${this.stats.processedCount}`);
            console.log(`   Processing rate: ${rate} videos/min`);
            console.log(`   Total classified: ${stats.classified}/${stats.totalVideos} (${((stats.classified/stats.totalVideos)*100).toFixed(1)}%)`);
            console.log(`   Remaining: ${stats.unclassified}`);
            if (stats.missingEmbeddings > 0) {
              console.log(`   Missing embeddings: ${stats.missingEmbeddings}`);
            }
          }
          
          // Reset consecutive errors on success
          if (successCount > 0) {
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
    
    throw new Error('Invalid embedding format');
  }

  async getClassificationStats() {
    try {
      const [totalResult, classifiedResult, missingEmbeddingsResult] = await Promise.all([
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
        
        // Videos missing embeddings
        supabase
          .from('videos')
          .select('id', { count: 'exact', head: true })
          .is('title_embedding', null)
          .not('channel_id', 'is', null)
      ]);
      
      const totalVideos = totalResult.count || 0;
      const classified = classifiedResult.count || 0;
      const missingEmbeddings = missingEmbeddingsResult.count || 0;
      const unclassified = totalVideos - classified;
      
      return {
        totalVideos,
        classified,
        unclassified,
        missingEmbeddings
      };
    } catch (error) {
      console.error('❌ Error getting classification stats:', error);
      return {
        totalVideos: 0,
        classified: 0,
        unclassified: 0,
        missingEmbeddings: 0
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
            lastProcessedAt: this.stats.lastProcessedAt,
            clustersLoaded: this.clustersLoaded
          }
        })
        .eq('worker_type', 'topic_classification');
      
      if (error) {
        console.error('❌ Error updating heartbeat:', error);
      }
    } catch (error) {
      console.error('❌ Error updating heartbeat:', error);
    }
  }

  async shutdown() {
    console.log('\n🛑 Shutting down topic classification worker...');
    this.isShuttingDown = true;
    
    // Wait for active processing to complete
    if (this.isProcessing) {
      console.log('⏳ Waiting for current batch to complete...');
      while (this.isProcessing) {
        await this.sleep(1000);
      }
    }
    
    // Get final statistics
    try {
      const stats = await this.getClassificationStats();
      console.log(`\n📊 Final Statistics:`);
      console.log(`   Total videos: ${stats.totalVideos}`);
      console.log(`   Topic classified: ${stats.classified} (${((stats.classified/stats.totalVideos)*100).toFixed(1)}%)`);
      console.log(`   Remaining: ${stats.unclassified}`);
      
      // Get topic distribution
      const { data: topicDist } = await supabase
        .from('videos')
        .select('topic_domain')
        .not('topic_domain', 'is', null);
      
      if (topicDist) {
        const domainCounts = new Map<string, number>();
        topicDist.forEach(v => {
          domainCounts.set(v.topic_domain, (domainCounts.get(v.topic_domain) || 0) + 1);
        });
        
        console.log('\n📊 Topic distribution:');
        Array.from(domainCounts.entries())
          .sort(([,a], [,b]) => b - a)
          .slice(0, 10)
          .forEach(([domain, count]) => {
            const percentage = ((count / stats.classified) * 100).toFixed(1);
            console.log(`   ${domain}: ${count} (${percentage}%)`);
          });
      }
    } catch (error) {
      console.error('❌ Error getting final statistics:', error);
    }
    
    console.log(`\n📊 Session stats: ${this.stats.processedCount} processed, ${this.stats.errorCount} errors`);
    console.log('✅ Worker shutdown complete');
    process.exit(0);
  }

  sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// Start the worker
async function main() {
  console.log('📋 Topic Classification Worker');
  console.log('=============================');
  
  // Check environment variables
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    console.error('❌ Missing required environment variables:');
    console.error('   - NEXT_PUBLIC_SUPABASE_URL');
    console.error('   - SUPABASE_SERVICE_ROLE_KEY');
    process.exit(1);
  }

  const worker = new TopicClassificationWorker();
  await worker.start();
}

main().catch(error => {
  console.error('❌ Worker startup failed:', error);
  process.exit(1);
});