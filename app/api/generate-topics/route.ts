/**
 * Generate Topics API - Creates topic ideas based on validated patterns
 * POST /api/generate-topics
 */

import { NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';

interface GenerateTopicsRequest {
  pattern: {
    pattern_name: string;
    pattern_description: string;
    psychological_trigger: string;
    why_it_works: string;
  };
  source_video: {
    title: string;
    niche: string;
  };
  target_niche: string;
  validation_examples?: {
    niche: string;
    avg_score: number;
    example_titles: string[];
  }[];
}

interface TopicIdea {
  id: string;
  topic: string;
  angle: string;
  why_this_works: string;
  difficulty: 'easy' | 'medium' | 'hard';
  estimated_performance: number; // 1-10 score
}

export async function POST(request: NextRequest) {
  const startTime = Date.now();
  
  try {
    const body: GenerateTopicsRequest = await request.json();
    const { pattern, source_video, target_niche, validation_examples } = body;

    if (!pattern || !target_niche) {
      return NextResponse.json(
        { error: 'pattern and target_niche are required' },
        { status: 400 }
      );
    }

    console.log(`🎯 Generating topics for ${target_niche} using pattern: ${pattern.pattern_name}`);

    // Initialize Claude
    const anthropic = new Anthropic({
      apiKey: process.env.ANTHROPIC_API_KEY!,
    });

    // Build validation context if available
    const validationContext = validation_examples && validation_examples.length > 0
      ? `PROVEN EXAMPLES OF THIS PATTERN:
${validation_examples.map(ex => 
  `${ex.niche} (${ex.avg_score.toFixed(1)}x avg):\n${ex.example_titles.slice(0, 3).map(t => `  - "${t}"`).join('\n')}`
).join('\n\n')}`
      : '';

    const prompt = `You are a YouTube content strategist helping creators find winning video topics.

SUCCESSFUL PATTERN:
Name: ${pattern.pattern_name}
Description: ${pattern.pattern_description}
Psychology: ${pattern.psychological_trigger}
Why it works: ${pattern.why_it_works}

ORIGINAL VIDEO:
"${source_video.title}" (${source_video.niche})

${validationContext}

TARGET NICHE: ${target_niche}

Generate 8-10 specific video topic ideas for ${target_niche} that use this pattern. Each topic should be:
1. Specific and actionable (not vague)
2. Native to ${target_niche} (use appropriate terminology)
3. Something a creator could actually film
4. Leveraging the core pattern effectively

Return a JSON array of topics:
[
  {
    "id": "unique_id",
    "topic": "The specific video topic/concept",
    "angle": "The unique angle or hook that uses the pattern",
    "why_this_works": "Brief explanation of why this applies the pattern well",
    "difficulty": "easy" | "medium" | "hard",
    "estimated_performance": 1-10
  }
]

Order by estimated performance (highest first).`;

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

    let topics: TopicIdea[];
    try {
      const jsonMatch = content.text.match(/\[[\s\S]*\]/);
      if (!jsonMatch) throw new Error('No JSON array found in response');
      topics = JSON.parse(jsonMatch[0]);
      
      // Add unique IDs if not present
      topics = topics.map((topic, i) => ({
        ...topic,
        id: topic.id || `topic_${Date.now()}_${i}`
      }));
    } catch (parseError) {
      console.error('Failed to parse Claude response:', content.text);
      throw new Error('Failed to parse topics');
    }

    const processingTime = Date.now() - startTime;
    console.log(`✅ Generated ${topics.length} topics in ${processingTime}ms`);

    return NextResponse.json({
      topics,
      pattern_used: pattern.pattern_name,
      target_niche,
      processing_time_ms: processingTime
    });

  } catch (error) {
    console.error('❌ Topic generation failed:', error);
    
    return NextResponse.json(
      { 
        error: 'Failed to generate topics',
        details: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  }
}