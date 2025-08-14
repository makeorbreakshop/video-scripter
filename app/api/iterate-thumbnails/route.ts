/**
 * Generate Thumbnail Variations API
 * Creates multiple thumbnail text and visual variations for a video concept with full context
 */

import { NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';

interface ThumbnailIterationRequest {
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
    application_to_your_concept: {
      adaptation_strategy: string;
      specific_recommendations: string[];
    };
  };
  user_concept: {
    core_problem: string;
    psychological_need: string;
    status_shift: string;
  };
  previous_variations: Array<{
    text_overlay: string;
    visual_description: string;
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
    }: ThumbnailIterationRequest = await request.json();

    console.log('🎬 Generating thumbnail variations for concept:', concept_id);
    console.log('📝 Previous variations:', previous_variations.length);

    const thumbnailPrompt = `
You are generating NEW thumbnail variations for a YouTube video. The thumbnail must work with the title to create an irresistible click.

# CORE CONCEPT:
Core Problem: ${user_concept.core_problem}
Psychological Need: ${user_concept.psychological_need}
Status Shift: ${user_concept.status_shift}

# PATTERN BEING USED: "${frame_context.frame_name}"
Thumbnail Pattern: ${frame_context.multi_modal_evidence.thumbnail_pattern}
Title Pattern: ${frame_context.multi_modal_evidence.title_pattern}

# CURRENT CONCEPT:
Title: ${original_concept.title}
Original Thumbnail Text: ${original_concept.thumbnail_text}
Original Visual: ${original_concept.thumbnail_visual}

# PREVIOUS THUMBNAILS TO AVOID REPEATING:
${previous_variations.map((v, i) => `${i + 1}. Text: "${v.text_overlay}" | Visual: "${v.visual_description}"`).join('\n')}

# YOUR TASK:
Generate 5 NEW thumbnail variations that:
1. Create visual curiosity that complements the title
2. Stay focused on the same core concept and transformation
3. Don't repeat any previous variations
4. Use bold, readable text (3-5 words max)
5. Test different visual styles while maintaining the pattern

Thumbnail styles to try:
- Minimal: Clean, lots of white space, 1-2 elements
- Busy: Multiple elements, arrows, highlights
- Face Reaction: Close-up face with expression
- Text Heavy: Large text dominates the frame
- Split Screen: Before/after or comparison
- Object Focus: Hero object or tool prominently featured

Return ONLY valid JSON:
{
  "new_variations": [
    {
      "id": "unique_id",
      "text_overlay": "3-5 word text overlay",
      "visual_description": "Detailed description of visual composition",
      "style": "minimal|busy|face_reaction|text_heavy|split_screen|object_focus",
      "color_scheme": "Description of main colors",
      "psychological_hook": "What makes someone want to click",
      "created_at": "ISO timestamp"
    }
  ],
  "rationale": "Brief explanation of the thumbnail strategy used"
}
`;

    console.log('🤖 Calling Claude Sonnet 4 for thumbnail variations...');
    
    const anthropic = new Anthropic({
      apiKey: process.env.ANTHROPIC_API_KEY!,
    });

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 2500,
      temperature: 0.9, // Higher for more creative variations
      messages: [
        {
          role: 'user',
          content: thumbnailPrompt
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
      id: v.id || `thumb-${Date.now()}-${i}`,
      created_at: v.created_at || new Date().toISOString()
    }));

    console.log('✅ Generated', result.new_variations.length, 'thumbnail variations');

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
    console.error('❌ Thumbnail iteration failed:', error);
    return NextResponse.json(
      { 
        success: false, 
        error: 'Failed to generate thumbnail variations',
        details: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  }
}