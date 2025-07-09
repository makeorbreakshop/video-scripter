#!/usr/bin/env node

import { createClient } from '@supabase/supabase-js';
import { VideoImportService } from './lib/unified-video-import.ts';
import os from 'os';

// Initialize Supabase client with service role for bypassing RLS
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// Worker configuration
const WORKER_ID = `${os.hostname()}-${process.pid}`;
const POLL_INTERVAL = 30000; // 30 seconds
const CONCURRENT_JOBS = 3; // Process up to 3 jobs concurrently

class VideoWorker {
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
    
    // Main worker loop
    while (!this.isShuttingDown) {
      try {
        await this.processJobs();
        await this.sleep(POLL_INTERVAL);
      } catch (error) {
        console.error('❌ Worker loop error:', error);
        await this.sleep(60000); // Wait longer on error
      }
    }
  }

  async processJobs() {
    // Don't claim new jobs if we're at capacity
    const availableSlots = CONCURRENT_JOBS - this.activeJobs.size;
    if (availableSlots <= 0) {
      return;
    }

    try {
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

  async processJob(job) {
    const startTime = Date.now();
    this.activeJobs.add(job.job_id);
    
    try {
      let result;
      
      if (job.metadata && (job.metadata.videoIds || job.metadata.channelIds || job.metadata.rssFeedUrls)) {
        // Process unified import job
        const importRequest = job.metadata;
        console.log(`🎬 Processing unified import job ${job.job_id.slice(0, 8)}... (${importRequest.source})`);
        
        // Store job results for tracking
        await this.updateJobProgress(job.job_id, { started_at: new Date().toISOString() });
        
        result = await this.videoImportService.processVideos(importRequest);
        
        // Store results in job metadata
        await this.updateJobProgress(job.job_id, { 
          status: 'storing_results',
          metadata: { ...job.metadata, result }
        });
        
      } else {
        // Process legacy individual video job
        console.log(`🎬 Processing video job ${job.job_id.slice(0, 8)}... (${job.source}: ${job.video_id})`);
        
        result = await this.videoImportService.processVideos({
          source: job.source,
          videoIds: [job.video_id],
          options: job.metadata?.options || {}
        });
      }

      // Mark job as completed
      await this.completeJob(job.job_id, result);
      
      const duration = ((Date.now() - startTime) / 1000).toFixed(1);
      console.log(`✅ Job ${job.job_id.slice(0, 8)} completed in ${duration}s`);
      
    } catch (error) {
      // Mark job as failed
      await this.failJob(job.job_id, error.message);
      
      const duration = ((Date.now() - startTime) / 1000).toFixed(1);
      console.log(`❌ Job ${job.job_id.slice(0, 8)} failed after ${duration}s: ${error.message}`);
    } finally {
      this.activeJobs.delete(job.job_id);
    }
  }

  async updateJobProgress(jobId, updates) {
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

  async completeJob(jobId, result = null) {
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

  async failJob(jobId, errorMessage) {
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

  async getQueueStats() {
    try {
      const { data, error } = await supabase
        .from('video_processing_jobs')
        .select('status');
      
      if (error) throw error;
      
      const stats = {
        pending_jobs: 0,
        processing_jobs: 0,
        completed_jobs: 0,
        failed_jobs: 0,
        total_jobs: data?.length || 0
      };
      
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
      return {};
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

  sleep(ms) {
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