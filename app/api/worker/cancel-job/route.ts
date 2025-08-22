import { NextRequest, NextResponse } from 'next/server';
import { getSupabase } from '@/lib/supabase-lazy';

export async function POST(request: NextRequest) {
  const supabase = getSupabase();
  try {
    const { jobId } = await request.json();
    
    if (!jobId) {
      return NextResponse.json(
        { success: false, error: 'Job ID is required' },
        { status: 400 }
      );
    }


    // First check if job exists and is in a cancellable state
    const { data: job, error: fetchError } = await supabase
      .from('video_processing_jobs')
      .select('*')
      .eq('id', jobId)
      .single();

    if (fetchError || !job) {
      return NextResponse.json(
        { success: false, error: 'Job not found' },
        { status: 404 }
      );
    }

    // Only allow cancellation of pending or processing jobs
    if (!['pending', 'processing', 'storing_results'].includes(job.status)) {
      return NextResponse.json(
        { 
          success: false, 
          error: `Cannot cancel job with status: ${job.status}` 
        },
        { status: 400 }
      );
    }

    // Update job status to cancelled (we'll treat it as failed with a special message)
    const { error: updateError } = await supabase
      .from('video_processing_jobs')
      .update({
        status: 'failed',
        error_message: 'Job cancelled by user',
        completed_at: new Date().toISOString()
      })
      .eq('id', jobId);

    if (updateError) {
      console.error('Failed to cancel job:', updateError);
      return NextResponse.json(
        { success: false, error: 'Failed to cancel job' },
        { status: 500 }
      );
    }

    // Clear any cache that might be affected
    const queueStatsCache = require('@/lib/simple-cache').queueStatsCache;
    queueStatsCache.clear();

    return NextResponse.json({
      success: true,
      message: 'Job cancelled successfully',
      jobId
    });

  } catch (error) {
    console.error('❌ Job cancellation error:', error);
    
    return NextResponse.json(
      {
        success: false,
        error: 'Failed to cancel job',
        message: error instanceof Error ? error.message : 'Unknown error occurred'
      },
      { status: 500 }
    );
  }
}