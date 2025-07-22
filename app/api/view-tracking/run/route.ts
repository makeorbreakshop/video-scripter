import { NextRequest, NextResponse } from 'next/server';
import { ViewTrackingService } from '@/lib/view-tracking-service';
import { createClient } from '@supabase/supabase-js';
import { Database } from '@/types/database';

export async function POST(request: NextRequest) {
  try {
    // Optional: Add authentication check here
    // const session = await getServerSession();
    // if (!session) {
    //   return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    // }

    // Parse request body for optional parameters
    const body = await request.json().catch(() => ({}));
    const maxApiCalls = body.maxApiCalls || 100; // Default to small batch for manual runs

    // Check if another tracking job is already running
    const supabase = createClient<Database>(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    // Check for active job
    const { data: activeJobs } = await supabase
      .from('jobs')
      .select('id')
      .eq('type', 'view_tracking')
      .eq('status', 'processing')
      .limit(1);

    if (activeJobs && activeJobs.length > 0) {
      return NextResponse.json({ 
        error: 'View tracking is already running' 
      }, { status: 409 });
    }

    // Create job record
    const jobId = crypto.randomUUID();
    const { data: job, error: jobError } = await supabase
      .from('jobs')
      .insert({
        id: jobId,
        type: 'view_tracking',
        status: 'processing',
        data: {
          maxApiCalls,
          triggeredBy: 'manual_api'
        }
      })
      .select()
      .single();

    if (jobError) {
      console.error('Error creating job:', jobError);
      return NextResponse.json({ 
        error: 'Failed to create job record' 
      }, { status: 500 });
    }

    // Run tracking asynchronously
    const viewTrackingService = new ViewTrackingService();
    
    // Don't await - let it run in background
    viewTrackingService.trackDailyViews(maxApiCalls)
      .then(async () => {
        // Update job status
        await supabase
          .from('jobs')
          .update({ 
            status: 'completed',
            updated_at: new Date().toISOString()
          })
          .eq('id', job.id);
      })
      .catch(async (error) => {
        console.error('View tracking error:', error);
        // Update job status
        await supabase
          .from('jobs')
          .update({ 
            status: 'failed',
            error: error.message,
            updated_at: new Date().toISOString()
          })
          .eq('id', job.id);
      });

    return NextResponse.json({
      message: 'View tracking started',
      jobId: job.id,
      maxApiCalls,
      estimatedVideos: maxApiCalls * 50
    });

  } catch (error) {
    console.error('API error:', error);
    return NextResponse.json({ 
      error: 'Internal server error' 
    }, { status: 500 });
  }
}

// Check job status
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const jobId = searchParams.get('jobId');

    const supabase = createClient<Database>(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    if (jobId) {
      // Get specific job
      const { data: job, error } = await supabase
        .from('jobs')
        .select('*')
        .eq('id', jobId)
        .single();

      if (error) {
        return NextResponse.json({ error: 'Job not found' }, { status: 404 });
      }

      return NextResponse.json({ job });
    } else {
      // Get recent view tracking jobs
      const { data: jobs, error } = await supabase
        .from('jobs')
        .select('*')
        .eq('type', 'view_tracking')
        .order('created_at', { ascending: false })
        .limit(10);

      if (error) {
        return NextResponse.json({ error: 'Failed to fetch jobs' }, { status: 500 });
      }

      return NextResponse.json({ jobs });
    }
  } catch (error) {
    console.error('API error:', error);
    return NextResponse.json({ 
      error: 'Internal server error' 
    }, { status: 500 });
  }
}