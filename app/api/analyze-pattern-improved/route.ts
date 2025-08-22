import { NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { getSupabase } from '@/lib/supabase-lazy';

// Initialize clients

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY!,
});

async function getBase64Image(url: string): Promise<string | null> {
  try {
    const response = await fetch(url);
    const buffer = await response.arrayBuffer();
    const base64 = Buffer.from(buffer).toString('base64');
    return base64;
  } catch (error) {
    console.error('Error fetching image:', error);
    return null;
  }
}

export async function POST(request: NextRequest) {
  const startTime = Date.now();
  
  try {
    const { video_id } = await request.json();
    
    if (!video_id) {
      return NextResponse.json({ error: 'video_id is required' }, { status: 400 });
    }

    console.log(`\n🧪 TESTING IMPROVED PROMPT for video: ${video_id}`);
    console.log('============================================================');

    // Step 1: Get target video data
    const { data: targetVideo, error: videoError } = await supabase
      .from('videos')
      .select('*')
      .eq('id', video_id)
      .single();

    if (videoError || !targetVideo) {
      return NextResponse.json({ error: 'Video not found' }, { status: 404 });
    }

    // Step 2: Get 10 recent baseline videos from same channel
    const { data: baselineVideos, error: baselineError } = await supabase
      .from('videos')
      .select('id, title, view_count, temporal_performance_score, published_at')
      .eq('channel_id', targetVideo.channel_id)
      .neq('id', video_id)
      .order('published_at', { ascending: false })
      .limit(10);

    if (baselineError) {
      console.error('Error fetching baseline videos:', baselineError);
      return NextResponse.json({ error: 'Failed to fetch baseline videos' }, { status: 500 });
    }

    console.log(`📊 Found ${baselineVideos?.length || 0} baseline videos for comparison`);

    // Step 3: Get thumbnail as base64
    const thumbnailBase64 = await getBase64Image(targetVideo.thumbnail_url);
    
    if (!thumbnailBase64) {
      return NextResponse.json({ error: 'Failed to fetch thumbnail' }, { status: 500 });
    }

    // Step 4: Create improved prompt with vision best practices
    const improvedPrompt = `You are a YouTube performance analyst examining why one video dramatically outperformed a channel's baseline using systematic visual analysis.

CONTEXT:
- Channel: ${targetVideo.channel_name} (Technical content)
- Typical performance: ${baselineVideos?.map(v => Math.round((v.view_count / (targetVideo.channel_baseline_at_publish || 10000)) * 10) / 10 + 'x').join(', ') || 'N/A'} 
- Target breakthrough: ${targetVideo.view_count?.toLocaleString()} views (${targetVideo.temporal_performance_score?.toFixed(1)}x multiplier)
- Audience: Technical practitioners seeking reliable solutions

TARGET VIDEO:
Title: "${targetVideo.title}"
Performance: ${targetVideo.temporal_performance_score?.toFixed(1)}x normal performance

BASELINE COMPARISON (last 10 videos):
${baselineVideos?.map((v, i) => `${i + 1}. "${v.title}" - ${v.view_count?.toLocaleString()} views (${((v.temporal_performance_score || 1)).toFixed(1)}x)`).join('\n') || 'No baseline data'}

SYSTEMATIC ANALYSIS FRAMEWORK:
Using chain of thought reasoning, analyze the thumbnail step-by-step:

Step 1: VISUAL INVENTORY
Examine the thumbnail's color psychology, typography choices, composition elements, visual hierarchy, and emotional triggers systematically.

Step 2: BASELINE DIFFERENTIATION  
Compare against the channel's normal content patterns. What visual elements break from their typical format or style?

Step 3: PSYCHOLOGICAL MECHANISM
Explain the specific psychological principle that makes viewers more likely to click this thumbnail over similar technical content.

Step 4: PATTERN FORMULATION
Synthesize findings into a replicable pattern with clear success factors.

OUTPUT FORMAT:
{
  "step_1_visual_inventory": {
    "colors": "Primary colors and their psychological impact",
    "typography": "Text style, size, placement analysis", 
    "composition": "Layout and visual hierarchy description",
    "focal_points": "What draws the eye first, second, third"
  },
  "step_2_baseline_differentiation": "How this thumbnail breaks from channel norms",
  "step_3_psychological_mechanism": "Why this specific combination triggers more clicks",
  "step_4_pattern_formulation": {
    "pattern_name": "Memorable 2-4 word pattern name",
    "pattern_description": "One clear sentence explaining the core principle",
    "success_factors": ["Factor 1", "Factor 2", "Factor 3"],
    "replication_strategy": "How to apply this pattern to similar technical content"
  },
  "confidence_level": "High/Medium/Low with brief justification",
  "channel_specific_insight": "Why this worked for THIS channel specifically"
}

VERIFICATION CHECK:
After analysis, confirm your visual observations are actually present in the thumbnail and align with established click-psychology principles.`;

    // Step 5: Call Claude with improved structure (image first)
    const extractionStartTime = Date.now();
    
    const response = await anthropic.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 1000,
      temperature: 0.7,
      messages: [{
        role: "user",
        content: [
          // IMAGE FIRST (vision best practice)
          {
            type: "image",
            source: {
              type: "base64",
              media_type: "image/jpeg",
              data: thumbnailBase64
            }
          },
          // THEN TEXT
          {
            type: "text",
            text: improvedPrompt
          }
        ]
      }]
    });

    const extractionTime = Date.now() - extractionStartTime;
    const totalTime = Date.now() - startTime;

    // Step 6: Parse response
    let parsedResponse;
    try {
      const responseText = response.content[0].text;
      // Handle potential code block wrapping
      const jsonMatch = responseText.match(/```json\s*([\s\S]*?)\s*```/) || responseText.match(/(\{[\s\S]*\})/);
      if (jsonMatch) {
        parsedResponse = JSON.parse(jsonMatch[1]);
      } else {
        throw new Error('No valid JSON found in response');
      }
    } catch (parseError) {
      console.error('Failed to parse Claude response:', parseError);
      parsedResponse = {
        raw_response: response.content[0].text,
        parse_error: parseError.message
      };
    }

    // Step 7: Calculate costs
    const inputCost = response.usage.input_tokens * 15 / 1000000; // $15 per 1M input tokens
    const outputCost = response.usage.output_tokens * 75 / 1000000; // $75 per 1M output tokens
    const totalCost = inputCost + outputCost;

    console.log(`⏱️ Extraction completed in ${extractionTime}ms`);
    console.log(`💰 Cost: $${totalCost.toFixed(6)}`);
    console.log(`📝 Tokens: ${response.usage.input_tokens} input, ${response.usage.output_tokens} output`);

    return NextResponse.json({
      approach: "improved_vision_optimized",
      video_id,
      target_video: {
        title: targetVideo.title,
        views: targetVideo.view_count,
        performance_score: targetVideo.temporal_performance_score,
        thumbnail_url: targetVideo.thumbnail_url
      },
      baseline_videos_count: baselineVideos?.length || 0,
      analysis: parsedResponse,
      performance: {
        extraction_time_ms: extractionTime,
        total_time_ms: totalTime,
        tokens: response.usage,
        cost: {
          input: inputCost,
          output: outputCost,
          total: totalCost
        }
      },
      improvements_applied: [
        "Image-first structure (Claude vision best practice)",
        "Chain of thought reasoning (4 systematic steps)",
        "Channel-specific context (10 baseline videos)",
        "Structured analysis framework",
        "Built-in verification step",
        "Actionable output format"
      ]
    });

  } catch (error) {
    console.error('Error in improved pattern analysis:', error);
    return NextResponse.json(
      { error: 'Failed to analyze pattern', details: error.message },
      { status: 500 }
    );
  }
}