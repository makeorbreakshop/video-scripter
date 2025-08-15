#!/usr/bin/env node

import { createClient } from '@supabase/supabase-js';
import { VideoImportService } from './lib/unified-video-import.ts';
import { quotaTracker } from './lib/youtube-quota-tracker.ts';
import os from 'os';

// Initialize Supabase client with service role for bypassing RLS
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// Worker configuration
const WORKER_ID = `${os.hostname()}-${process.pid}`;
const POLL_INTERVAL = 30000; // 30 seconds
const CONCURRENT_JOBS = 3; // Process up to 3 jobs concurrently

// Type definitions for jobs
interface Job {
  job_id: string;
  video_id: string;
  source: string;
  metadata: any;
  priority: number;
}

class VideoWorker {
  private videoImportService: VideoImportService;
  private isShuttingDown: boolean;
  private activeJobs: Set<string>;

  constructor() {
    this.videoImportService = new VideoImportService();
    this.isShuttingDown = false;
    this.activeJobs = new Set();
    
    // Handle graceful shutdown
    process.on('SIGINT', () => this.shutdown());
    process.on('SIGTERM', () => this.shutdown());
  }

  async start() {
    console.log(`🚀 Video Worker ${WORKER_ID} starting...`);
    console.log(`📊 Processing up to ${CONCURRENT_JOBS} jobs concurrently`);
    console.log(`⏱️  Polling every ${POLL_INTERVAL / 1000} seconds`);
    
    // Clean up any stuck jobs from previous runs
    await this.cleanupStuckJobs();
    
    console.log('🔄 Starting main worker loop...');
    
    // Main worker loop
    while (!this.isShuttingDown) {
      try {
        console.log(`🔍 Polling for jobs at ${new Date().toLocaleTimeString()}...`);
        await this.processJobs();
        console.log(`⏰ Sleeping for ${POLL_INTERVAL / 1000} seconds...`);
        await this.sleep(POLL_INTERVAL);
      } catch (error) {
        console.error('❌ Worker loop error:', error);
        await this.sleep(60000); // Wait longer on error
      }
    }
  }

  async cleanupStuckJobs() {
    try {
      console.log('🔍 Checking for stuck jobs from previous runs...');
      
      // Find jobs that have been processing for more than 30 minutes
      const thirtyMinutesAgo = new Date(Date.now() - 30 * 60 * 1000).toISOString();
      
      const { data: stuckJobs, error: fetchError } = await supabase
        .from('video_processing_jobs')
        .select('*')
        .eq('status', 'processing')
        .lt('started_at', thirtyMinutesAgo);
      
      if (fetchError) {
        console.error('❌ Error fetching stuck jobs:', fetchError);
        return;
      }
      
      if (!stuckJobs || stuckJobs.length === 0) {
        console.log('✅ No stuck jobs found');
        return;
      }
      
      console.log(`🔧 Found ${stuckJobs.length} stuck job(s), resetting to pending...`);
      
      // Reset each stuck job
      for (const job of stuckJobs) {
        const { error } = await supabase
          .from('video_processing_jobs')
          .update({
            status: 'pending',
            worker_id: null,
            started_at: null,
            error_message: 'Job was stuck, automatically reset'
          })
          .eq('id', job.id);
        
        if (error) {
          console.error(`❌ Error resetting job ${job.id}:`, error);
        } else {
          console.log(`✅ Reset stuck job ${job.id} (video: ${job.video_id})`);
        }
      }
    } catch (error) {
      console.error('❌ Error during stuck job cleanup:', error);
    }
  }

  async processJobs() {
    // Don't claim new jobs if we're at capacity
    const availableSlots = CONCURRENT_JOBS - this.activeJobs.size;
    if (availableSlots <= 0) {
      return;
    }

    try {
      // Periodically check for stuck jobs (every 10 polls)
      if (Math.random() < 0.1) {
        await this.cleanupStuckJobs();
      }
      
      // Claim jobs up to our available capacity
      for (let i = 0; i < availableSlots; i++) {
        const job = await this.claimNextJob();
        if (job) {
          // Process job concurrently (don't await)
          this.processJob(job).catch(error => {
            console.error(`❌ Job ${job.job_id} processing error:`, error);
          });
        }
      }
    } catch (error) {
      console.error('❌ Error claiming jobs:', error);
    }
  }

  async claimNextJob() {
    try {
      // Simple approach: get next job and mark as processing
      const { data: jobs, error: selectError } = await supabase
        .from('video_processing_jobs')
        .select('*')
        .eq('status', 'pending')
        .order('priority', { ascending: false })
        .order('created_at', { ascending: true })
        .limit(1);
      
      if (selectError) throw selectError;
      if (!jobs || jobs.length === 0) return null;
      
      const job = jobs[0];
      
      // Mark as processing
      const { error: updateError } = await supabase
        .from('video_processing_jobs')
        .update({
          status: 'processing',
          started_at: new Date().toISOString(),
          worker_id: WORKER_ID
        })
        .eq('id', job.id);
      
      if (updateError) throw updateError;
      
      return {
        job_id: job.id,
        video_id: job.video_id,
        source: job.source,
        metadata: job.metadata,
        priority: job.priority
      };
    } catch (error) {
      console.error('❌ Error claiming job:', error);
      return null;
    }
  }

  async processJob(job: Job) {
    const startTime = Date.now();
    this.activeJobs.add(job.job_id);
    
    try {
      let result;
      
      if (job.metadata && (job.metadata.videoIds || job.metadata.channelIds || job.metadata.rssFeedUrls)) {
        // Process unified import job
        const importRequest = job.metadata;
        console.log(`\n🎬 WORKER: Processing ${importRequest.source} import (Job: ${job.job_id.slice(0, 8)})`);
        
        // Set job ID for quota tracking
        this.videoImportService.setJobId(job.job_id);
        
        // Check current quota status
        const quotaStatus = await quotaTracker.getQuotaStatus();
        console.log(`📊 Current quota usage: ${quotaStatus?.quota_used || 0}/${quotaStatus?.quota_limit || 10000} (${quotaStatus?.percentage_used || 0}%)`);
        
        // Estimate quota needed for this job
        let estimatedQuota = 0;
        if (importRequest.channelIds?.length > 0) {
          // Rough estimate: 10-50 units per channel depending on video count
          estimatedQuota = importRequest.channelIds.length * 25; // Conservative estimate
        } else if (importRequest.videoIds?.length > 0) {
          // Video details: ~1 unit per 50 videos
          estimatedQuota = Math.ceil(importRequest.videoIds.length / 50);
        }
        
        console.log(`📋 Estimated quota needed: ${estimatedQuota} units`);
        
        // Check if we have enough quota
        if (estimatedQuota > 0) {
          const quotaAvailable = await quotaTracker.checkQuotaAvailable(estimatedQuota);
          if (!quotaAvailable) {
            throw new Error(`Insufficient YouTube quota. Need ${estimatedQuota} units, but would exceed daily limit.`);
          }
        }
        
        // Check if vectorization workers are enabled to avoid API contention
        const vectorizationStatus = await this.checkVectorizationWorkers();
        if (vectorizationStatus.titleEnabled || vectorizationStatus.thumbnailEnabled) {
          console.log(`🔄 Vectorization workers detected (Title: ${vectorizationStatus.titleEnabled ? 'ON' : 'OFF'}, Thumbnail: ${vectorizationStatus.thumbnailEnabled ? 'ON' : 'OFF'})`);
          console.log('⚡ Skipping embeddings during import to avoid API contention - dedicated workers will handle this');
          
          // Skip embeddings to avoid API rate limit contention
          if (!importRequest.options) importRequest.options = {};
          importRequest.options.skipTitleEmbeddings = vectorizationStatus.titleEnabled;
          importRequest.options.skipThumbnailEmbeddings = vectorizationStatus.thumbnailEnabled;
        }
        
        // Store job results for tracking
        await this.updateJobProgress(job.job_id, { started_at: new Date().toISOString() });
        
        // Check if this is a large job that needs chunking
        const totalItems = (importRequest.videoIds?.length || 0) + 
                          (importRequest.channelIds?.length || 0) + 
                          (importRequest.rssFeedUrls?.length || 0);
        
        if (totalItems > 500) {
          console.log(`📦 Large job detected (${totalItems} items) - using chunked processing`);
          result = await this.processLargeJobInChunks(importRequest, job.job_id);
        } else {
          result = await this.videoImportService.processVideos(importRequest);
        }
        
        // Store results in job metadata
        await this.updateJobProgress(job.job_id, { 
          status: 'storing_results',
          metadata: { ...job.metadata, result }
        });
        
      } else {
        // Process legacy individual video job
        console.log(`🎬 Processing video job ${job.job_id.slice(0, 8)}... (${job.source}: ${job.video_id})`);
        
        // Check vectorization workers for legacy jobs too
        const vectorizationStatus = await this.checkVectorizationWorkers();
        const options = job.metadata?.options || {};
        
        if (vectorizationStatus.titleEnabled || vectorizationStatus.thumbnailEnabled) {
          console.log(`🔄 Vectorization workers active - skipping embeddings during individual video import`);
          options.skipTitleEmbeddings = vectorizationStatus.titleEnabled;
          options.skipThumbnailEmbeddings = vectorizationStatus.thumbnailEnabled;
        }
        
        result = await this.videoImportService.processVideos({
          source: job.source,
          videoIds: [job.video_id],
          options
        });
      }

      // Mark job as completed
      await this.completeJob(job.job_id, result);
      
      const duration = ((Date.now() - startTime) / 1000).toFixed(1);
      console.log(`✅ Job ${job.job_id.slice(0, 8)} completed in ${duration}s`);
      
    } catch (error) {
      // Mark job as failed
      const errorMessage = error instanceof Error ? error.message : String(error);
      await this.failJob(job.job_id, errorMessage);
      
      const duration = ((Date.now() - startTime) / 1000).toFixed(1);
      console.log(`❌ Job ${job.job_id.slice(0, 8)} failed after ${duration}s: ${errorMessage}`);
    } finally {
      this.activeJobs.delete(job.job_id);
      // Clean up database pool connections after job completes
      await this.videoImportService.cleanup();
    }
  }

  async updateJobProgress(jobId: string, updates: any) {
    try {
      const { error } = await supabase
        .from('video_processing_jobs')
        .update(updates)
        .eq('id', jobId);
      
      if (error) {
        console.error('❌ Error updating job progress:', error);
      }
    } catch (error) {
      console.error('❌ Error updating job progress:', error);
    }
  }

  async completeJob(jobId: string, _result: any = null) {
    try {
      const updateData = {
        status: 'completed',
        completed_at: new Date().toISOString()
      };
      
      const { error } = await supabase
        .from('video_processing_jobs')
        .update(updateData)
        .eq('id', jobId);
      
      if (error) {
        console.error('❌ Error completing job:', error);
      }
    } catch (error) {
      console.error('❌ Error completing job:', error);
    }
  }

  async failJob(jobId: string, errorMessage: string) {
    try {
      // Get current retry count
      const { data: jobs, error: selectError } = await supabase
        .from('video_processing_jobs')
        .select('retry_count, max_retries')
        .eq('id', jobId)
        .single();
      
      if (selectError) throw selectError;
      
      const currentRetryCount = jobs?.retry_count || 0;
      const maxRetries = jobs?.max_retries || 3;
      
      if (currentRetryCount < maxRetries) {
        // Reset to pending for retry
        const { error } = await supabase
          .from('video_processing_jobs')
          .update({
            status: 'pending',
            retry_count: currentRetryCount + 1,
            error_message: errorMessage.slice(0, 1000),
            worker_id: null,
            started_at: null
          })
          .eq('id', jobId);
        
        if (error) throw error;
      } else {
        // Mark as permanently failed
        const { error } = await supabase
          .from('video_processing_jobs')
          .update({
            status: 'failed',
            completed_at: new Date().toISOString(),
            error_message: errorMessage.slice(0, 1000)
          })
          .eq('id', jobId);
        
        if (error) throw error;
      }
    } catch (error) {
      console.error('❌ Error failing job:', error);
    }
  }

  async checkVectorizationWorkers() {
    try {
      const { data, error } = await supabase
        .from('worker_control')
        .select('worker_type, is_enabled')
        .in('worker_type', ['title_vectorization', 'thumbnail_vectorization']);
      
      if (error) {
        console.error('❌ Error checking vectorization workers:', error);
        return { titleEnabled: false, thumbnailEnabled: false };
      }
      
      const titleWorker = data?.find(w => w.worker_type === 'title_vectorization');
      const thumbnailWorker = data?.find(w => w.worker_type === 'thumbnail_vectorization');
      
      return {
        titleEnabled: titleWorker?.is_enabled || false,
        thumbnailEnabled: thumbnailWorker?.is_enabled || false
      };
    } catch (error) {
      console.error('❌ Error checking vectorization workers:', error);
      return { titleEnabled: false, thumbnailEnabled: false };
    }
  }

  async processLargeJobInChunks(importRequest: any, jobId: string): Promise<any> {
    const CHUNK_SIZE = 100; // Process 100 items at a time
    const results: any = {
      success: true,
      message: '',
      videosProcessed: 0,
      embeddingsGenerated: { titles: 0, thumbnails: 0 },
      classificationsGenerated: 0,
      exportFiles: [] as string[],
      errors: [] as string[],
      processedVideoIds: [] as string[]
    };

    try {
      // Process videoIds in chunks
      if (importRequest.videoIds && importRequest.videoIds.length > 0) {
        const chunks = [];
        for (let i = 0; i < importRequest.videoIds.length; i += CHUNK_SIZE) {
          chunks.push(importRequest.videoIds.slice(i, i + CHUNK_SIZE));
        }

        console.log(`📦 Processing ${chunks.length} chunks for ${importRequest.videoIds.length} videos`);
        
        for (let i = 0; i < chunks.length; i++) {
          console.log(`🔄 Processing chunk ${i + 1}/${chunks.length} (${chunks[i].length} videos)`);
          
          const chunkResult = await this.videoImportService.processVideos({
            ...importRequest,
            videoIds: chunks[i],
            options: {
              ...importRequest.options,
              skipExports: true // Skip exports for individual chunks
            }
          });

          // Aggregate results
          results.videosProcessed += chunkResult.videosProcessed;
          results.embeddingsGenerated.titles += chunkResult.embeddingsGenerated.titles;
          results.embeddingsGenerated.thumbnails += chunkResult.embeddingsGenerated.thumbnails;
          results.classificationsGenerated += chunkResult.classificationsGenerated;
          results.errors.push(...chunkResult.errors);
          results.processedVideoIds.push(...chunkResult.processedVideoIds);

          // Update job progress
          await this.updateJobProgress(jobId, {
            metadata: {
              ...importRequest,
              progress: {
                chunksProcessed: i + 1,
                totalChunks: chunks.length,
                videosProcessed: results.videosProcessed
              }
            }
          });
        }
      }

      // Process RSS feeds (typically don't need chunking but included for completeness)
      if (importRequest.rssFeedUrls && importRequest.rssFeedUrls.length > 0) {
        console.log(`📦 Processing ${importRequest.rssFeedUrls.length} RSS feeds`);
        
        const rssResult = await this.videoImportService.processVideos({
          ...importRequest,
          options: {
            ...importRequest.options,
            skipExports: true
          }
        });

        // Aggregate results
        results.videosProcessed += rssResult.videosProcessed;
        results.embeddingsGenerated.titles += rssResult.embeddingsGenerated.titles;
        results.embeddingsGenerated.thumbnails += rssResult.embeddingsGenerated.thumbnails;
        results.classificationsGenerated += rssResult.classificationsGenerated;
        results.errors.push(...rssResult.errors);
        results.processedVideoIds.push(...rssResult.processedVideoIds);
      }

      // Process channels (these are handled internally by the service)
      if (importRequest.channelIds && importRequest.channelIds.length > 0) {
        console.log(`📦 Processing ${importRequest.channelIds.length} channels`);
        
        const channelResult = await this.videoImportService.processVideos({
          ...importRequest,
          options: {
            ...importRequest.options,
            skipExports: true
          }
        });

        // Aggregate results
        results.videosProcessed += channelResult.videosProcessed;
        results.embeddingsGenerated.titles += channelResult.embeddingsGenerated.titles;
        results.embeddingsGenerated.thumbnails += channelResult.embeddingsGenerated.thumbnails;
        results.classificationsGenerated += channelResult.classificationsGenerated;
        results.errors.push(...channelResult.errors);
        results.processedVideoIds.push(...channelResult.processedVideoIds);
      }

      // For large jobs, we skip exports to avoid memory issues
      if (!importRequest.options?.skipExports && results.processedVideoIds.length > 0) {
        console.log('📋 Skipping exports for large job (processed via chunks)');
        // Exports can be generated later if needed via a separate endpoint
      }

      results.success = true;
      results.message = `Successfully processed large job with ${results.videosProcessed} videos`;
      
      return results;
      
    } catch (error) {
      console.error('❌ Error processing large job:', error);
      results.success = false;
      results.message = error instanceof Error ? error.message : String(error);
      results.errors.push(error instanceof Error ? error.message : String(error));
      return results;
    }
  }

  async getQueueStats() {
    const defaultStats = {
      pending_jobs: 0,
      processing_jobs: 0,
      completed_jobs: 0,
      failed_jobs: 0,
      total_jobs: 0
    };

    try {
      const { data, error } = await supabase
        .from('video_processing_jobs')
        .select('status');
      
      if (error) throw error;
      
      const stats = { ...defaultStats };
      stats.total_jobs = data?.length || 0;
      
      data?.forEach(job => {
        switch (job.status) {
          case 'pending': stats.pending_jobs++; break;
          case 'processing': stats.processing_jobs++; break;
          case 'completed': stats.completed_jobs++; break;
          case 'failed': stats.failed_jobs++; break;
        }
      });
      
      return stats;
    } catch (error) {
      console.error('❌ Error getting queue stats:', error);
      return defaultStats;
    }
  }

  async shutdown() {
    console.log('\n🛑 Shutting down worker...');
    this.isShuttingDown = true;
    
    // Wait for active jobs to complete
    if (this.activeJobs.size > 0) {
      console.log(`⏳ Waiting for ${this.activeJobs.size} active jobs to complete...`);
      while (this.activeJobs.size > 0) {
        await this.sleep(1000);
      }
    }
    
    console.log('✅ Worker shutdown complete');
    process.exit(0);
  }

  sleep(ms: number) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// Start the worker
async function main() {
  console.log('📋 Video Processing Worker');
  console.log('========================');
  
  // Check environment variables
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    console.error('❌ Missing required environment variables:');
    console.error('   - NEXT_PUBLIC_SUPABASE_URL');
    console.error('   - SUPABASE_SERVICE_ROLE_KEY');
    process.exit(1);
  }

  const worker = new VideoWorker();
  
  // Show initial queue stats
  const stats = await worker.getQueueStats();
  console.log(`📊 Queue Status: ${stats.pending_jobs || 0} pending, ${stats.processing_jobs || 0} processing, ${stats.completed_jobs || 0} completed, ${stats.failed_jobs || 0} failed`);
  console.log('');
  
  await worker.start();
}

main().catch(error => {
  console.error('❌ Worker startup failed:', error);
  process.exit(1);
});