/**
 * Generate Title Variations API
 * Creates multiple title variations for a video concept with full context
 */

import { NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';

interface TitleIterationRequest {
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
    score?: number;
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
    }: TitleIterationRequest = await request.json();

    console.log('🎬 Generating title variations for concept:', concept_id);
    console.log('📝 Previous variations:', previous_variations.length);

    const titlePrompt = `
You are generating NEW title variations for a YouTube video concept. 

# CORE CONCEPT:
Core Problem: ${user_concept.core_problem}
Psychological Need: ${user_concept.psychological_need}
Status Shift: ${user_concept.status_shift}

# PATTERN BEING USED: "${frame_context.frame_name}"
Title Pattern: ${frame_context.multi_modal_evidence.title_pattern}

# CURRENT CONCEPT:
Title: ${original_concept.title}
Hook: ${original_concept.hook}
Why It Works: ${original_concept.why_it_works}

# PREVIOUS VARIATIONS TO AVOID REPEATING:
${previous_variations.map((v, i) => `${i + 1}. "${v.text}"`).join('\n')}

# YOUR TASK:
Generate 5 NEW title variations that:
1. Stay true to the original pattern "${frame_context.frame_name}"
2. Maintain the same core concept and problem being solved
3. Don't repeat any previous variations
4. Are under 60 characters for YouTube optimization
5. Test different psychological triggers while maintaining the pattern

Return ONLY valid JSON:
{
  "new_variations": [
    {
      "id": "unique_id",
      "text": "Title under 60 chars",
      "score": 8.5,
      "psychological_trigger": "curiosity|fear|transformation|controversy|authority",
      "created_at": "ISO timestamp"
    }
  ],
  "rationale": "Brief explanation of the variation strategy used"
}
`;

    console.log('🤖 Calling Claude Sonnet 4 for title variations...');
    
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
          content: titlePrompt
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
      id: v.id || `title-${Date.now()}-${i}`,
      created_at: v.created_at || new Date().toISOString()
    }));

    console.log('✅ Generated', result.new_variations.length, 'title variations');

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
    console.error('❌ Title iteration failed:', error);
    return NextResponse.json(
      { 
        success: false, 
        error: 'Failed to generate title variations',
        details: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  }
}