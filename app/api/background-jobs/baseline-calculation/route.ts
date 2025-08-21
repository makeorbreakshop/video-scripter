/**
 * Background Job API for Rolling Baseline Calculation
 * Handles heavy computational work outside of HTTP request timeouts
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

// Create supabase client inside functions to avoid build-time initialization
function getSupabaseClient() {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
    throw new Error('Missing Supabase environment variables');
  }
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  );
}

// Job status tracking
interface BaselineJob {
  id: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  total_channels: number;
  processed_channels: number;
  total_videos: number;
  processed_videos: number;
  started_at: string;
  completed_at?: string;
  error_message?: string;
  progress_percentage: number;
}

// POST: Start baseline calculation job
export async function POST(request: NextRequest) {
  try {
    const supabase = getSupabaseClient();
    const { exclude_shorts = true, recalculate_all = false } = await request.json();

    // Create job record
    const jobId = `baseline_job_${Date.now()}`;
    
    const { data: job, error: jobError } = await supabase
      .from('background_jobs')
      .insert({
        id: jobId,
        job_type: 'baseline_calculation',
        status: 'pending',
        created_at: new Date().toISOString(),
        metadata: {
          exclude_shorts,
          recalculate_all,
          triggered_by: 'api_request'
        }
      })
      .select()
      .single();

    if (jobError) {
      console.error('Error creating job:', jobError);
      return NextResponse.json({ error: 'Failed to create job' }, { status: 500 });
    }

    // Start background processing (non-blocking)
    processBaselineCalculation(jobId, exclude_shorts, recalculate_all);

    return NextResponse.json({
      success: true,
      job_id: jobId,
      message: 'Baseline calculation job started',
      status_url: `/api/background-jobs/baseline-calculation/${jobId}`
    });

  } catch (error) {
    console.error('Error starting baseline job:', error);
    return NextResponse.json({ error: 'Failed to start job' }, { status: 500 });
  }
}

// GET: Check job status
export async function GET(request: NextRequest) {
  try {
    const supabase = getSupabaseClient();
    const { searchParams } = new URL(request.url);
    const jobId = searchParams.get('job_id');

    if (!jobId) {
      // Return all recent jobs
      const { data: jobs, error } = await supabase
        .from('background_jobs')
        .select('*')
        .eq('job_type', 'baseline_calculation')
        .order('created_at', { ascending: false })
        .limit(10);

      return NextResponse.json({ jobs: jobs || [] });
    }

    // Return specific job status
    const { data: job, error } = await supabase
      .from('background_jobs')
      .select('*')
      .eq('id', jobId)
      .single();

    if (error || !job) {
      return NextResponse.json({ error: 'Job not found' }, { status: 404 });
    }

    return NextResponse.json({ job });

  } catch (error) {
    console.error('Error checking job status:', error);
    return NextResponse.json({ error: 'Failed to check status' }, { status: 500 });
  }
}

// Background processing function (runs outside HTTP request)
async function processBaselineCalculation(
  jobId: string, 
  excludeShorts: boolean, 
  recalculateAll: boolean
) {
  const supabase = getSupabaseClient();
  try {
    // Update job status to running
    await supabase
      .from('background_jobs')
      .update({ 
        status: 'running', 
        started_at: new Date().toISOString() 
      })
      .eq('id', jobId);

    // Get total counts for progress tracking
    const { data: channelCounts } = await supabase
      .from('videos')
      .select('channel_id')
      .not('channel_id', 'is', null);

    const uniqueChannels = [...new Set(channelCounts?.map(v => v.channel_id) || [])];
    const totalChannels = uniqueChannels.length;

    // Process channels in batches
    const BATCH_SIZE = 10;
    let processedChannels = 0;
    let totalProcessedVideos = 0;

    for (let i = 0; i < uniqueChannels.length; i += BATCH_SIZE) {
      const channelBatch = uniqueChannels.slice(i, i + BATCH_SIZE);
      
      // Process batch of channels
      for (const channelId of channelBatch) {
        const processedVideos = await processChannelBaselines(channelId, excludeShorts);
        totalProcessedVideos += processedVideos;
        processedChannels++;

        // Update progress
        const progressPercentage = Math.round((processedChannels / totalChannels) * 100);
        
        await supabase
          .from('background_jobs')
          .update({
            metadata: {
              exclude_shorts: excludeShorts,
              recalculate_all: recalculateAll,
              processed_channels: processedChannels,
              total_channels: totalChannels,
              processed_videos: totalProcessedVideos,
              progress_percentage: progressPercentage,
              current_channel: channelId
            }
          })
          .eq('id', jobId);

        console.log(`Processed channel ${processedChannels}/${totalChannels} (${progressPercentage}%)`);
      }

      // Small delay to prevent overwhelming the database
      await new Promise(resolve => setTimeout(resolve, 100));
    }

    // Job completed successfully
    await supabase
      .from('background_jobs')
      .update({
        status: 'completed',
        completed_at: new Date().toISOString(),
        metadata: {
          exclude_shorts: excludeShorts,
          recalculate_all: recalculateAll,
          processed_channels: processedChannels,
          total_channels: totalChannels,
          processed_videos: totalProcessedVideos,
          progress_percentage: 100
        }
      })
      .eq('id', jobId);

    console.log(`✅ Baseline calculation job ${jobId} completed successfully`);

  } catch (error) {
    console.error(`❌ Baseline calculation job ${jobId} failed:`, error);
    
    // Update job status to failed
    await supabase
      .from('background_jobs')
      .update({
        status: 'failed',
        completed_at: new Date().toISOString(),
        error_message: error instanceof Error ? error.message : 'Unknown error'
      })
      .eq('id', jobId);
  }
}

// Process baselines for a single channel (incremental approach)
async function processChannelBaselines(channelId: string, excludeShorts: boolean): Promise<number> {
  const supabase = getSupabaseClient();
  // Get all videos for this channel in chronological order
  const { data: videos, error } = await supabase
    .from('videos')
    .select('id, published_at, view_count, duration, title, description')
    .eq('channel_id', channelId)
    .order('published_at', { ascending: true });

  if (error || !videos) {
    console.error(`Error fetching videos for channel ${channelId}:`, error);
    return 0;
  }

  // Filter out shorts if requested
  const longFormVideos = excludeShorts 
    ? videos.filter(video => {
        // Use the same is_youtube_short logic
        const duration = video.duration;
        const title = video.title || '';
        const description = video.description || '';
        
        // Duration check
        const match = duration?.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
        if (match) {
          const hours = parseInt(match[1] || '0');
          const minutes = parseInt(match[2] || '0');
          const seconds = parseInt(match[3] || '0');
          const totalSeconds = hours * 3600 + minutes * 60 + seconds;
          if (totalSeconds > 0 && totalSeconds <= 121) return false;
        }
        
        // Hashtag check
        const combinedText = `${title} ${description}`.toLowerCase();
        if (combinedText.includes('#shorts') || combinedText.includes('#short') || combinedText.includes('#youtubeshorts')) {
          return false;
        }
        
        return true;
      })
    : videos;

  // Calculate rolling baselines incrementally
  const updates = [];
  const slidingWindow: Array<{publishedAt: Date, viewCount: number}> = [];

  for (const video of longFormVideos) {
    const videoDate = new Date(video.published_at);
    const oneYearAgo = new Date(videoDate.getTime() - 365 * 24 * 60 * 60 * 1000);

    // Remove videos older than 1 year from sliding window
    while (slidingWindow.length > 0 && slidingWindow[0].publishedAt < oneYearAgo) {
      slidingWindow.shift();
    }

    // Calculate baseline from current sliding window
    const baseline = slidingWindow.length > 0
      ? Math.round(slidingWindow.reduce((sum, v) => sum + v.viewCount, 0) / slidingWindow.length)
      : null;

    // Add to updates
    updates.push({
      id: video.id,
      rolling_baseline_views: baseline
    });

    // Add current video to sliding window for future calculations
    slidingWindow.push({
      publishedAt: videoDate,
      viewCount: video.view_count || 0
    });
  }

  // Batch update videos
  if (updates.length > 0) {
    for (let i = 0; i < updates.length; i += 100) {
      const batch = updates.slice(i, i + 100);
      
      for (const update of batch) {
        await supabase
          .from('videos')
          .update({ rolling_baseline_views: update.rolling_baseline_views })
          .eq('id', update.id);
      }
    }
  }

  return updates.length;
}