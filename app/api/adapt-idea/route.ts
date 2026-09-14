/**
 * Adapt Idea API - Generates niche-specific adaptations of viral patterns
 * POST /api/adapt-idea
 */

import { NextRequest, NextResponse } from 'next/server';
import { getSupabase } from '@/lib/supabase-lazy';
import { videoTextFor } from '@/lib/app/video-text';
import Anthropic from '@anthropic-ai/sdk';

interface AdaptRequest {
  video_id: string;
  target_niche: string;
  pattern_description?: string; // Optional if we extract it fresh
}

/** The `videos` columns this route renders. The long text lives in video_text now, so it is
 *  hydrated separately instead of being pulled along with the row. */
export const SOURCE_VIDEO_COLUMNS =
  'id, title, channel_name, channel_id, view_count, temporal_performance_score, ' +
  'topic_niche, topic_domain, published_at, thumbnail_url';

/** Put hydrated long text back on rows that were selected without it. */
export function attachSummaries<T extends { id: string }>(
  rows: T[] | null | undefined,
  texts: Map<string, { llmSummary: string | null }>
): Array<T & { summary: string | null }> {
  return (rows ?? []).map((row) => ({ ...row, summary: texts.get(row.id)?.llmSummary ?? null }));
}

interface Adaptation {
  title: string;
  why_it_works: string;
  confidence_score: number;
}

export async function POST(request: NextRequest) {
  const startTime = Date.now();
  
  try {
    const { video_id, target_niche, pattern_description }: AdaptRequest = await request.json();

    if (!video_id || !target_niche) {
      return NextResponse.json(
        { error: 'video_id and target_niche are required' },
        { status: 400 }
      );
    }


    console.log(`🎯 Adapting idea from video ${video_id} to ${target_niche}`);

    // Get the source video
    const { data: sourceVideo, error: videoError } = await supabase
      .from('videos')
      .select(SOURCE_VIDEO_COLUMNS)
      .eq('id', video_id)
      .single();

    if (videoError || !sourceVideo) {
      return NextResponse.json(
        { error: 'Source video not found' },
        { status: 404 }
      );
    }

    const [sourceWithText] = attachSummaries([sourceVideo as any], await videoTextFor([video_id]));

    // Get successful videos from the target niche (for context)
    const { data: targetNicheVideos } = await supabase
      .from('videos')
      .select('title, view_count, temporal_performance_score')
      .or(`topic_niche.eq.${target_niche},topic_domain.eq.${target_niche}`)
      .gte('temporal_performance_score', 3)
      .order('temporal_performance_score', { ascending: false })
      .limit(5);

    // Initialize Claude
    const anthropic = new Anthropic({
      apiKey: process.env.ANTHROPIC_API_KEY!,
    });

    // Prepare the prompt
    const prompt = `You are a YouTube title optimization expert helping creators adapt successful patterns to their niche.

SOURCE VIDEO (${sourceVideo.temporal_performance_score.toFixed(1)}x viral performance):
Title: "${sourceVideo.title}"
Channel: ${sourceVideo.channel_name}
Niche: ${sourceVideo.topic_niche || sourceVideo.topic_domain}
Views: ${sourceVideo.view_count.toLocaleString()}
${sourceWithText.summary ? `Summary: ${sourceWithText.summary}` : ''}

${pattern_description ? `IDENTIFIED PATTERN: ${pattern_description}\n` : ''}

TARGET NICHE: ${target_niche}

EXISTING SUCCESSFUL VIDEOS IN ${target_niche.toUpperCase()}:
${(targetNicheVideos || []).map((v, i) => 
  `${i + 1}. "${v.title}" (${v.temporal_performance_score.toFixed(1)}x performance)`
).join('\n') || 'No high performers found in this niche yet'}

Generate 5 NEW video titles that:
1. Adapt the viral pattern from the source video to ${target_niche}
2. Feel native to ${target_niche} (use appropriate terminology and references)
3. Would genuinely excite viewers interested in ${target_niche}
4. Are specific and actionable (not generic)
5. Include concrete details when possible (numbers, specific techniques, etc.)

Return a JSON array with this structure:
[
  {
    "title": "The adapted title",
    "why_it_works": "Brief explanation of why this adaptation captures the original's appeal",
    "confidence_score": 0.0 to 1.0 (how likely this is to perform well)
  }
]

Generate 5 adaptations, ordered by confidence score (highest first).`;

    const response = await anthropic.messages.create({
      model: 'claude-3-5-sonnet-20241022',
      max_tokens: 1500,
      temperature: 0.8,
      messages: [
        {
          role: 'user',
          content: prompt
        }
      ]
    });

    // Parse the response
    const content = response.content[0];
    if (content.type !== 'text') {
      throw new Error('Unexpected response type from Claude');
    }

    let adaptations: Adaptation[];
    try {
      // Extract JSON array from the response
      const jsonMatch = content.text.match(/\[[\s\S]*\]/);
      if (!jsonMatch) {
        throw new Error('No JSON array found in response');
      }
      adaptations = JSON.parse(jsonMatch[0]);
    } catch (parseError) {
      console.error('Failed to parse Claude response:', content.text);
      throw new Error('Failed to parse adaptations');
    }

    // Sort by confidence score (just in case)
    adaptations.sort((a, b) => b.confidence_score - a.confidence_score);

    const processingTime = Date.now() - startTime;
    console.log(`✅ Generated ${adaptations.length} adaptations in ${processingTime}ms`);

    return NextResponse.json({
      adaptations,
      source_video: {
        id: sourceVideo.id,
        title: sourceVideo.title,
        channel: sourceVideo.channel_name,
        score: sourceVideo.temporal_performance_score,
        niche: sourceVideo.topic_niche || sourceVideo.topic_domain
      },
      target_niche,
      processing_time_ms: processingTime
    });

  } catch (error) {
    console.error('❌ Adaptation failed:', error);
    
    return NextResponse.json(
      { 
        error: 'Failed to generate adaptations',
        details: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  }
}