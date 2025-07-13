/**
 * YouTube Analytics Refresh API Route
 * Handles manual refresh of analytics data
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { simpleYouTubeAnalytics, BasicAnalyticsData } from '@/lib/simple-youtube-analytics';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

// Import progress update function
import { updateProgress } from './progress/route.ts';

// Global state for tracking refresh progress
let refreshProgress = {
  isRunning: false,
  total: 0,
  processed: 0,
  currentVideo: '',
  errors: [] as string[],
};

export async function POST(request: NextRequest) {
  try {
    if (refreshProgress.isRunning) {
      return NextResponse.json(
        { error: 'Refresh already in progress' },
        { status: 409 }
      );
    }

    // Extract access token from Authorization header
    const authHeader = request.headers.get('authorization');
    const accessToken = authHeader?.replace('Bearer ', '');
    
    if (!accessToken) {
      return NextResponse.json(
        { error: 'Access token required' },
        { status: 401 }
      );
    }

    const body = await request.json();
    const daysBack = body.daysBack || 7; // Default to last 7 days

    // Reset progress
    refreshProgress = {
      isRunning: true,
      total: 0,
      processed: 0,
      currentVideo: '',
      errors: [],
    };
    
    // Update progress endpoint
    updateProgress(refreshProgress);

    // Start the refresh process asynchronously with access token
    processRefresh(daysBack, accessToken);

    return NextResponse.json({ 
      message: 'Refresh started',
      progress: refreshProgress 
    });

  } catch (error) {
    console.error('Error starting refresh:', error);
    refreshProgress.isRunning = false;
    
    return NextResponse.json(
      { error: 'Failed to start refresh' },
      { status: 500 }
    );
  }
}

export async function GET() {
  return NextResponse.json(refreshProgress);
}

async function processRefresh(daysBack: number, accessToken: string) {
  try {
    const endDate = new Date().toISOString().split('T')[0];
    const startDate = new Date(Date.now() - daysBack * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

    console.log(`🔄 Starting BASIC analytics refresh for last ${daysBack} days (${startDate} to ${endDate})`);
    
    refreshProgress.total = 1; // Single bulk API call
    refreshProgress.currentVideo = 'Fetching analytics for all videos...';
    updateProgress(refreshProgress);

    // **NEW APPROACH: Single bulk API call for ALL videos**
    console.log(`📊 Making single bulk API call for ALL videos`);
    const analyticsData = await simpleYouTubeAnalytics.getAllVideosBasicAnalytics(
      startDate, 
      endDate, 
      accessToken
    );

    console.log(`✅ Received ${analyticsData.length} analytics records from API`);
    
    if (analyticsData.length === 0) {
      refreshProgress.errors.push('No analytics data received from YouTube API');
      refreshProgress.isRunning = false;
      updateProgress(refreshProgress);
      return;
    }

    // **Insert data into database**
    refreshProgress.currentVideo = 'Saving analytics data to database...';
    updateProgress(refreshProgress);

    // Prepare data for database insertion
    const dbRecords = analyticsData.map(data => ({
      video_id: data.video_id,
      date: data.date,
      views: data.views,
      likes: data.likes || null,
      comments: data.comments || null,
      shares: data.shares || null,
      subscribers_gained: data.subscribers_gained || null,
      estimated_minutes_watched: data.estimated_minutes_watched || null,
      average_view_duration: data.average_view_duration || null,
      average_view_percentage: data.average_view_percentage || null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    }));

    // Batch insert with upsert (update if exists)
    const { error: insertError } = await supabase
      .from('daily_analytics')
      .upsert(dbRecords, { 
        onConflict: 'video_id,date',
        ignoreDuplicates: false 
      });

    if (insertError) {
      throw new Error(`Database insert failed: ${insertError.message}`);
    }

    refreshProgress.processed = 1;
    refreshProgress.currentVideo = '';
    refreshProgress.isRunning = false;
    updateProgress(refreshProgress);

    console.log(`✅ BASIC refresh complete: ${analyticsData.length} analytics records saved`);

  } catch (error) {
    console.error('❌ Basic refresh process failed:', error);
    refreshProgress.errors.push(`Basic refresh failed: ${error}`);
    refreshProgress.isRunning = false;
    updateProgress(refreshProgress);
  }
}