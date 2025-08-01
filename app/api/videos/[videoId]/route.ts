import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export async function GET(
  request: NextRequest,
  { params }: { params: { videoId: string } }
) {
  try {
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    const { videoId } = params;

    // Fetch video details with all related data including performance metrics
    const { data: video, error } = await supabase
      .from('videos')
      .select(`
        *,
        view_tracking_priority (
          priority_tier,
          last_tracked,
          next_track_date
        ),
        video_performance_metrics!left (
          age_days,
          current_vpd,
          initial_vpd,
          channel_baseline_vpd,
          indexed_score,
          velocity_trend,
          trend_direction,
          performance_tier,
          last_calculated_at
        )
      `)
      .eq('id', videoId)
      .single();

    if (error || !video) {
      return NextResponse.json(
        { error: 'Video not found' },
        { status: 404 }
      );
    }

    // Parse metadata if it's a string
    if (video.metadata && typeof video.metadata === 'string') {
      try {
        video.metadata = JSON.parse(video.metadata);
      } catch (e) {
        console.error('Error parsing metadata:', e);
      }
    }

    // Handle video_performance_metrics which might be an array
    if (Array.isArray(video.video_performance_metrics) && video.video_performance_metrics.length > 0) {
      video.video_performance_metrics = video.video_performance_metrics[0];
    } else if (Array.isArray(video.video_performance_metrics) && video.video_performance_metrics.length === 0) {
      video.video_performance_metrics = null;
    }

    // If no performance metrics exist, calculate them on the fly
    if (!video.video_performance_metrics && video.published_at && video.view_count) {
      const ageDays = Math.floor(
        (Date.now() - new Date(video.published_at).getTime()) / (1000 * 60 * 60 * 24)
      );
      
      // Get channel baseline
      const { data: channelVideos } = await supabase
        .from('videos')
        .select('view_count, published_at')
        .eq('channel_name', video.channel_name)
        .not('id', 'eq', videoId)
        .gte('published_at', new Date(Date.now() - 180 * 24 * 60 * 60 * 1000).toISOString())
        .limit(20);
      
      let channelBaselineVpd = 1000; // Default baseline
      if (channelVideos && channelVideos.length > 5) {
        const vpds = channelVideos.map(v => {
          const vAge = Math.floor(
            (Date.now() - new Date(v.published_at).getTime()) / (1000 * 60 * 60 * 24)
          );
          return v.view_count / Math.max(vAge, 1);
        }).sort((a, b) => a - b);
        
        // Use median
        channelBaselineVpd = vpds[Math.floor(vpds.length / 2)];
      }
      
      const currentVpd = video.view_count / Math.max(ageDays, 1);
      const indexedScore = currentVpd / channelBaselineVpd;
      
      // Get performance envelope for comparison
      const { data: envelope } = await supabase
        .from('performance_envelopes')
        .select('p50_views')
        .eq('day_since_published', Math.min(ageDays, 365))
        .single();
      
      let performanceTier = 'Standard';
      if (indexedScore >= 3) performanceTier = 'Viral';
      else if (indexedScore >= 1.5) performanceTier = 'Outperforming';
      else if (indexedScore >= 0.5) performanceTier = 'On Track';
      else if (indexedScore >= 0.2) performanceTier = 'Underperforming';
      else performanceTier = 'Needs Attention';
      
      video.video_performance_metrics = {
        age_days: ageDays,
        current_vpd: currentVpd,
        initial_vpd: currentVpd, // Simplified for now
        channel_baseline_vpd: channelBaselineVpd,
        indexed_score: indexedScore,
        velocity_trend: 0, // Would need historical data
        trend_direction: '→',
        performance_tier: performanceTier,
        last_calculated_at: new Date().toISOString()
      };
    }

    // Get performance envelope data for the graph
    if (video.published_at) {
      const ageDays = Math.floor(
        (Date.now() - new Date(video.published_at).getTime()) / (1000 * 60 * 60 * 24)
      );
      
      // Get envelope data for the video's age range
      const { data: envelopeData } = await supabase
        .from('performance_envelopes')
        .select('day_since_published, p10_views, p25_views, p50_views, p75_views, p90_views')
        .lte('day_since_published', Math.min(ageDays * 1.2, 730))
        .order('day_since_published');
      
      video.performance_envelope = envelopeData || [];
    }

    return NextResponse.json(video);
  } catch (error) {
    console.error('Error fetching video:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}