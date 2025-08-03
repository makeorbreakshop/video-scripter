import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { queueStatsCache } from '@/lib/simple-cache';

export async function GET(request: NextRequest) {
  try {
    // Check cache first
    const cacheKey = 'queue-stats';
    const cached = queueStatsCache.get(cacheKey);
    if (cached) {
      return NextResponse.json(cached);
    }
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    // Get queue statistics - limit to recent jobs only
    const { data: jobs, error: jobsError } = await supabase
      .from('video_processing_jobs')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(1000); // Only fetch recent 1000 jobs

    if (jobsError) {
      throw jobsError;
    }

    // Calculate queue statistics
    const stats = {
      pending_jobs: 0,
      processing_jobs: 0,
      completed_jobs: 0,
      failed_jobs: 0,
      total_jobs: jobs?.length || 0
    };

    // Count jobs by status
    jobs?.forEach(job => {
      switch (job.status) {
        case 'pending':
          stats.pending_jobs++;
          break;
        case 'processing':
        case 'storing_results':
          stats.processing_jobs++;
          break;
        case 'completed':
          stats.completed_jobs++;
          break;
        case 'failed':
          stats.failed_jobs++;
          break;
      }
    });

    // Get recent jobs (last 20) with processing time calculation
    const recentJobs = jobs?.slice(0, 20).map(job => {
      let processingTime = null;
      if (job.started_at && job.completed_at) {
        const startTime = new Date(job.started_at).getTime();
        const endTime = new Date(job.completed_at).getTime();
        processingTime = endTime - startTime;
      }

      return {
        id: job.id,
        video_id: job.video_id,
        source: job.source,
        status: job.status,
        priority: job.priority,
        created_at: job.created_at,
        started_at: job.started_at,
        completed_at: job.completed_at,
        worker_id: job.worker_id,
        error_message: job.error_message,
        processing_time: processingTime,
        metadata: job.metadata
      };
    }) || [];

    // Get active workers (jobs that are currently processing)
    const activeWorkers = jobs?.filter(job => 
      job.status === 'processing' || job.status === 'storing_results'
    ).map(job => ({
      worker_id: job.worker_id,
      job_id: job.id,
      video_id: job.video_id,
      source: job.source,
      started_at: job.started_at,
      current_status: job.status
    })) || [];

    // Calculate performance metrics
    const completedJobs = jobs?.filter(job => job.status === 'completed') || [];
    const failedJobs = jobs?.filter(job => job.status === 'failed') || [];
    
    const avgProcessingTime = completedJobs.length > 0 
      ? completedJobs.reduce((sum, job) => {
          if (job.started_at && job.completed_at) {
            const startTime = new Date(job.started_at).getTime();
            const endTime = new Date(job.completed_at).getTime();
            return sum + (endTime - startTime);
          }
          return sum;
        }, 0) / completedJobs.length
      : 0;

    const metrics = {
      avg_processing_time: avgProcessingTime,
      success_rate: stats.total_jobs > 0 ? (stats.completed_jobs / stats.total_jobs) * 100 : 0,
      failure_rate: stats.total_jobs > 0 ? (stats.failed_jobs / stats.total_jobs) * 100 : 0,
      throughput_last_hour: jobs?.filter(job => {
        const jobTime = new Date(job.completed_at || job.created_at).getTime();
        const hourAgo = Date.now() - (60 * 60 * 1000);
        return jobTime > hourAgo && job.status === 'completed';
      }).length || 0
    };

    const responseData = {
      success: true,
      stats,
      recentJobs,
      activeWorkers,
      metrics,
      timestamp: new Date().toISOString()
    };
    
    // Cache the response
    queueStatsCache.set(cacheKey, responseData);
    
    return NextResponse.json(responseData);

  } catch (error) {
    console.error('❌ Queue stats error:', error);
    
    return NextResponse.json(
      {
        success: false,
        error: 'Failed to fetch queue statistics',
        message: error instanceof Error ? error.message : 'Unknown error occurred'
      },
      { status: 500 }
    );
  }
}