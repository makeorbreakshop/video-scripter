/**
 * Generate Hook Variations API
 * Creates multiple opening hook variations for a video concept with full context
 */

import { NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';

interface HookIterationRequest {
  concept_id: string;
  original_concept: {
    title: string;
    thumbnail_text: string;
    thumbnail_visual: string;
    hook: string;
    content_outline: string[];
    confidence: number;
    why_it_works: string;
    production_tip?: string;
  };
  frame_context: {
    frame_name: string;
    multi_modal_evidence: {
      title_pattern: string;
      thumbnail_pattern: string;
      content_pattern: string;
    };
  };
  user_concept: {
    core_problem: string;
    psychological_need: string;
    status_shift: string;
  };
  previous_variations: Array<{
    text: string;
    type?: string;
  }>;
}

export async function POST(request: NextRequest) {
  try {
    const {
      concept_id,
      original_concept,
      frame_context,
      user_concept,
      previous_variations
    }: HookIterationRequest = await request.json();

    console.log('🎬 Generating hook variations for concept:', concept_id);
    console.log('📝 Previous variations:', previous_variations.length);

    const hookPrompt = `
You are generating NEW opening hook variations for a YouTube video. The hook is the first 5-10 seconds that must grab attention immediately.

# CORE CONCEPT:
Core Problem: ${user_concept.core_problem}
Psychological Need: ${user_concept.psychological_need}
Status Shift: ${user_concept.status_shift}

# PATTERN BEING USED: "${frame_context.frame_name}"
Content Pattern: ${frame_context.multi_modal_evidence.content_pattern}

# CURRENT CONCEPT:
Title: ${original_concept.title}
Original Hook: ${original_concept.hook}
Content Flow: ${original_concept.content_outline[0] || 'Opening section'}

# PREVIOUS HOOKS TO AVOID REPEATING:
${previous_variations.map((v, i) => `${i + 1}. "${v.text}" (${v.type || 'unknown'})`).join('\n')}

# YOUR TASK:
Generate 5 NEW hook variations that:
1. Create immediate curiosity or emotional response
2. Stay focused on the same core concept and problem
3. Don't repeat any previous variations
4. Are 5-10 seconds when spoken (roughly 15-30 words)
5. Test different hook types while maintaining the pattern

Hook types to try:
- Pattern Interrupt: Start with something unexpected
- Bold Claim: Make a controversial or surprising statement
- Question: Ask something the viewer wants answered
- Story Start: Begin mid-action in a story
- Transformation Promise: Show the before/after possibility

Return ONLY valid JSON:
{
  "new_variations": [
    {
      "id": "unique_id",
      "text": "The hook text (5-10 seconds when spoken)",
      "type": "pattern_interrupt|bold_claim|question|story_start|transformation_promise",
      "emotional_trigger": "curiosity|fear|excitement|surprise|hope",
      "created_at": "ISO timestamp"
    }
  ],
  "rationale": "Brief explanation of the hook strategy used"
}
`;

    console.log('🤖 Calling Claude Sonnet 4 for hook variations...');
    
    const anthropic = new Anthropic({
      apiKey: process.env.ANTHROPIC_API_KEY!,
    });

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 2000,
      temperature: 0.9, // Higher for more creative variations
      messages: [
        {
          role: 'user',
          content: hookPrompt
        }
      ]
    });

    // Parse response
    const textContent = response.content.find(block => block.type === 'text');
    if (!textContent || textContent.type !== 'text') {
      throw new Error('No text content in response');
    }

    const responseText = textContent.text;
    const jsonMatch = responseText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error('No JSON found in response');
    }

    const result = JSON.parse(jsonMatch[0]);

    // Add unique IDs and timestamps if not provided
    result.new_variations = result.new_variations.map((v: any, i: number) => ({
      ...v,
      id: v.id || `hook-${Date.now()}-${i}`,
      created_at: v.created_at || new Date().toISOString()
    }));

    console.log('✅ Generated', result.new_variations.length, 'hook variations');

    // Log token usage
    if (response.usage) {
      const cost = (response.usage.input_tokens / 1_000_000 * 15) + 
                   (response.usage.output_tokens / 1_000_000 * 75);
      console.log('💰 Cost: $' + cost.toFixed(4));
    }

    return NextResponse.json({
      success: true,
      new_variations: result.new_variations,
      rationale: result.rationale
    });

  } catch (error) {
    console.error('❌ Hook iteration failed:', error);
    return NextResponse.json(
      { 
        success: false, 
        error: 'Failed to generate hook variations',
        details: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  }
}