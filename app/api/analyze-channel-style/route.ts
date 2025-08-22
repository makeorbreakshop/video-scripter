/**
 * Channel Style Analysis API - Extract channel patterns and style
 * POST /api/analyze-channel-style
 */

import { NextRequest, NextResponse } from 'next/server';
import { getSupabase } from '@/lib/supabase-lazy';
import Anthropic from '@anthropic-ai/sdk';

interface ChannelStyleRequest {
  channel_id: string;
}

interface ChannelStyle {
  channel_name: string;
  channel_id: string;
  title_patterns: string[];
  content_themes: string[];
  unique_voice: string;
  success_factors: string[];
  typical_hooks: string[];
  baseline_performance: number;
  top_performer_avg: number;
}

export async function POST(request: NextRequest) {
  const startTime = Date.now();
  
  try {
    const { channel_id }: ChannelStyleRequest = await request.json();

    if (!channel_id) {
      return NextResponse.json(
        { error: 'channel_id is required' },
        { status: 400 }
      );
    }


    console.log(`🎨 Analyzing style for channel: ${channel_id}`);

    // Get top performers (for understanding what works)
    const { data: topPerformers, error: topError } = await supabase
      .from('videos')
      .select('title, view_count, temporal_performance_score, llm_summary, published_at')
      .eq('channel_id', channel_id)
      .not('temporal_performance_score', 'is', null)
      .gte('temporal_performance_score', 2.0)
      .order('temporal_performance_score', { ascending: false })
      .limit(10);

    if (topError) {
      console.error('❌ Failed to fetch top performers:', topError);
      throw topError;
    }

    // Get recent videos (for current style)
    const { data: recentVideos, error: recentError } = await supabase
      .from('videos')
      .select('title, view_count, temporal_performance_score, published_at')
      .eq('channel_id', channel_id)
      .order('published_at', { ascending: false })
      .limit(20);

    if (recentError) {
      console.error('❌ Failed to fetch recent videos:', recentError);
      throw recentError;
    }

    // Get all titles for pattern extraction
    const { data: allVideos, error: allError } = await supabase
      .from('videos')
      .select('title, temporal_performance_score')
      .eq('channel_id', channel_id)
      .order('published_at', { ascending: false })
      .limit(100);

    if (allError) {
      console.error('❌ Failed to fetch all videos:', allError);
      throw allError;
    }

    // Get channel name from any video
    const { data: channelInfo } = await supabase
      .from('videos')
      .select('channel_name')
      .eq('channel_id', channel_id)
      .limit(1)
      .single();
    
    const channelName = channelInfo?.channel_name || 'Unknown Channel';

    // Calculate baseline performance
    const baselineVideos = recentVideos?.filter(v => 
      v.temporal_performance_score >= 0.8 && v.temporal_performance_score <= 1.2
    ) || [];
    
    const baselinePerformance = baselineVideos.length > 0
      ? baselineVideos.reduce((sum, v) => sum + v.temporal_performance_score, 0) / baselineVideos.length
      : 1.0;

    const topPerformerAvg = topPerformers && topPerformers.length > 0
      ? topPerformers.reduce((sum, v) => sum + v.temporal_performance_score, 0) / topPerformers.length
      : 3.0;

    // Analyze with Claude
    const anthropic = new Anthropic({
      apiKey: process.env.ANTHROPIC_API_KEY!,
    });

    const analysisPrompt = `Analyze the YouTube channel "${channelName}" to extract their content style and patterns.

TOP PERFORMERS (${topPerformers?.length || 0} videos, avg ${topPerformerAvg.toFixed(1)}x baseline):
${(topPerformers || []).map((v, i) => 
  `${i + 1}. "${v.title}" - ${v.temporal_performance_score ? v.temporal_performance_score.toFixed(1) + 'x' : 'N/A'}
     ${v.llm_summary ? `Summary: ${v.llm_summary.slice(0, 150)}...` : ''}`
).join('\n')}

RECENT VIDEOS (last ${recentVideos?.length || 0} videos):
${(recentVideos || []).slice(0, 10).map((v, i) => 
  `${i + 1}. "${v.title}" - ${v.temporal_performance_score ? v.temporal_performance_score.toFixed(1) + 'x' : 'N/A'}`
).join('\n')}

ALL TITLES SAMPLE (${allVideos?.length || 0} total):
${(allVideos || []).slice(0, 30).map(v => `"${v.title}"`).join('\n')}

Extract and return a JSON object with:
{
  "title_patterns": ["List 3-5 title formulas they commonly use"],
  "content_themes": ["List 3-5 recurring topics/themes"],
  "unique_voice": "One sentence describing their unique angle/perspective",
  "success_factors": ["What separates their hits from misses - 3 factors"],
  "typical_hooks": ["List 3-5 hooks/angles they use to grab attention"]
}`;

    const analysisResponse = await anthropic.messages.create({
      model: 'claude-3-5-sonnet-20241022',
      max_tokens: 1000,
      temperature: 0.7,
      messages: [{ role: 'user', content: analysisPrompt }]
    });

    const content = analysisResponse.content[0];
    if (content.type !== 'text') {
      throw new Error('Unexpected response type from Claude');
    }

    let styleAnalysis: Partial<ChannelStyle>;
    try {
      const jsonMatch = content.text.match(/\{[\s\S]*\}/);
      if (!jsonMatch) throw new Error('No JSON found in response');
      styleAnalysis = JSON.parse(jsonMatch[0]);
    } catch (parseError) {
      console.error('Failed to parse Claude response:', content.text);
      throw new Error('Failed to parse style analysis');
    }

    const channelStyle: ChannelStyle = {
      channel_name: channelName,
      channel_id,
      title_patterns: styleAnalysis.title_patterns || [],
      content_themes: styleAnalysis.content_themes || [],
      unique_voice: styleAnalysis.unique_voice || '',
      success_factors: styleAnalysis.success_factors || [],
      typical_hooks: styleAnalysis.typical_hooks || [],
      baseline_performance: baselinePerformance,
      top_performer_avg: topPerformerAvg
    };

    const processingTime = Date.now() - startTime;
    console.log(`✅ Channel style analysis complete in ${processingTime}ms`);

    return NextResponse.json({
      style: channelStyle,
      stats: {
        total_videos: allVideos?.length || 0,
        top_performers: topPerformers?.length || 0,
        baseline_videos: baselineVideos.length,
        processing_time_ms: processingTime
      }
    });

  } catch (error) {
    console.error('❌ Channel style analysis failed:', error);
    
    return NextResponse.json(
      { 
        error: 'Failed to analyze channel style',
        details: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  }
}