/**
 * YouTube Analytics Test API Route
 * Test comprehensive analytics collection on a single video
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { analyticsProcessor } from '@/lib/analytics-processor';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

export async function POST(request: NextRequest) {
  try {
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
    const videoId = body.videoId;
    const daysBack = body.daysBack || 7;

    if (!videoId) {
      return NextResponse.json(
        { error: 'videoId required' },
        { status: 400 }
      );
    }

    const endDate = new Date().toISOString().split('T')[0];
    const startDate = new Date(Date.now() - daysBack * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

    console.log(`🧪 Testing comprehensive analytics for video: ${videoId}`);

    // Test comprehensive analytics processing
    const result = await analyticsProcessor.processVideoAnalyticsComprehensive(
      videoId,
      startDate,
      endDate,
      'test-user',
      accessToken
    );

    // Get the data that was stored
    const { data: storedData, error } = await supabase
      .from('daily_analytics')
      .select('*')
      .eq('video_id', videoId)
      .gte('date', startDate)
      .order('date', { ascending: false });

    if (error) {
      console.error('Error fetching stored data:', error);
    }

    return NextResponse.json({
      success: true,
      processing_result: result,
      stored_records: storedData?.length || 0,
      sample_data: storedData?.slice(0, 3), // Show first 3 records
      date_range: { startDate, endDate },
      message: `Test completed for video ${videoId}`
    });

  } catch (error) {
    console.error('Test error:', error);
    
    return NextResponse.json(
      { error: 'Test failed', details: error.message },
      { status: 500 }
    );
  }
}