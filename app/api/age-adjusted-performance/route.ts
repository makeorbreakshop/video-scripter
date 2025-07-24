import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { Database } from '@/types/database';

const supabase = createClient<Database>(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const channelName = searchParams.get('channel');
  const videoId = searchParams.get('videoId');

  if (!channelName && !videoId) {
    return NextResponse.json({ error: 'Channel name or video ID required' }, { status: 400 });
  }

  try {
    if (videoId) {
      // Get single video performance
      const score = await calculateVideoScore(videoId);
      return NextResponse.json({ score });
    } else {
      // Get channel overview
      const analysis = await analyzeChannel(channelName!);
      return NextResponse.json(analysis);
    }
  } catch (error) {
    console.error('Error calculating performance:', error);
    return NextResponse.json({ error: 'Failed to calculate performance' }, { status: 500 });
  }
}

async function calculateVideoScore(videoId: string) {
  // Get video with its snapshots
  const { data: video } = await supabase
    .from('videos')
    .select(`
      id,
      title,
      published_at,
      channel_id,
      view_count,
      view_snapshots (
        days_since_published,
        view_count,
        snapshot_date
      )
    `)
    .eq('id', videoId)
    .single();

  if (!video || !video.view_snapshots || video.view_snapshots.length < 2) {
    return null;
  }

  // Get channel's typical growth pattern
  const channelCurve = await getChannelGrowthCurve(video.channel_id);
  
  // Calculate current age
  const currentAge = Math.floor(
    (Date.now() - new Date(video.published_at).getTime()) / (1000 * 60 * 60 * 24)
  );

  // Predict expected views at current age
  const expectedViews = predictViews(channelCurve, currentAge);
  
  // Calculate score
  const score = video.view_count / expectedViews;

  return {
    videoId: video.id,
    title: video.title,
    currentAge,
    currentViews: video.view_count,
    expectedViews: Math.round(expectedViews),
    score: Math.round(score * 100) / 100,
    performance: getPerformanceLabel(score)
  };
}

async function analyzeChannel(channelName: string) {
  // Get all videos with snapshots for this channel
  const { data: videos } = await supabase
    .from('videos')
    .select(`
      id,
      channel_id,
      published_at,
      view_count,
      view_snapshots (
        days_since_published,
        view_count
      )
    `)
    .eq('channel_name', channelName)
    .order('published_at', { ascending: false })
    .limit(100);

  if (!videos || videos.length === 0) {
    return { error: 'No videos found' };
  }

  // Build channel growth curve from all videos with 3+ snapshots
  const growthData: { age: number; growthMultiple: number }[] = [];
  
  videos.forEach(video => {
    if (!video.view_snapshots || video.view_snapshots.length < 3) return;
    
    const snapshots = video.view_snapshots.sort((a, b) => a.days_since_published - b.days_since_published);
    const firstSnapshot = snapshots[0];
    
    snapshots.forEach(snapshot => {
      if (firstSnapshot.view_count > 0) {
        growthData.push({
          age: snapshot.days_since_published,
          growthMultiple: snapshot.view_count / firstSnapshot.view_count
        });
      }
    });
  });

  // Aggregate by age to get typical growth
  const ageGroups = new Map<number, number[]>();
  growthData.forEach(point => {
    if (!ageGroups.has(point.age)) {
      ageGroups.set(point.age, []);
    }
    ageGroups.get(point.age)!.push(point.growthMultiple);
  });

  // Calculate median growth at each age
  const medianGrowth = Array.from(ageGroups.entries())
    .map(([age, multiples]) => ({
      age,
      growth: getMedian(multiples)
    }))
    .sort((a, b) => a.age - b.age);

  // Fit curve to median points
  const curve = fitGrowthCurve(medianGrowth);

  // Score all videos
  const scoredVideos = videos.map(video => {
    const currentAge = Math.floor(
      (Date.now() - new Date(video.published_at).getTime()) / (1000 * 60 * 60 * 24)
    );
    
    const expectedViews = predictViews(curve, currentAge);
    const score = video.view_count / expectedViews;
    
    return {
      id: video.id,
      age: currentAge,
      views: video.view_count,
      expected: Math.round(expectedViews),
      score: Math.round(score * 100) / 100
    };
  });

  return {
    channel: channelName,
    videosAnalyzed: videos.length,
    growthCurve: curve,
    performance: {
      outperforming: scoredVideos.filter(v => v.score >= 1.5).length,
      onTrack: scoredVideos.filter(v => v.score >= 1.0 && v.score < 1.5).length,
      underperforming: scoredVideos.filter(v => v.score < 0.7).length
    },
    recentVideos: scoredVideos.slice(0, 10)
  };
}

async function getChannelGrowthCurve(channelId: string) {
  // This would be more sophisticated in production
  // For now, simple power curve from channel data
  const { data } = await supabase
    .rpc('get_channel_growth_pattern', { p_channel_id: channelId });
    
  // Fallback to default curve
  return { type: 'power', a: 1000, b: 0.5 };
}

function fitGrowthCurve(points: { age: number; growth: number }[]) {
  if (points.length < 2) {
    return { type: 'linear', a: 0.1, b: 1 };
  }
  
  // Simple power curve fitting: growth = a * age^b
  const first = points[0];
  const last = points[points.length - 1];
  
  if (first.age === last.age || first.growth <= 0 || last.growth <= 0) {
    return { type: 'linear', a: 0.1, b: 1 };
  }
  
  const b = Math.log(last.growth / first.growth) / Math.log(last.age / first.age);
  const a = first.growth / Math.pow(first.age, b);
  
  return { type: 'power', a, b };
}

function predictViews(curve: any, age: number): number {
  if (curve.type === 'power') {
    return curve.a * Math.pow(age, curve.b);
  }
  // Linear fallback
  return curve.a * age + curve.b;
}

function getMedian(values: number[]): number {
  const sorted = values.sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function getPerformanceLabel(score: number): string {
  if (score >= 1.5) return 'Outperforming';
  if (score >= 1.0) return 'On Track';
  if (score >= 0.7) return 'Below Average';
  return 'Underperforming';
}