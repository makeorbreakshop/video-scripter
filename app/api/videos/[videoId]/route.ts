import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ videoId: string }> }
) {
  try {
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    const { videoId } = await params;

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
      const { data: envelopeData, error: envelopeError } = await supabase
        .from('performance_envelopes')
        .select('day_since_published, p10_views, p25_views, p50_views, p75_views, p90_views')
        .gte('day_since_published', 0)
        .lte('day_since_published', Math.min(Math.floor(ageDays * 1.2), 730))
        .order('day_since_published')
        .limit(500);
      
      if (envelopeError) {
        console.error('Error fetching performance envelope:', envelopeError);
      }
      
      video.performance_envelope = envelopeData || [];
      console.log(`Loaded ${video.performance_envelope.length} performance envelope points for video age ${ageDays} days`);
      
      // NEW APPROACH: Backfill historical performance using global curves
      if (envelopeData && envelopeData.length > 0) {
        // Get all channel videos with current views and ages
        const { data: channelVideos } = await supabase
          .from('videos')
          .select('id, view_count, published_at')
          .eq('channel_name', video.channel_name)
          .not('view_count', 'is', null)
          .not('published_at', 'is', null)
          .order('published_at', { ascending: false })
          .limit(500);
        
        if (channelVideos && channelVideos.length > 20) {
          // For each video, calculate what it likely had at key checkpoints
          const backfilledData: { [key: number]: number[] } = {
            1: [], 7: [], 14: [], 30: [], 60: [], 90: [], 180: []
          };
          
          channelVideos.forEach(cv => {
            const videoAge = Math.floor(
              (Date.now() - new Date(cv.published_at).getTime()) / (1000 * 60 * 60 * 24)
            );
            
            if (videoAge < 1) return; // Skip brand new videos
            
            // Find this video's current position on global curve (closest match)
            const targetAge = Math.min(videoAge, 730);
            const currentGlobalEnvelope = envelopeData.find(e => e.day_since_published === targetAge) ||
                                        envelopeData.reduce((closest, current) => 
                                          Math.abs(current.day_since_published - targetAge) < Math.abs(closest.day_since_published - targetAge) 
                                            ? current : closest
                                        );
            
            if (!currentGlobalEnvelope) return;
            
            // For each checkpoint we care about
            Object.keys(backfilledData).forEach(checkpointStr => {
              const checkpoint = parseInt(checkpointStr);
              if (videoAge >= checkpoint) {
                // This video was old enough to have reached this checkpoint
                const checkpointEnvelope = envelopeData.find(e => e.day_since_published === checkpoint) ||
                                         envelopeData.reduce((closest, current) => 
                                           Math.abs(current.day_since_published - checkpoint) < Math.abs(closest.day_since_published - checkpoint) 
                                             ? current : closest
                                         );
                if (checkpointEnvelope) {
                  // Backfill: current_views * (checkpoint_global / current_age_global)
                  const estimatedViewsAtCheckpoint = cv.view_count * 
                    (checkpointEnvelope.p50_views / currentGlobalEnvelope.p50_views);
                  backfilledData[checkpoint].push(estimatedViewsAtCheckpoint);
                }
              }
            });
          });
          
          // Calculate channel percentiles at each checkpoint
          const channelCheckpoints: { [key: number]: any } = {};
          Object.entries(backfilledData).forEach(([checkpoint, views]) => {
            if (views.length >= 10) { // Need enough data points
              const sorted = views.sort((a, b) => a - b);
              channelCheckpoints[parseInt(checkpoint)] = {
                p10: sorted[Math.floor(sorted.length * 0.1)],
                p25: sorted[Math.floor(sorted.length * 0.25)],
                p50: sorted[Math.floor(sorted.length * 0.5)], // median
                p75: sorted[Math.floor(sorted.length * 0.75)],
                p90: sorted[Math.floor(sorted.length * 0.9)]
              };
            }
          });
          
          console.log('Backfilled channel checkpoints:', channelCheckpoints);
          
          // Calculate performance bands based on backfilled data
          video.backfilled_baseline = channelCheckpoints;
          
          // For the current video, find its expected performance
          const currentCheckpoint = Object.keys(channelCheckpoints)
            .map(k => parseInt(k))
            .filter(k => k <= ageDays)
            .sort((a, b) => b - a)[0]; // Get closest checkpoint <= current age
          
          if (currentCheckpoint && channelCheckpoints[currentCheckpoint]) {
            const globalAtCheckpoint = envelopeData.find(e => e.day_since_published === currentCheckpoint) ||
                                     envelopeData.reduce((closest, current) => 
                                       Math.abs(current.day_since_published - currentCheckpoint) < Math.abs(closest.day_since_published - currentCheckpoint) 
                                         ? current : closest
                                     );
            if (globalAtCheckpoint) {
              // This is the key ratio: how much better/worse this channel performs
              video.channel_performance_ratio = channelCheckpoints[currentCheckpoint].p50 / globalAtCheckpoint.p50_views;
              
              // Apply this ratio to the current age for accurate comparison
              const currentAgeTarget = Math.min(ageDays, 730);
              const currentGlobal = envelopeData.find(e => e.day_since_published === currentAgeTarget) ||
                                  envelopeData.reduce((closest, current) => 
                                    Math.abs(current.day_since_published - currentAgeTarget) < Math.abs(closest.day_since_published - currentAgeTarget) 
                                      ? current : closest
                                  );
              if (currentGlobal) {
                video.expected_views_at_current_age = currentGlobal.p50_views * video.channel_performance_ratio;
              }
            }
          }
          
          // Create age-appropriate performance bands using channel percentiles
          video.channel_adjusted_envelope = envelopeData.map(point => {
            // Find the closest checkpoint we have data for
            const relevantCheckpoint = Object.keys(channelCheckpoints)
              .map(k => parseInt(k))
              .filter(k => k <= point.day_since_published)
              .sort((a, b) => b - a)[0];
            
            if (relevantCheckpoint && channelCheckpoints[relevantCheckpoint]) {
              const globalAtCheckpoint = envelopeData.find(e => e.day_since_published === relevantCheckpoint) ||
                                       envelopeData.reduce((closest, current) => 
                                         Math.abs(current.day_since_published - relevantCheckpoint) < Math.abs(closest.day_since_published - relevantCheckpoint) 
                                           ? current : closest
                                       );
              const channelData = channelCheckpoints[relevantCheckpoint];
              
              if (globalAtCheckpoint) {
                // Calculate individual ratios for each percentile
                const p10Ratio = channelData.p10 / globalAtCheckpoint.p10_views;
                const p25Ratio = channelData.p25 / globalAtCheckpoint.p25_views;
                const p50Ratio = channelData.p50 / globalAtCheckpoint.p50_views;
                const p75Ratio = channelData.p75 / globalAtCheckpoint.p75_views;
                const p90Ratio = channelData.p90 / globalAtCheckpoint.p90_views;
                
                return {
                  day_since_published: point.day_since_published,
                  p10_views: point.p10_views * p10Ratio,
                  p25_views: point.p25_views * p25Ratio,
                  p50_views: point.p50_views * p50Ratio,
                  p75_views: point.p75_views * p75Ratio,
                  p90_views: point.p90_views * p90Ratio
                };
              }
            }
            // Fallback to unadjusted if no data
            return point;
          });
          
          console.log(`Created channel-adjusted envelope with ${video.channel_adjusted_envelope.length} points`);
        } else {
          // Not enough channel data - fall back to global curves
          console.log('Not enough channel videos for backfill analysis, using global curves');
          video.channel_performance_ratio = 1;
          video.channel_adjusted_envelope = envelopeData;
        }
      }
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