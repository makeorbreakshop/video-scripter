/**
 * Expand Topic API - Generates titles and thumbnail descriptions for a topic
 * POST /api/expand-topic
 */

import { NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';

interface ExpandTopicRequest {
  topic: {
    id: string;
    topic: string;
    angle: string;
    why_this_works: string;
  };
  pattern: {
    pattern_name: string;
    psychological_trigger: string;
  };
  target_niche: string;
}

interface ExpandedContent {
  titles: {
    title: string;
    style: string; // e.g., "curiosity", "challenge", "comparison"
    confidence: number;
  }[];
  thumbnails: {
    main_text: string;
    supporting_text?: string;
    visual_elements: string[];
    emotion: string;
    color_scheme: string;
  }[];
  hooks: {
    hook: string;
    duration: string; // e.g., "5-10 seconds"
  }[];
}

export async function POST(request: NextRequest) {
  const startTime = Date.now();
  
  try {
    const body: ExpandTopicRequest = await request.json();
    const { topic, pattern, target_niche } = body;

    if (!topic || !pattern || !target_niche) {
      return NextResponse.json(
        { error: 'topic, pattern, and target_niche are required' },
        { status: 400 }
      );
    }

    console.log(`🎨 Expanding topic: ${topic.topic}`);

    // Initialize Claude
    const anthropic = new Anthropic({
      apiKey: process.env.ANTHROPIC_API_KEY!,
    });

    const prompt = `You are a YouTube optimization expert creating titles, thumbnails, and hooks.

TOPIC TO EXPAND:
Topic: ${topic.topic}
Angle: ${topic.angle}
Why it works: ${topic.why_this_works}

PATTERN TO USE:
${pattern.pattern_name} (${pattern.psychological_trigger})

TARGET NICHE: ${target_niche}

Create multiple options for titles, thumbnail text, and opening hooks that:
1. Apply the successful pattern
2. Feel native to ${target_niche}
3. Create irresistible curiosity
4. Are specific and concrete (not generic)

Return a JSON object:
{
  "titles": [
    {
      "title": "The actual title (50-60 chars ideal)",
      "style": "curiosity" | "challenge" | "comparison" | "revelation" | "transformation",
      "confidence": 0.0-1.0
    }
  ],
  "thumbnails": [
    {
      "main_text": "BIG TEXT for thumbnail",
      "supporting_text": "smaller supporting text (optional)",
      "visual_elements": ["what to show", "key props", "facial expression"],
      "emotion": "shocked" | "excited" | "confused" | "determined" | "amazed",
      "color_scheme": "high contrast red/white" | "yellow/black" | "blue/orange" | etc
    }
  ],
  "hooks": [
    {
      "hook": "The opening line(s) to speak",
      "duration": "5-10 seconds"
    }
  ]
}

Generate 5 titles, 3 thumbnail options, and 3 hooks.`;

    const response = await anthropic.messages.create({
      model: 'claude-3-5-sonnet-20241022',
      max_tokens: 2000,
      temperature: 0.8,
      messages: [{ role: 'user', content: prompt }]
    });

    const content = response.content[0];
    if (content.type !== 'text') {
      throw new Error('Unexpected response type from Claude');
    }

    let expanded: ExpandedContent;
    try {
      const jsonMatch = content.text.match(/\{[\s\S]*\}/);
      if (!jsonMatch) throw new Error('No JSON found in response');
      expanded = JSON.parse(jsonMatch[0]);
    } catch (parseError) {
      console.error('Failed to parse Claude response:', content.text);
      throw new Error('Failed to parse expanded content');
    }

    // Sort titles by confidence
    expanded.titles.sort((a, b) => b.confidence - a.confidence);

    const processingTime = Date.now() - startTime;
    console.log(`✅ Expanded topic with ${expanded.titles.length} titles in ${processingTime}ms`);

    return NextResponse.json({
      topic_id: topic.id,
      topic_description: topic.topic,
      expanded,
      processing_time_ms: processingTime
    });

  } catch (error) {
    console.error('❌ Topic expansion failed:', error);
    
    return NextResponse.json(
      { 
        error: 'Failed to expand topic',
        details: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  }
}