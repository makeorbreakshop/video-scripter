import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { Database } from '@/types/database';

export async function POST(request: NextRequest) {
  try {
    // Parse request body
    const body = await request.json();
    const { jobId } = body;

    if (!jobId) {
      return NextResponse.json({ 
        error: 'Job ID is required' 
      }, { status: 400 });
    }

    const supabase = createClient<Database>(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    // Check current job status
    const { data: job, error: fetchError } = await supabase
      .from('jobs')
      .select('status')
      .eq('id', jobId)
      .single();

    if (fetchError || !job) {
      return NextResponse.json({ 
        error: 'Job not found' 
      }, { status: 404 });
    }

    if (job.status !== 'processing') {
      return NextResponse.json({ 
        error: `Cannot cancel job with status: ${job.status}` 
      }, { status: 400 });
    }

    // Update job status to failed (cancelled)
    const { error: updateError } = await supabase
      .from('jobs')
      .update({ 
        status: 'failed',
        error: 'Job cancelled by user',
        updated_at: new Date().toISOString()
      })
      .eq('id', jobId);

    if (updateError) {
      return NextResponse.json({ 
        error: 'Failed to cancel job' 
      }, { status: 500 });
    }

    return NextResponse.json({
      message: 'Job cancellation requested',
      jobId
    });

  } catch (error) {
    console.error('API error:', error);
    return NextResponse.json({ 
      error: 'Internal server error' 
    }, { status: 500 });
  }
}

// Cancel all stuck jobs
export async function DELETE(request: NextRequest) {
  try {
    const supabase = createClient<Database>(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    // Cancel all processing jobs older than 1 hour
    const oneHourAgo = new Date();
    oneHourAgo.setHours(oneHourAgo.getHours() - 1);

    const { data: stuckJobs, error: updateError } = await supabase
      .from('jobs')
      .update({ 
        status: 'failed',
        error: 'Job cancelled - stuck in processing state',
        updated_at: new Date().toISOString()
      })
      .eq('type', 'view_tracking')
      .eq('status', 'processing')
      .lt('created_at', oneHourAgo.toISOString())
      .select();

    if (updateError) {
      return NextResponse.json({ 
        error: 'Failed to cancel stuck jobs' 
      }, { status: 500 });
    }

    return NextResponse.json({
      message: 'Stuck jobs cancelled',
      count: stuckJobs?.length || 0
    });

  } catch (error) {
    console.error('API error:', error);
    return NextResponse.json({ 
      error: 'Internal server error' 
    }, { status: 500 });
  }
}