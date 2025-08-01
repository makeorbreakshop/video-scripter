// View Tracking Worker - Runs as a separate process to avoid API timeouts
import { createClient } from '@supabase/supabase-js';
import { ViewTrackingService } from '../lib/view-tracking-service.js';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

class ViewTrackingWorker {
  constructor() {
    this.supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY
    );
    this.viewTrackingService = new ViewTrackingService();
    this.isRunning = false;
    this.currentJobId = null;
  }

  async start() {
    console.log('View Tracking Worker started');
    
    // Check for pending jobs every 30 seconds
    setInterval(() => this.checkForJobs(), 30000);
    
    // Check immediately on start
    await this.checkForJobs();
  }

  async checkForJobs() {
    if (this.isRunning) {
      console.log('Worker is already processing a job');
      return;
    }

    try {
      // Look for pending view tracking jobs
      const { data: pendingJobs, error } = await this.supabase
        .from('jobs')
        .select('*')
        .eq('type', 'view_tracking')
        .eq('status', 'pending')
        .order('created_at', { ascending: true })
        .limit(1);

      if (error) {
        console.error('Error checking for jobs:', error);
        return;
      }

      if (!pendingJobs || pendingJobs.length === 0) {
        return;
      }

      const job = pendingJobs[0];
      await this.processJob(job);
    } catch (error) {
      console.error('Error in checkForJobs:', error);
    }
  }

  async processJob(job) {
    this.isRunning = true;
    this.currentJobId = job.id;
    
    console.log(`Processing view tracking job ${job.id}`);
    
    try {
      // Update job status to processing
      await this.supabase
        .from('jobs')
        .update({ 
          status: 'processing',
          started_at: new Date().toISOString(),
          worker_id: `view-tracking-worker-${process.pid}`
        })
        .eq('id', job.id);

      // Extract parameters from job data
      const maxApiCalls = job.data?.maxApiCalls || 2000;
      
      // Run the view tracking
      const startTime = Date.now();
      await this.viewTrackingService.trackDailyViews(maxApiCalls);
      const duration = Date.now() - startTime;
      
      // Update job as completed
      await this.supabase
        .from('jobs')
        .update({ 
          status: 'completed',
          completed_at: new Date().toISOString(),
          data: {
            ...job.data,
            processingTime: duration,
            videosProcessed: maxApiCalls * 50
          }
        })
        .eq('id', job.id);
      
      console.log(`Job ${job.id} completed in ${duration}ms`);
    } catch (error) {
      console.error(`Error processing job ${job.id}:`, error);
      
      // Update job as failed
      await this.supabase
        .from('jobs')
        .update({ 
          status: 'failed',
          completed_at: new Date().toISOString(),
          error: error.message
        })
        .eq('id', job.id);
    } finally {
      this.isRunning = false;
      this.currentJobId = null;
    }
  }

  // Graceful shutdown
  async shutdown() {
    console.log('Shutting down View Tracking Worker...');
    
    if (this.currentJobId) {
      // Mark current job as failed
      await this.supabase
        .from('jobs')
        .update({ 
          status: 'failed',
          error: 'Worker shutdown',
          completed_at: new Date().toISOString()
        })
        .eq('id', this.currentJobId);
    }
    
    process.exit(0);
  }
}

// Create and start worker
const worker = new ViewTrackingWorker();

// Handle shutdown signals
process.on('SIGINT', () => worker.shutdown());
process.on('SIGTERM', () => worker.shutdown());

// Start the worker
worker.start().catch(error => {
  console.error('Failed to start worker:', error);
  process.exit(1);
});