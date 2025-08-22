import { NextRequest, NextResponse } from 'next/server';
import { getSupabase } from '@/lib/supabase-lazy';

export async function GET(request: NextRequest) {
  const supabase = getSupabase();
  try {
    
    // Get channel_id from query params
    const searchParams = request.nextUrl.searchParams;
    const channelId = searchParams.get('channel_id');
    
    if (!channelId) {
      return NextResponse.json(
        { error: 'channel_id parameter is required' },
        { status: 400 }
      );
    }

    // Calculate channel baseline using first-week median with trimmed statistics
    const { data: channelStats, error: statsError } = await supabase.rpc('calculate_channel_baseline', {
      p_channel_id: channelId
    });

    if (statsError) {
      // Fallback to manual calculation if RPC doesn't exist
      const { data: snapshots, error: snapshotError } = await supabase
        .from('view_snapshots')
        .select(`
          view_count,
          videos!inner (
            channel_id
          )
        `)
        .eq('videos.channel_id', channelId)
        .lte('days_since_published', 7)
        .not('view_count', 'is', null);

      if (snapshotError) {
        console.error('Error fetching snapshots:', snapshotError);
        return NextResponse.json(
          { error: 'Failed to fetch channel data' },
          { status: 500 }
        );
      }

      if (!snapshots || snapshots.length === 0) {
        // No first-week data, return global baseline
        return NextResponse.json({
          channel_id: channelId,
          baseline: null,
          confidence: 0,
          method: 'no_data',
          video_count: 0,
          message: 'No first-week data available for channel'
        });
      }

      // Calculate trimmed statistics (exclude top/bottom 10%)
      const sortedViews = snapshots
        .map(s => s.view_count)
        .sort((a, b) => a - b);

      const trimStart = Math.floor(sortedViews.length * 0.1);
      const trimEnd = Math.ceil(sortedViews.length * 0.9);
      const trimmedViews = sortedViews.slice(trimStart, trimEnd);

      const median = trimmedViews[Math.floor(trimmedViews.length / 2)];
      
      // Calculate confidence score
      const videoCount = snapshots.length;
      const confidence = Math.min(videoCount / 30, 1.0);

      return NextResponse.json({
        channel_id: channelId,
        baseline: median,
        confidence: confidence,
        method: 'trimmed_median',
        video_count: videoCount,
        trimmed_count: trimmedViews.length,
        min_views: trimmedViews[0],
        max_views: trimmedViews[trimmedViews.length - 1]
      });
    }

    return NextResponse.json(channelStats);
    
  } catch (error) {
    console.error('Error calculating channel baseline:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

// POST endpoint to calculate baselines for multiple channels
export async function POST(request: NextRequest) {
  const supabase = getSupabase();
  try {
    const { channel_ids } = await request.json();
    
    if (!channel_ids || !Array.isArray(channel_ids)) {
      return NextResponse.json(
        { error: 'channel_ids array is required' },
        { status: 400 }
      );
    }

    // Calculate global baseline first (geometric mean)
    const { data: globalData, error: globalError } = await supabase
      .from('view_snapshots')
      .select('view_count')
      .lte('days_since_published', 7)
      .gte('view_count', 100)
      .lte('view_count', 1000000)
      .not('view_count', 'is', null)
      .limit(10000);

    if (globalError) {
      console.error('Error calculating global baseline:', globalError);
      return NextResponse.json(
        { error: 'Failed to calculate global baseline' },
        { status: 500 }
      );
    }

    // Calculate geometric mean
    const logSum = globalData.reduce((sum, row) => sum + Math.log(row.view_count), 0);
    const globalBaseline = Math.exp(logSum / globalData.length);

    // Calculate baselines for each channel
    const baselines = await Promise.all(
      channel_ids.map(async (channelId) => {
        const { data: snapshots } = await supabase
          .from('view_snapshots')
          .select(`
            view_count, 
            days_since_published,
            videos!inner (
              channel_id
            )
          `)
          .eq('videos.channel_id', channelId)
          .lte('days_since_published', 7)
          .not('view_count', 'is', null);

        if (!snapshots || snapshots.length === 0) {
          return {
            channel_id: channelId,
            baseline: globalBaseline,
            confidence: 0,
            method: 'global_fallback',
            video_count: 0
          };
        }

        // Calculate trimmed median
        const sortedViews = snapshots
          .map(s => s.view_count)
          .sort((a, b) => a - b);

        const trimStart = Math.floor(sortedViews.length * 0.1);
        const trimEnd = Math.ceil(sortedViews.length * 0.9);
        const trimmedViews = sortedViews.slice(trimStart, trimEnd);
        const channelMedian = trimmedViews[Math.floor(trimmedViews.length / 2)];

        // Calculate confidence
        const videoCount = snapshots.length;
        const daysTracked = 90; // Simplified for now
        const confidence = Math.min(videoCount / 30, 1.0) * Math.min(daysTracked / 90, 1.0);

        // Blend channel and global baselines based on confidence
        const effectiveBaseline = (channelMedian * confidence) + (globalBaseline * (1 - confidence));

        return {
          channel_id: channelId,
          baseline: effectiveBaseline,
          channel_baseline: channelMedian,
          global_baseline: globalBaseline,
          confidence: confidence,
          method: 'blended',
          video_count: videoCount
        };
      })
    );

    return NextResponse.json({
      global_baseline: globalBaseline,
      channel_baselines: baselines,
      total_channels: channel_ids.length
    });
    
  } catch (error) {
    console.error('Error calculating multiple baselines:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}