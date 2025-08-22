/**
 * Title Generation API - Generate multiple title variations for a topic
 * POST /api/generate-titles
 */

import { NextRequest, NextResponse } from 'next/server';
import { getSupabase } from '@/lib/supabase-lazy';
import Anthropic from '@anthropic-ai/sdk';

interface GenerateTitlesRequest {
  topic: {
    concept: string;
    description: string;
    angle: string;
    implementation_notes: string;
  };
  pattern: {
    pattern_name: string;
    pattern_description: string;
    psychological_trigger: string;
  };
  channel_style: {
    channel_name: string;
    channel_id: string;
    title_patterns: string[];
    typical_hooks: string[];
  };
}

interface TitleVariation {
  title: string;
  style_match: string;
  style_examples?: string[];  // Add examples of similar titles from channel
  hook_analysis: string;
  expected_ctr: string;
  reasoning: string;
}

export async function POST(request: NextRequest) {
  const startTime = Date.now();
  
  try {
    const { topic, pattern, channel_style }: GenerateTitlesRequest = await request.json();

    if (!topic || !pattern || !channel_style) {
      return NextResponse.json(
        { error: 'topic, pattern, and channel_style are required' },
        { status: 400 }
      );
    }


    console.log(`📝 Generating titles for concept: ${topic.concept} for ${channel_style.channel_name}`);

    // Get some example high-performing titles from this channel
    const { data: topTitles } = await supabase
      .from('videos')
      .select('title, temporal_performance_score, view_count')
      .eq('channel_id', channel_style.channel_id)
      .gte('temporal_performance_score', 3.0)
      .order('temporal_performance_score', { ascending: false })
      .limit(10);

    // Generate titles using Claude
    const anthropic = new Anthropic({
      apiKey: process.env.ANTHROPIC_API_KEY!,
    });

    const titlePrompt = `You are creating YouTube title variations for ${channel_style.channel_name}.

TOPIC CONCEPT: ${topic.concept}
DESCRIPTION: ${topic.description}
ANGLE: ${topic.angle}
IMPLEMENTATION: ${topic.implementation_notes}

PATTERN TO APPLY: ${pattern.pattern_name}
${pattern.pattern_description}

CHANNEL'S TITLE PATTERNS:
${channel_style.title_patterns.join('\n')}

CHANNEL'S TYPICAL HOOKS:
${channel_style.typical_hooks.join('\n')}

CHANNEL'S TOP PERFORMERS:
${(topTitles || []).slice(0, 5).map((v, i) => 
  `${i + 1}. "${v.title}" (${v.temporal_performance_score.toFixed(1)}x)`
).join('\n')}

Generate 6 different title variations that:
1. Use different title formulas from the channel's style
2. Apply the viral pattern effectively
3. Create strong curiosity gaps or emotional hooks
4. Feel authentic to the channel's voice
5. Range from safe/expected to bold/experimental

For each title:
- Identify which channel style pattern it matches
- List 1-2 specific video titles from their channel that use this pattern
- Analyze the hook mechanism
- Estimate CTR impact (low/medium/high)
- Explain why it would work

Return as JSON array:
[{
  "title": "The actual YouTube title",
  "style_match": "Brief description of the pattern (e.g., 'Number + Mistake/Problem format')",
  "style_examples": ["Actual title from their channel using this pattern", "Another example if available"],
  "hook_analysis": "What makes people want to click",
  "expected_ctr": "low/medium/high",
  "reasoning": "Why this title works for this channel and topic"
}]`;

    const titlesResponse = await anthropic.messages.create({
      model: 'claude-3-5-sonnet-20241022',
      max_tokens: 2000,
      temperature: 0.8,
      messages: [{ role: 'user', content: titlePrompt }]
    });

    const content = titlesResponse.content[0];
    if (content.type !== 'text') {
      throw new Error('Unexpected response type from Claude');
    }

    let titles: TitleVariation[];
    try {
      const jsonMatch = content.text.match(/\[[\s\S]*\]/);
      if (!jsonMatch) throw new Error('No JSON array found in response');
      titles = JSON.parse(jsonMatch[0]);
    } catch (parseError) {
      console.error('Failed to parse Claude response:', content.text);
      throw new Error('Failed to parse generated titles');
    }

    // Sort by expected CTR (high first)
    const ctrOrder = { 'high': 3, 'medium': 2, 'low': 1 };
    titles.sort((a, b) => 
      (ctrOrder[b.expected_ctr as keyof typeof ctrOrder] || 0) - 
      (ctrOrder[a.expected_ctr as keyof typeof ctrOrder] || 0)
    );

    const processingTime = Date.now() - startTime;
    console.log(`✅ Generated ${titles.length} title variations in ${processingTime}ms`);

    return NextResponse.json({
      titles: titles.slice(0, 6), // Ensure we return max 6
      topic_concept: topic.concept,
      channel_name: channel_style.channel_name,
      processing_time_ms: processingTime
    });

  } catch (error) {
    console.error('❌ Title generation failed:', error);
    
    return NextResponse.json(
      { 
        error: 'Failed to generate titles',
        details: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  }
}