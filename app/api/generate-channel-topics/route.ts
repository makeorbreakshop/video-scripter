/**
 * Channel-Specific Topic Generation API
 * POST /api/generate-channel-topics
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import Anthropic from '@anthropic-ai/sdk';

interface GenerateRequest {
  pattern: {
    pattern_name: string;
    pattern_description: string;
    psychological_trigger: string;
    key_elements: string[];
    why_it_works: string;
  };
  channel_style: {
    channel_name: string;
    channel_id: string;
    title_patterns: string[];
    content_themes: string[];
    unique_voice: string;
    success_factors: string[];
    typical_hooks: string[];
    baseline_performance: number;
    top_performer_avg: number;
  };
}

interface ChannelTopic {
  concept: string;
  description: string;
  reasoning: string;
  channel_fit_score: number;
  similar_successes: string[];
  estimated_performance: string;
  implementation_notes: string;
  angle: string;
}

export async function POST(request: NextRequest) {
  const startTime = Date.now();
  
  try {
    const { pattern, channel_style }: GenerateRequest = await request.json();

    if (!pattern || !channel_style) {
      return NextResponse.json(
        { error: 'pattern and channel_style are required' },
        { status: 400 }
      );
    }

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    console.log(`🎯 Generating topics for ${channel_style.channel_name} using pattern: ${pattern.pattern_name}`);

    // Get some recent high performers from this channel for context
    const { data: channelHits } = await supabase
      .from('videos')
      .select('title, temporal_performance_score')
      .eq('channel_id', channel_style.channel_id)
      .gte('temporal_performance_score', 3.0)
      .order('published_at', { ascending: false })
      .limit(5);

    // Generate topics using Claude
    const anthropic = new Anthropic({
      apiKey: process.env.ANTHROPIC_API_KEY!,
    });

    const generationPrompt = `You are helping ${channel_style.channel_name} adapt a proven viral pattern to their specific channel style and audience.

VIRAL PATTERN TO ADAPT:
Name: ${pattern.pattern_name}
Description: ${pattern.pattern_description}
Psychological Trigger: ${pattern.psychological_trigger}
Key Elements: ${pattern.key_elements.join(', ')}
Why It Works: ${pattern.why_it_works}

CHANNEL STYLE ANALYSIS:
Channel: ${channel_style.channel_name}
Title Patterns They Use: ${channel_style.title_patterns.join(', ')}
Content Themes: ${channel_style.content_themes.join(', ')}
Unique Voice: ${channel_style.unique_voice}
Success Factors: ${channel_style.success_factors.join(', ')}
Typical Hooks: ${channel_style.typical_hooks.join(', ')}
Average Top Performer: ${channel_style.top_performer_avg.toFixed(1)}x baseline

RECENT HITS FROM THIS CHANNEL:
${(channelHits || []).map((v, i) => 
  `${i + 1}. "${v.title}" (${v.temporal_performance_score.toFixed(1)}x)`
).join('\n')}

Generate 8 video topic CONCEPTS (not titles) that:
1. Apply the viral pattern to this channel's specific niche
2. Match their established voice and style
3. Build on their proven success factors
4. Feel authentic to their audience

For each topic concept, provide:
- A short concept name (2-5 words, like "woodworking glue science")
- A brief description of what the video would cover
- The specific angle that makes it interesting
- WHY it works for THIS specific channel
- Which past videos it's similar to

Return as JSON array:
[{
  "concept": "Short concept name (2-5 words)",
  "description": "What the video would cover (1-2 sentences)",
  "angle": "The hook or unique perspective (1 sentence)",
  "reasoning": "Why this works for THIS channel specifically",
  "channel_fit_score": 1-10,
  "similar_successes": ["List 1-2 similar videos from their channel"],
  "estimated_performance": "Expected multiplier range (e.g., '5-8x')",
  "implementation_notes": "Key tips for making this work"
}]`;

    const topicsResponse = await anthropic.messages.create({
      model: 'claude-3-5-sonnet-20241022',
      max_tokens: 3000,
      temperature: 0.8,
      messages: [{ role: 'user', content: generationPrompt }]
    });

    const content = topicsResponse.content[0];
    if (content.type !== 'text') {
      throw new Error('Unexpected response type from Claude');
    }

    let topics: ChannelTopic[];
    try {
      const jsonMatch = content.text.match(/\[[\s\S]*\]/);
      if (!jsonMatch) throw new Error('No JSON array found in response');
      topics = JSON.parse(jsonMatch[0]);
    } catch (parseError) {
      console.error('Failed to parse Claude response:', content.text);
      throw new Error('Failed to parse generated topics');
    }

    // Sort by channel fit score
    topics.sort((a, b) => b.channel_fit_score - a.channel_fit_score);

    const processingTime = Date.now() - startTime;
    console.log(`✅ Generated ${topics.length} channel-specific topics in ${processingTime}ms`);

    return NextResponse.json({
      topics: topics.slice(0, 8), // Ensure we return max 8
      channel_context: {
        channel_name: channel_style.channel_name,
        baseline_performance: channel_style.baseline_performance,
        top_performer_avg: channel_style.top_performer_avg,
        recent_hits: channelHits?.length || 0
      },
      pattern_applied: pattern.pattern_name,
      processing_time_ms: processingTime
    });

  } catch (error) {
    console.error('❌ Topic generation failed:', error);
    
    return NextResponse.json(
      { 
        error: 'Failed to generate channel topics',
        details: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  }
}