/**
 * Generate Video Concepts API
 * Creates specific video concepts from discovered frames/patterns
 */

import { NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';

interface ConceptGenerationRequest {
  frames: Array<{
    frame_name: string;
    frequency: number;
    confidence_score: number;
    multi_modal_evidence: {
      thumbnail_pattern: string;
      title_pattern: string;
      content_pattern: string;
    };
    application_to_your_concept: {
      adaptation_strategy: string;
      specific_recommendations: string[];
      confidence: number;
    };
  }>;
  user_concept: {
    core_problem: string;
    psychological_need: string;
    status_shift: string;
  };
  user_channel?: string;
}

export async function POST(request: NextRequest) {
  try {
    const { frames, user_concept, user_channel }: ConceptGenerationRequest = await request.json();
    
    console.log('🎬 Generating video concepts from', frames.length, 'discovered frames');

    // Create prompt for concept generation
    const conceptGenerationPrompt = `
You are generating specific, actionable video concepts based on discovered successful patterns.

# USER'S CORE CONCEPT:
- Core Problem: ${user_concept.core_problem}
- Psychological Need: ${user_concept.psychological_need}  
- Status Shift: ${user_concept.status_shift}

# DISCOVERED PATTERNS TO USE:
${frames.map((frame, i) => `
Pattern ${i + 1}: "${frame.frame_name}"
- Confidence: ${Math.round(frame.confidence_score * 100)}%
- Title Pattern: ${frame.multi_modal_evidence.title_pattern}
- Thumbnail Pattern: ${frame.multi_modal_evidence.thumbnail_pattern}
- Content Pattern: ${frame.multi_modal_evidence.content_pattern}
- Application Strategy: ${frame.application_to_your_concept.adaptation_strategy}
`).join('')}

# YOUR TASK:
Generate 2-3 specific video concepts for EACH pattern above. Each concept should:

1. **Merge the pattern with the user's concept** - Don't just copy the pattern, adapt it
2. **Create YouTube-optimized titles** - Under 60 chars, high CTR, specific promise
3. **Design thumbnail strategies** - Visual approach that matches proven patterns
4. **Write opening hooks** - First 5-10 seconds that establish the transformation
5. **Outline content structure** - How to deliver using the pattern's approach
6. **Estimate performance** - Confidence score based on pattern match

Return as JSON:
{
  "generated_concepts": [
    {
      "pattern_name": "Pattern name it's based on",
      "concepts": [
        {
          "title": "Specific video title under 60 chars",
          "thumbnail": {
            "visual_approach": "Specific thumbnail design description",
            "text_overlay": "Exact text to put on thumbnail",
            "color_scheme": "Colors to use"
          },
          "hook": "Opening line that creates curiosity (5-10 seconds script)",
          "content_structure": {
            "opening": "How to start (0-30 seconds)",
            "middle": "Core content delivery approach",
            "closing": "Call to action and wrap-up"
          },
          "estimated_performance": {
            "confidence": 0.0-1.0,
            "reasoning": "Why this will work"
          },
          "production_notes": "Specific tips for filming/editing this concept"
        }
      ]
    }
  ],
  "batch_strategy": "How to release these videos as a series",
  "top_priority": "Which video to make first and why"
}

Focus on creating concepts that feel native to YouTube while solving the user's core problem.
`;

    console.log('🤖 Calling Claude Sonnet 4 for concept generation...');
    
    const anthropic = new Anthropic({
      apiKey: process.env.ANTHROPIC_API_KEY!,
    });

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 8000,
      temperature: 0.9, // Higher temp for creative generation
      thinking: {
        type: "enabled",
        budget_tokens: 3000 // Thinking for creative strategy
      },
      messages: [
        {
          role: 'user',
          content: conceptGenerationPrompt
        }
      ]
    });

    // Parse response
    const textBlocks = response.content.filter(block => block.type === 'text');
    if (!textBlocks.length) {
      throw new Error('No text content in response');
    }

    const responseText = textBlocks[0].text;
    const jsonMatch = responseText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error('No JSON found in response');
    }

    const generatedConcepts = JSON.parse(jsonMatch[0]);

    console.log('✅ Generated', generatedConcepts.generated_concepts.length, 'concept groups');
    console.log('🎯 Top priority:', generatedConcepts.top_priority);

    // Log token usage
    if (response.usage) {
      const cost = (response.usage.input_tokens / 1_000_000 * 15) + 
                   (response.usage.output_tokens / 1_000_000 * 75) +
                   (3000 / 1_000_000 * 75); // thinking tokens
      console.log('💰 Cost: $' + cost.toFixed(4));
    }

    return NextResponse.json({
      success: true,
      concepts: generatedConcepts,
      metadata: {
        patterns_used: frames.length,
        total_concepts: generatedConcepts.generated_concepts.reduce(
          (acc: number, group: any) => acc + group.concepts.length, 0
        )
      }
    });

  } catch (error) {
    console.error('❌ Concept generation failed:', error);
    return NextResponse.json(
      { 
        success: false, 
        error: 'Failed to generate concepts',
        details: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  }
}