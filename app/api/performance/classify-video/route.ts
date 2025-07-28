import { NextRequest, NextResponse } from 'next/server';
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { cookies } from 'next/headers';

interface PerformanceCategory {
  ratio: number;
  category: 'viral' | 'outperforming' | 'on_track' | 'underperforming' | 'poor';
  description: string;
}

function classifyPerformance(ratio: number): PerformanceCategory {
  if (ratio > 3.0) {
    return { ratio, category: 'viral', description: 'Viral (>3x expected)' };
  } else if (ratio >= 1.5) {
    return { ratio, category: 'outperforming', description: 'Outperforming (1.5-3x expected)' };
  } else if (ratio >= 0.5) {
    return { ratio, category: 'on_track', description: 'On Track (0.5-1.5x expected)' };
  } else if (ratio >= 0.2) {
    return { ratio, category: 'underperforming', description: 'Underperforming (0.2-0.5x expected)' };
  } else {
    return { ratio, category: 'poor', description: 'Poor (<0.2x expected)' };
  }
}

export async function GET(request: NextRequest) {
  try {
    const supabase = createRouteHandlerClient({ cookies });
    
    // Get video_id from query params
    const searchParams = request.nextUrl.searchParams;
    const videoId = searchParams.get('video_id');
    
    if (!videoId) {
      return NextResponse.json(
        { error: 'video_id parameter is required' },
        { status: 400 }
      );
    }

    // Get video details including channel
    const { data: video, error: videoError } = await supabase
      .from('videos')
      .select('id, title, channel_id, view_count, published_at')
      .eq('id', videoId)
      .single();

    if (videoError || !video) {
      return NextResponse.json(
        { error: 'Video not found' },
        { status: 404 }
      );
    }

    // Calculate days since published
    const publishedDate = new Date(video.published_at);
    const daysSincePublished = Math.floor((Date.now() - publishedDate.getTime()) / (1000 * 60 * 60 * 24));

    // Get channel baseline (using our other endpoint logic)
    const baselineResponse = await fetch(
      `${request.nextUrl.origin}/api/performance/channel-baseline?channel_id=${video.channel_id}`
    );
    const baselineData = await baselineResponse.json();

    if (!baselineData.baseline) {
      // Use global baseline if channel has no data
      const { data: globalEnvelope } = await supabase
        .from('performance_envelopes')
        .select('p50_views')
        .eq('day_since_published', 1)
        .single();

      baselineData.baseline = globalEnvelope?.p50_views || 8478; // Day 1 median from our data
    }

    // Get envelope data for current age and day 1 (up to 10 years)
    const { data: envelopeData, error: envelopeError } = await supabase
      .from('performance_envelopes')
      .select('day_since_published, p50_views')
      .in('day_since_published', [1, Math.min(daysSincePublished, 3650)])
      .order('day_since_published');

    if (envelopeError || !envelopeData || envelopeData.length === 0) {
      return NextResponse.json(
        { error: 'Failed to fetch envelope data' },
        { status: 500 }
      );
    }

    // Extract day 1 and current day values (up to 10 years)
    const day1Data = envelopeData.find(d => d.day_since_published === 1);
    const currentDayData = envelopeData.find(d => d.day_since_published === Math.min(daysSincePublished, 3650));

    if (!day1Data || !currentDayData) {
      return NextResponse.json(
        { error: 'Insufficient envelope data' },
        { status: 500 }
      );
    }

    // Calculate expected views using the formula
    const globalShapeMultiplier = currentDayData.p50_views / day1Data.p50_views;
    const expectedViews = baselineData.baseline * globalShapeMultiplier;
    const performanceRatio = video.view_count / expectedViews;

    // Classify performance
    const classification = classifyPerformance(performanceRatio);

    // Update video record with performance data
    await supabase
      .from('videos')
      .update({
        envelope_performance_ratio: performanceRatio,
        envelope_performance_category: classification.category
      })
      .eq('id', videoId);

    return NextResponse.json({
      video_id: videoId,
      title: video.title,
      channel_id: video.channel_id,
      days_since_published: daysSincePublished,
      actual_views: video.view_count,
      expected_views: Math.round(expectedViews),
      performance_ratio: performanceRatio,
      performance_category: classification.category,
      description: classification.description,
      baseline_info: {
        channel_baseline: baselineData.baseline,
        confidence: baselineData.confidence,
        method: baselineData.method,
        global_shape_multiplier: globalShapeMultiplier
      }
    });
    
  } catch (error) {
    console.error('Error classifying video performance:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

// POST endpoint to classify multiple videos
export async function POST(request: NextRequest) {
  try {
    const supabase = createRouteHandlerClient({ cookies });
    const { video_ids, update_database = false } = await request.json();
    
    if (!video_ids || !Array.isArray(video_ids)) {
      return NextResponse.json(
        { error: 'video_ids array is required' },
        { status: 400 }
      );
    }

    // Get all videos with their channels
    const { data: videos, error: videosError } = await supabase
      .from('videos')
      .select('id, title, channel_id, view_count, published_at')
      .in('id', video_ids);

    if (videosError || !videos) {
      return NextResponse.json(
        { error: 'Failed to fetch videos' },
        { status: 500 }
      );
    }

    // Get unique channel IDs
    const channelIds = [...new Set(videos.map(v => v.channel_id))];

    // Get baselines for all channels
    const baselineResponse = await fetch(
      `${request.nextUrl.origin}/api/performance/channel-baseline`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ channel_ids: channelIds })
      }
    );
    const baselineData = await baselineResponse.json();

    // Create channel baseline lookup
    const channelBaselines = new Map(
      baselineData.channel_baselines.map((b: any) => [b.channel_id, b.baseline])
    );

    // Get all envelope data we need
    const { data: envelopeData, error: envelopeError } = await supabase
      .from('performance_envelopes')
      .select('day_since_published, p50_views')
      .order('day_since_published');

    if (envelopeError || !envelopeData) {
      return NextResponse.json(
        { error: 'Failed to fetch envelope data' },
        { status: 500 }
      );
    }

    // Create envelope lookup
    const envelopeLookup = new Map(
      envelopeData.map(e => [e.day_since_published, e.p50_views])
    );

    const day1Views = envelopeLookup.get(1) || 8478;

    // Process each video
    const results = videos.map(video => {
      const daysSincePublished = Math.floor(
        (Date.now() - new Date(video.published_at).getTime()) / (1000 * 60 * 60 * 24)
      );
      
      const channelBaseline = channelBaselines.get(video.channel_id) || baselineData.global_baseline;
      const currentDayViews = envelopeLookup.get(Math.min(daysSincePublished, 3650)) || envelopeLookup.get(3650)!;
      
      const globalShapeMultiplier = currentDayViews / day1Views;
      const expectedViews = channelBaseline * globalShapeMultiplier;
      const performanceRatio = video.view_count / expectedViews;
      
      const classification = classifyPerformance(performanceRatio);

      return {
        video_id: video.id,
        title: video.title,
        channel_id: video.channel_id,
        days_since_published: daysSincePublished,
        actual_views: video.view_count,
        expected_views: Math.round(expectedViews),
        performance_ratio: performanceRatio,
        performance_category: classification.category,
        description: classification.description
      };
    });

    // Update database if requested
    if (update_database) {
      const updates = results.map(r => ({
        id: r.video_id,
        envelope_performance_ratio: r.performance_ratio,
        envelope_performance_category: r.performance_category
      }));

      for (const update of updates) {
        await supabase
          .from('videos')
          .update({
            envelope_performance_ratio: update.envelope_performance_ratio,
            envelope_performance_category: update.envelope_performance_category
          })
          .eq('id', update.id);
      }
    }

    return NextResponse.json({
      classifications: results,
      total_videos: results.length,
      categories_summary: {
        viral: results.filter(r => r.performance_category === 'viral').length,
        outperforming: results.filter(r => r.performance_category === 'outperforming').length,
        on_track: results.filter(r => r.performance_category === 'on_track').length,
        underperforming: results.filter(r => r.performance_category === 'underperforming').length,
        poor: results.filter(r => r.performance_category === 'poor').length
      }
    });
    
  } catch (error) {
    console.error('Error classifying multiple videos:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}