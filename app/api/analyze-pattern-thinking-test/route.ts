import { NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { getSupabase } from '@/lib/supabase-lazy';

// Initialize clients

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY!,
});

export async function POST(request: NextRequest) {
  const startTime = Date.now();
  
  try {
    const { video_id } = await request.json();
    
    if (!video_id) {
      return NextResponse.json({ error: 'video_id is required' }, { status: 400 });
    }

    console.log(`\n🧪 EXTENDED THINKING A/B TEST - Step 1 Pattern Extraction`);
    console.log(`📺 Video: ${video_id}`);
    console.log('========================================================');

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
    console.log(`🎯 Target performance: ${targetVideo.temporal_performance_score?.toFixed(1)}x TPS`);

    // Step 3: Create systematic analysis prompt (same for all tests)
    const extractionPrompt = `You are a YouTube performance analyst examining why one video dramatically outperformed a channel's baseline using systematic visual analysis.

CONTEXT:
- Channel: ${targetVideo.channel_name}
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

    // Step 4: Run three different thinking configurations
    const tests = [
      {
        name: "Control (No Thinking)",
        config: { thinking: null },
        expectedCost: 0.066
      },
      {
        name: "Moderate Thinking (4k tokens)",
        config: { 
          thinking: {
            type: "enabled" as const,
            budget_tokens: 4000
          }
        },
        expectedCost: 0.126
      },
      {
        name: "Deep Thinking (8k tokens)",
        config: {
          thinking: {
            type: "enabled" as const,
            budget_tokens: 8000
          }
        },
        expectedCost: 0.186
      }
    ];

    const results = [];

    for (const test of tests) {
      console.log(`\n🔬 Running: ${test.name}`);
      console.log(`💰 Expected cost: $${test.expectedCost.toFixed(3)}`);
      
      const testStartTime = Date.now();

      try {
        // Create message content with IMAGE FIRST (Claude vision best practice)
        const messageContent: any[] = [];
        if (targetVideo.thumbnail_url) {
          messageContent.push({
            type: 'image',
            source: { type: 'url', url: targetVideo.thumbnail_url }
          });
        }
        messageContent.push({ type: 'text', text: extractionPrompt });

        // Build API call configuration
        const apiConfig: any = {
          model: "claude-sonnet-4-20250514", // Claude Sonnet 4 supports extended thinking
          messages: [{
            role: "user",
            content: messageContent
          }]
        };

        // Add thinking configuration if specified
        if (test.config.thinking) {
          apiConfig.thinking = test.config.thinking;
          apiConfig.temperature = 1; // Required when thinking is enabled
          // max_tokens must be greater than thinking budget_tokens
          apiConfig.max_tokens = Math.max(test.config.thinking.budget_tokens + 1500, 2000);
        } else {
          apiConfig.temperature = 0.7; // Standard temperature for non-thinking
          apiConfig.max_tokens = 1500;
        }

        const response = await anthropic.messages.create(apiConfig);
        
        const testTime = Date.now() - testStartTime;

        // Calculate costs
        const inputCost = response.usage.input_tokens * 3 / 1000000; // $3 per 1M input tokens
        const outputCost = response.usage.output_tokens * 15 / 1000000; // $15 per 1M output tokens
        const totalCost = inputCost + outputCost;

        // Parse response
        let parsedResponse;
        let thinkingContent = null;
        
        try {
          // Extract thinking content if present
          if (response.content) {
            const thinkingBlock = response.content.find(block => block.type === 'thinking');
            if (thinkingBlock && 'thinking' in thinkingBlock) {
              thinkingContent = thinkingBlock.thinking;
            }
            
            // Find text content
            const textBlock = response.content.find(block => block.type === 'text');
            if (textBlock && 'text' in textBlock) {
              const responseText = textBlock.text;
              
              // Handle potential code block wrapping
              const jsonMatch = responseText.match(/```json\s*([\s\S]*?)\s*```/) || responseText.match(/(\{[\s\S]*\})/);
              if (jsonMatch) {
                parsedResponse = JSON.parse(jsonMatch[1]);
              } else {
                throw new Error('No valid JSON found in response');
              }
            }
          }
        } catch (parseError) {
          console.error(`Failed to parse ${test.name} response:`, parseError);
          parsedResponse = {
            raw_response: response.content,
            parse_error: parseError.message
          };
        }

        console.log(`⏱️ Completed in ${testTime}ms`);
        console.log(`💰 Actual cost: $${totalCost.toFixed(6)}`);
        console.log(`📝 Tokens: ${response.usage.input_tokens} input, ${response.usage.output_tokens} output`);
        if (response.usage.thinking_tokens) {
          console.log(`🧠 Thinking tokens: ${response.usage.thinking_tokens}`);
        }

        results.push({
          test_name: test.name,
          config: test.config,
          analysis: parsedResponse,
          thinking_content: thinkingContent,
          performance: {
            execution_time_ms: testTime,
            tokens: response.usage,
            cost: {
              input: inputCost,
              output: outputCost,
              total: totalCost
            }
          },
          cost_vs_expected: {
            expected: test.expectedCost,
            actual: totalCost,
            difference_pct: ((totalCost - test.expectedCost) / test.expectedCost * 100).toFixed(1)
          }
        });

      } catch (error) {
        console.error(`❌ ${test.name} failed:`, error);
        results.push({
          test_name: test.name,
          config: test.config,
          error: error.message,
          performance: {
            execution_time_ms: Date.now() - testStartTime,
            tokens: null,
            cost: null
          }
        });
      }
    }

    const totalTime = Date.now() - startTime;

    console.log(`\n📊 All tests completed in ${totalTime}ms`);
    console.log('========================================================');

    return NextResponse.json({
      video_id,
      target_video: {
        title: targetVideo.title,
        views: targetVideo.view_count,
        performance_score: targetVideo.temporal_performance_score,
        thumbnail_url: targetVideo.thumbnail_url
      },
      baseline_videos_count: baselineVideos?.length || 0,
      test_results: results,
      total_execution_time_ms: totalTime,
      test_summary: {
        tests_completed: results.filter(r => !r.error).length,
        tests_failed: results.filter(r => r.error).length,
        total_cost: results.reduce((sum, r) => sum + (r.performance?.cost?.total || 0), 0),
        cost_analysis: results.map(r => ({
          test: r.test_name,
          cost: r.performance?.cost?.total || 0,
          vs_control: r.test_name === "Control (No Thinking)" ? "baseline" : 
                     `+${(((r.performance?.cost?.total || 0) / (results[0].performance?.cost?.total || 1) - 1) * 100).toFixed(0)}%`
        }))
      }
    });

  } catch (error) {
    console.error('Error in thinking A/B test:', error);
    return NextResponse.json(
      { error: 'Failed to run thinking test', details: error.message },
      { status: 500 }
    );
  }
}