import { NextRequest, NextResponse } from 'next/server';
import { ViewTrackingService } from '@/lib/view-tracking-service';
import { createClient } from '@supabase/supabase-js';
import { Database } from '@/types/database';

export async function POST(request: NextRequest) {
  try {
    // Parse request body for optional parameters
    const body = await request.json().catch(() => ({}));
    const hoursThreshold = body.hoursThreshold || 24; // Default to 24 hours

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

    // Get total count of ALL videos - we're tracking everything
    const { count: totalVideos } = await supabase
      .from('videos')
      .select('*', { count: 'exact', head: true });
    
    const videosNeedingUpdate = totalVideos || 0;

    // Create job record
    const jobId = crypto.randomUUID();
    const { data: job, error: jobError } = await supabase
      .from('jobs')
      .insert({
        id: jobId,
        type: 'view_tracking',
        status: 'processing',
        data: {
          mode: 'update_all',
          videosToUpdate: videosNeedingUpdate,
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
    viewTrackingService.updateAllStaleVideos(0, job.id) // Pass 0 to bypass time filtering
      .then(async (totalProcessed) => {
        // Update job status
        await supabase
          .from('jobs')
          .update({ 
            status: 'completed',
            data: {
              ...job.data,
              videosProcessed: totalProcessed,
              progress: 100
            },
            updated_at: new Date().toISOString()
          })
          .eq('id', job.id);
      })
      .catch(async (error) => {
        console.error('View tracking error:', error);
        
        // Check if it was cancelled
        const { data: jobCheck } = await supabase
          .from('jobs')
          .select('status')
          .eq('id', job.id)
          .single();
        
        const finalStatus = 'failed';
        
        // Update job status
        await supabase
          .from('jobs')
          .update({ 
            status: finalStatus,
            error: error.message,
            updated_at: new Date().toISOString()
          })
          .eq('id', job.id);
      });

    return NextResponse.json({
      message: 'Update all tracking started',
      jobId: job.id,
      videosToUpdate: videosNeedingUpdate,
      estimatedApiCalls: Math.ceil((videosNeedingUpdate || 0) / 50)
    });

  } catch (error) {
    console.error('API error:', error);
    return NextResponse.json({ 
      error: 'Internal server error' 
    }, { status: 500 });
  }
}

// Get stats for update-all
export async function GET(request: NextRequest) {
  try {
    const supabase = createClient<Database>(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    // Get total count of ALL videos - we're tracking everything
    const { count: totalVideos } = await supabase
      .from('videos')
      .select('*', { count: 'exact', head: true });
    
    const videosNeedingUpdate = totalVideos || 0;

    return NextResponse.json({
      videosNeedingUpdate,
      estimatedApiCalls: Math.ceil((videosNeedingUpdate || 0) / 50),
      estimatedTime: Math.ceil((videosNeedingUpdate || 0) / 50 / 60) + ' minutes'
    });
  } catch (error) {
    console.error('API error:', error);
    return NextResponse.json({ 
      error: 'Internal server error' 
    }, { status: 500 });
  }
}