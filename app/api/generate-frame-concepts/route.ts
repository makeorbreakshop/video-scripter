/**
 * Generate Video Concepts for a Single Frame
 * Creates specific video concepts from one discovered frame/pattern
 */

import { NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';

interface FrameConceptRequest {
  frame: {
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
    your_channel_fit: 'proven' | 'untested' | 'gap';
    recommendation: 'leverage_strength' | 'fill_gap' | 'improve_existing';
    example_videos: string[];
  };
  frame_index: number;
  user_concept: {
    core_problem: string;
    psychological_need: string;
    status_shift: string;
  };
  transcript?: string; // Original transcript for deeper context
  user_channel?: {
    channel_id: string;
    channel_name: string;
    has_analysis: boolean;
  };
  all_frames_summary?: string; // Strategic context from all frames
  example_thumbnails?: Array<{
    title: string;
    thumbnail_url: string;
    view_count: number;
    performance_score: number;
  }>; // Visual examples for pattern analysis
}

export async function POST(request: NextRequest) {
  try {
    const { 
      frame, 
      user_concept, 
      transcript,
      user_channel,
      all_frames_summary,
      example_thumbnails 
    }: FrameConceptRequest = await request.json();
    
    console.log('🎬 Generating concepts for frame:', frame.frame_name);
    console.log('📊 Frame fit:', frame.your_channel_fit, '| Recommendation:', frame.recommendation);
    console.log('🖼️ Example thumbnails provided:', example_thumbnails?.length || 0);

    // Create focused prompt for single frame
    // Limit transcript to 3000 chars (roughly 750 tokens) to save costs while keeping context
    const transcriptForPrompt = transcript ? 
      (transcript.length > 3000 ? transcript.substring(0, 3000) + '...' : transcript) : '';
    
    const conceptGenerationPrompt = `
You are generating specific video concepts for a YouTube channel based on ONE proven pattern.

# THE ORIGINAL VIDEO IDEA (THIS IS WHAT THE VIDEO CONCEPTS MUST BE ABOUT):
${transcriptForPrompt ? `
Core Content/Idea: 
"${transcriptForPrompt}"

This is the actual content the user wants to create videos about. ALL generated concepts MUST be about THIS TOPIC, not generic examples.
` : 'No transcript provided'}

Core Problem to Solve: ${user_concept.core_problem}
Psychological Need: ${user_concept.psychological_need}
Status Shift: ${user_concept.status_shift}

# THE PATTERN TO USE: "${frame.frame_name}"
- Proven Success: ${frame.frequency} videos, ${Math.round(frame.confidence_score * 100)}% confidence
- Title Pattern: ${frame.multi_modal_evidence.title_pattern}
- Thumbnail Pattern: ${frame.multi_modal_evidence.thumbnail_pattern}
- Content Pattern: ${frame.multi_modal_evidence.content_pattern}

# YOUR CHANNEL CONTEXT:
${user_channel ? `Channel: ${user_channel.channel_name}` : 'No channel selected'}
Pattern Fit: ${frame.your_channel_fit === 'proven' ? 'You already use this successfully!' : 
             frame.your_channel_fit === 'gap' ? 'This is a gap/opportunity for you' : 
             'You haven\'t tested this pattern yet'}
Recommendation: ${frame.recommendation}

# ADAPTATION STRATEGY:
${frame.application_to_your_concept.adaptation_strategy}

Specific tactics:
${frame.application_to_your_concept.specific_recommendations.map((r, i) => `${i+1}. ${r}`).join('\n')}

# EXAMPLE VIDEOS USING THIS PATTERN:
${frame.example_videos.slice(0, 3).map((v, i) => `${i+1}. "${v}"`).join('\n')}

# YOUR TASK:
Generate 3-5 SPECIFIC video concepts that:
1. MUST BE ABOUT THE TRANSCRIPT TOPIC ABOVE - not generic tool/skill examples
2. Apply THIS exact pattern to the user's ACTUAL content from the transcript
3. Feel native to YouTube (not forced or academic)
4. ${frame.your_channel_fit === 'proven' ? 'Build on what already works for this channel' : 'Introduce this new approach naturally'}
5. Use the specific ideas, examples, and content from the transcript
6. Can be filmed/produced realistically

Return ONLY valid JSON (no markdown, no explanations before or after):
{
  "pattern_name": "${frame.frame_name}",
  "concepts": [
    {
      "title": "YouTube-optimized title under 60 chars",
      "thumbnail_text": "Exact text overlay for thumbnail",
      "thumbnail_visual": "Visual composition description",
      "hook": "First 5-10 seconds script that creates curiosity",
      "content_outline": [
        "0:00-0:30 - Opening section",
        "0:30-3:00 - Main content section",
        "3:00-5:00 - Examples/demonstration",
        "5:00-6:00 - Closing and CTA"
      ],
      "confidence": 0.0-1.0,
      "why_it_works": "Brief explanation of pattern match",
      "production_tip": "Specific filming/editing advice"
    }
  ],
  "batch_strategy": "How to release these as a series",
  "quick_win": 1  // Number 1-based index of which concept to make first (e.g., 1 for first concept)
}

Create concepts that feel like they naturally belong on YouTube, not academic translations.
`;

    console.log('🤖 Calling Claude Sonnet 4 for focused concept generation...');
    
    const anthropic = new Anthropic({
      apiKey: process.env.ANTHROPIC_API_KEY!,
    });

    // Build content array with text and images
    const messageContent: any[] = [
      {
        type: 'text',
        text: conceptGenerationPrompt
      }
    ];

    // Add thumbnail images if available
    if (example_thumbnails && example_thumbnails.length > 0) {
      messageContent.push({
        type: 'text',
        text: '\n\n# VISUAL EXAMPLES:\nHere are actual thumbnails from videos using this pattern. Analyze their visual composition, text placement, colors, and style:'
      });

      for (const thumb of example_thumbnails) {
        try {
          // Fetch image and convert to base64
          const imageResponse = await fetch(thumb.thumbnail_url);
          const arrayBuffer = await imageResponse.arrayBuffer();
          const base64 = Buffer.from(arrayBuffer).toString('base64');
          const mimeType = imageResponse.headers.get('content-type') || 'image/jpeg';
          
          messageContent.push({
            type: 'image',
            source: {
              type: 'base64',
              media_type: mimeType,
              data: base64
            }
          });
          
          messageContent.push({
            type: 'text',
            text: `Title: "${thumb.title}" (${thumb.view_count.toLocaleString()} views, ${thumb.performance_score}x baseline)`
          });
        } catch (error) {
          console.warn('Failed to fetch thumbnail:', thumb.thumbnail_url, error);
        }
      }

      messageContent.push({
        type: 'text',
        text: 'Use these visual examples to inform your thumbnail recommendations, but adapt them to the user\'s specific concept.'
      });
    }

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 8000, // Must be greater than thinking budget
      // temperature cannot be set when using extended thinking
      thinking: {
        type: "enabled",
        budget_tokens: 4000 // Thinking budget for creative generation
      },
      messages: [
        {
          role: 'user',
          content: messageContent
        }
      ]
    });

    // Parse response - filter out thinking blocks, only get text
    const textBlocks = response.content.filter(block => block.type === 'text');
    const thinkingBlocks = response.content.filter(block => block.type === 'thinking');
    
    if (thinkingBlocks.length > 0) {
      console.log('🧠 Thinking blocks received:', thinkingBlocks.length);
    }
    
    if (!textBlocks.length) {
      throw new Error('No text content in response');
    }

    const responseText = textBlocks[0].text;
    const jsonMatch = responseText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error('No JSON found in response');
    }

    const generatedConcepts = JSON.parse(jsonMatch[0]);

    console.log('✅ Generated', generatedConcepts.concepts?.length || 0, 'concepts');
    console.log('🎯 Quick win:', generatedConcepts.quick_win);

    // Log token usage
    if (response.usage) {
      const cost = (response.usage.input_tokens / 1_000_000 * 15) + 
                   (response.usage.output_tokens / 1_000_000 * 75) +
                   (4000 / 1_000_000 * 75); // thinking tokens
      console.log('💰 Cost: $' + cost.toFixed(4));
    }

    return NextResponse.json({
      success: true,
      concepts: generatedConcepts,
      metadata: {
        frame_name: frame.frame_name,
        channel_fit: frame.your_channel_fit,
        total_concepts: generatedConcepts.concepts?.length || 0
      }
    });

  } catch (error) {
    console.error('❌ Frame concept generation failed:', error);
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