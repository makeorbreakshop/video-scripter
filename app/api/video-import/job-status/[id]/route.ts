import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const jobId = params.id;
    
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    const { data: job, error } = await supabase
      .from('video_processing_jobs')
      .select('*')
      .eq('id', jobId)
      .single();

    if (error || !job) {
      return NextResponse.json(
        { error: 'Job not found' },
        { status: 404 }
      );
    }

    let processingTime = null;
    if (job.started_at && job.completed_at) {
      const startTime = new Date(job.started_at).getTime();
      const endTime = new Date(job.completed_at).getTime();
      processingTime = endTime - startTime;
    }

    const response = {
      jobId: job.id,
      video_id: job.video_id,
      source: job.source,
      status: job.status,
      priority: job.priority,
      createdAt: job.created_at,
      startedAt: job.started_at,
      completedAt: job.completed_at,
      processingTime,
      workerId: job.worker_id,
      retryCount: job.retry_count,
      maxRetries: job.max_retries,
      errorMessage: job.error_message,
      metadata: job.metadata
    };

    if (job.metadata && (job.metadata.videoIds || job.metadata.channelIds || job.metadata.rssFeedUrls)) {
      const metadata = job.metadata;
      const estimatedItems = (metadata.videoIds?.length || 0) + 
                           (metadata.channelIds?.length || 0) + 
                           (metadata.rssFeedUrls?.length || 0);
      
      response.estimatedItems = estimatedItems;
      response.source = metadata.source;
      
      if (metadata.result) {
        response.videosProcessed = metadata.result.videosProcessed || 0;
        response.embeddingsGenerated = metadata.result.embeddingsGenerated || { titles: 0, thumbnails: 0 };
        response.exportFiles = metadata.result.exportFiles || [];
        response.errors = metadata.result.errors || [];
      }
    }

    return NextResponse.json({
      success: true,
      data: response
    });

  } catch (error) {
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}