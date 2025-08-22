import { NextRequest, NextResponse } from 'next/server';
import { getSupabase } from '@/lib/supabase-lazy';


export async function GET(
  request: NextRequest,
  { params }: { params: { patternId: string } }
) {
  try {
    const { patternId } = params;
    
    // First get video IDs associated with this pattern
    const { data: videoPatterns, error: vpError } = await supabase
      .from('video_patterns')
      .select('video_id, match_score')
      .eq('pattern_id', patternId)
      .order('match_score', { ascending: false })
      .limit(10);
    
    if (vpError) {
      console.error('Error fetching video patterns:', vpError);
      return NextResponse.json({ error: vpError.message }, { status: 500 });
    }
    
    if (!videoPatterns || videoPatterns.length === 0) {
      return NextResponse.json({ videos: [] });
    }
    
    // Get video details
    const videoIds = videoPatterns.map(vp => vp.video_id);
    const { data: videos, error: vError } = await supabase
      .from('videos')
      .select('id, title, channel_title, view_count, published_at, rolling_baseline_views')
      .in('id', videoIds);
    
    if (vError) {
      console.error('Error fetching videos:', vError);
      return NextResponse.json({ error: vError.message }, { status: 500 });
    }
    
    // Calculate performance ratios and sort by performance
    const videosWithPerformance = (videos || []).map(video => {
      const baseline = video.rolling_baseline_views || 1;
      const performanceRatio = video.view_count / baseline;
      
      return {
        id: video.id,
        title: video.title,
        channel_title: video.channel_title,
        view_count: video.view_count,
        performance_ratio: performanceRatio,
        published_at: video.published_at
      };
    }).sort((a, b) => b.performance_ratio - a.performance_ratio);
    
    return NextResponse.json({ 
      videos: videosWithPerformance,
      total: videosWithPerformance.length 
    });
    
  } catch (error) {
    console.error('Error in pattern videos API:', error);
    return NextResponse.json(
      { error: 'Failed to fetch pattern videos' },
      { status: 500 }
    );
  }
}