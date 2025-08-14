/**
 * Frame Extraction API
 * Analyzes multiple videos to discover recurring successful patterns/frames
 * Includes user's channel analysis for context and strategic recommendations
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import Anthropic from '@anthropic-ai/sdk';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

interface FrameExtractionRequest {
  search_results: Array<{
    id?: string;           // Field from Supabase database  
    video_id?: string;     // Field expected by frontend
    title: string;
    channel_name: string;
    thumbnail_url: string;
    view_count: number;
    temporal_performance_score: number;
    search_source: string;
    matching_query: string;
  }>;
  user_concept: {
    core_problem: string;
    psychological_need: string;
    status_shift: string;
  };
  user_channel_id?: string;
}

interface DiscoveredFrame {
  frame_name: string;
  frequency: number;
  confidence_score: number;
  multi_modal_evidence: {
    thumbnail_pattern: string;
    title_pattern: string;
    content_pattern: string;
  };
  example_videos: string[];
  application_to_your_concept: {
    adaptation_strategy: string;
    specific_recommendations: string[];
    confidence: number;
  };
  your_channel_fit: 'proven' | 'untested' | 'gap';
  recommendation: 'leverage_strength' | 'fill_gap' | 'improve_existing';
}

export async function POST(request: NextRequest) {
  try {
    const { 
      search_results, 
      user_concept, 
      user_channel_id 
    }: FrameExtractionRequest = await request.json();

    console.log('🎬 Starting frame extraction analysis...');
    console.log(`📊 Analyzing ${search_results.length} videos for patterns`);

    // 1. Get full video data including summaries  
    // Use 'id' field since that's what the search API actually returns
    const videoIds = search_results.map(v => v.video_id || v.id).filter(id => id !== undefined);
    console.log(`🔍 Looking for ${videoIds.length} video IDs:`, videoIds.slice(0, 5));
    console.log(`📝 Sample search result structure:`, Object.keys(search_results[0] || {}));
    console.log(`🔍 Video IDs extracted: ${videoIds.length} valid IDs from ${search_results.length} search results`);
    
    if (videoIds.length === 0) {
      throw new Error(`No valid video IDs found in search results. Search results have these fields: ${Object.keys(search_results[0] || {}).join(', ')}`);
    }
    
    console.log('🗄️  Querying Supabase for video details...');
    const { data: fullVideos, error: videoError } = await supabase
      .from('videos')
      .select(`
        id, title, channel_name, thumbnail_url, view_count, published_at,
        temporal_performance_score, llm_summary, description
      `)
      .in('id', videoIds);

    console.log(`📦 Found ${fullVideos?.length || 0} videos in database (${videoIds.length} requested)`);
    if (videoError) {
      console.error('❌ Video query error:', videoError);
    }
    
    if (fullVideos && fullVideos.length > 0) {
      console.log('📊 Video performance scores:');
      fullVideos.forEach((video, i) => {
        console.log(`  ${i + 1}. "${video.title.substring(0, 50)}..." - ${video.temporal_performance_score}x baseline`);
      });
      
      const avgScore = fullVideos.reduce((sum, v) => sum + (v.temporal_performance_score || 1), 0) / fullVideos.length;
      console.log(`📈 Average performance: ${avgScore.toFixed(1)}x baseline`);
    }

    if (!fullVideos || fullVideos.length === 0) {
      throw new Error(`No video data found for analysis. Searched for ${videoIds.length} video IDs but found 0 in database.`);
    }

    // 2. Get user's channel context if provided
    let userChannelContext = null;
    if (user_channel_id) {
      console.log('📺 Analyzing user channel context for channel:', user_channel_id);
      
      // Get user's high-performing videos (temporal_performance_score >= 1.5)
      const twoYearsAgo = new Date();
      twoYearsAgo.setFullYear(twoYearsAgo.getFullYear() - 2);
      console.log('🔍 Looking for high-performing videos since:', twoYearsAgo.toISOString().split('T')[0]);

      const { data: userHighPerformers } = await supabase
        .from('videos')
        .select(`
          id, title, thumbnail_url, view_count, temporal_performance_score,
          llm_summary, published_at
        `)
        .eq('channel_id', user_channel_id)
        .gte('temporal_performance_score', 1.5)
        .gte('published_at', twoYearsAgo.toISOString())
        .order('temporal_performance_score', { ascending: false })
        .limit(10);

      // Get user's recent baseline performance
      const { data: userRecent } = await supabase
        .from('videos')
        .select('view_count, temporal_performance_score')
        .eq('channel_id', user_channel_id)
        .gte('published_at', twoYearsAgo.toISOString())
        .order('published_at', { ascending: false })
        .limit(50);

      const avgPerformance = userRecent?.reduce((sum, v) => sum + (v.temporal_performance_score || 1), 0) / (userRecent?.length || 1);

      userChannelContext = {
        high_performers: userHighPerformers || [],
        avg_performance_score: avgPerformance,
        total_recent_videos: userRecent?.length || 0
      };

      console.log(`✅ User channel analysis complete:`);
      console.log(`  - High-performing videos (≥1.5x): ${userHighPerformers?.length || 0}`);
      console.log(`  - Recent videos analyzed: ${userRecent?.length || 0}`);
      console.log(`  - Average performance: ${avgPerformance.toFixed(1)}x baseline`);
      
      if (userHighPerformers && userHighPerformers.length > 0) {
        console.log('🏆 Top user outliers:');
        userHighPerformers.slice(0, 3).forEach((video, i) => {
          console.log(`  ${i + 1}. "${video.title.substring(0, 45)}..." - ${video.temporal_performance_score.toFixed(1)}x`);
        });
      }
    }

    // 3. Prepare analysis data
    const analysisData = {
      competitor_videos: fullVideos.map(video => ({
        title: video.title,
        channel: video.channel_name,
        views: video.view_count,
        performance_score: video.temporal_performance_score,
        summary: video.llm_summary?.substring(0, 500) || 'No summary available',
        thumbnail_url: video.thumbnail_url
      })),
      user_concept,
      user_channel_context: userChannelContext
    };

    // 4. Create comprehensive prompt for frame extraction
    const frameExtractionPrompt = `
You are analyzing ${fullVideos.length} high-performing videos to discover recurring successful "frames" (approaches/patterns) that can be applied to a user's concept.

# USER'S CONCEPT TO REPACKAGE:
Core Problem: ${user_concept.core_problem}
Psychological Need: ${user_concept.psychological_need}
Status Shift: ${user_concept.status_shift}

# COMPETITOR VIDEOS TO ANALYZE:
${analysisData.competitor_videos.map((video, i) => `
Video ${i + 1}:
- Title: "${video.title}"
- Channel: ${video.channel}
- Performance: ${video.performance_score}x baseline (${video.views.toLocaleString()} views)
- Summary: ${video.summary}
`).join('')}

${userChannelContext ? `
# USER'S CHANNEL CONTEXT:
Average Performance: ${userChannelContext.avg_performance_score.toFixed(1)}x baseline
High-Performing Videos: ${userChannelContext.high_performers.length} videos
Recent Video Count: ${userChannelContext.total_recent_videos}

Your Proven High Performers:
${userChannelContext.high_performers.map((video, i) => `
${i + 1}. "${video.title}" (${video.temporal_performance_score.toFixed(1)}x baseline)
   Summary: ${video.llm_summary?.substring(0, 300) || 'No summary'}
`).join('')}
` : ''}

# YOUR TASK:
Analyze these videos to discover 3-5 distinct "frames" (recurring approaches/patterns) that appear across multiple videos. For each frame:

1. **Discover the pattern** - Don't use predefined categories, find what actually exists
2. **Multi-modal analysis** - Look at titles, content approaches, and likely thumbnail styles
3. **Frequency tracking** - How many videos use this approach
4. **Application strategy** - How to adapt this frame to the user's concept
5. **Channel fit analysis** - Does the user already use this frame successfully?

Return your analysis as a JSON object with this structure:

{
  "discovered_frames": [
    {
      "frame_name": "AI-discovered name for this approach",
      "frequency": number_of_videos_using_this,
      "confidence_score": 0.0-1.0,
      "multi_modal_evidence": {
        "thumbnail_pattern": "Visual pattern likely used",
        "title_pattern": "Title structure/approach pattern", 
        "content_pattern": "Content delivery/structure pattern"
      },
      "example_videos": ["Video titles that exemplify this frame"],
      "application_to_your_concept": {
        "adaptation_strategy": "How to adapt this frame to user's concept",
        "specific_recommendations": ["Specific tactical recommendations"],
        "confidence": 0.0-1.0
      },
      "your_channel_fit": "proven|untested|gap",
      "recommendation": "leverage_strength|fill_gap|improve_existing"
    }
  ],
  "cross_frame_insights": "Patterns that span multiple frames",
  "strategic_summary": "Overall strategy recommendations"
}

Focus on actionable patterns that can be systematically applied to the user's concept.
`;

    console.log('🤖 Sending frame extraction request to Claude...');
    console.log('📝 Prompt length:', frameExtractionPrompt.length, 'characters');
    console.log('🎯 Model: Claude Sonnet 4 with Extended Thinking (4k tokens)');
    console.log('⚙️  Max tokens: 6000 | Temperature: 1.0');

    // 5. Call Anthropic API for frame extraction
    const anthropic = new Anthropic({
      apiKey: process.env.ANTHROPIC_API_KEY!,
    });

    const startTime = Date.now();
    console.log('⏱️  Starting Claude API call at', new Date().toLocaleTimeString());

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',  // Claude Sonnet 4 for superior frame analysis
      max_tokens: 6000, // Increased for thinking + response
      temperature: 1, // Required for thinking
      thinking: {
        type: "enabled",
        budget_tokens: 4000 // Extended thinking for sophisticated pattern discovery
      },
      messages: [
        {
          role: 'user',
          content: frameExtractionPrompt
        }
      ]
    });

    const endTime = Date.now();
    const duration = ((endTime - startTime) / 1000).toFixed(1);
    console.log('✅ Claude API call completed in', duration, 'seconds');
    
    // Log token usage and cost estimation
    if (response.usage) {
      const inputTokens = response.usage.input_tokens;
      const outputTokens = response.usage.output_tokens;
      const totalTokens = inputTokens + outputTokens;
      
      // Claude Sonnet 4 pricing: $15/1M input, $75/1M output, $75/1M thinking
      const inputCost = (inputTokens / 1_000_000) * 15;
      const outputCost = (outputTokens / 1_000_000) * 75;
      const thinkingCost = (4000 / 1_000_000) * 75; // 4k thinking tokens
      const totalCost = inputCost + outputCost + thinkingCost;
      
      console.log('📊 Token usage and cost:');
      console.log('  Input tokens:', inputTokens.toLocaleString(), `($${inputCost.toFixed(4)})`);
      console.log('  Output tokens:', outputTokens.toLocaleString(), `($${outputCost.toFixed(4)})`);
      console.log('  Thinking tokens: 4,000', `($${thinkingCost.toFixed(4)})`);
      console.log('  Total tokens:', totalTokens.toLocaleString());
      console.log('  💰 Estimated cost: $' + totalCost.toFixed(4));
    }
    
    // Log response structure
    console.log('📋 Response contains', response.content.length, 'content blocks:');
    response.content.forEach((block, i) => {
      console.log(`  Block ${i + 1}: ${block.type} (${block.type === 'text' ? block.text.length : 'N/A'} chars)`);
    });

    if (!response.content || !response.content[0]) {
      console.error('❌ No content in Claude response:', response);
      throw new Error('Failed to generate frame analysis - no content');
    }

    // Handle both thinking and text content blocks
    const textBlocks = response.content.filter(block => block.type === 'text');
    if (textBlocks.length === 0) {
      console.error('❌ No text blocks in Claude response:', response.content.map(c => c.type));
      throw new Error('Failed to generate frame analysis - no text content');
    }

    // 6. Parse the JSON response
    console.log('🔍 Parsing Claude response...');
    let frameAnalysis;
    try {
      // Extract JSON from response (handle potential markdown formatting)
      const responseText = textBlocks[0].text;
      console.log('📝 Claude response length:', responseText.length, 'characters');
      console.log('📝 Response preview:', responseText.substring(0, 300) + '...');
      
      const jsonMatch = responseText.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        console.error('❌ No JSON found in response text (first 800 chars):', responseText.substring(0, 800));
        throw new Error('No JSON found in response');
      }
      
      console.log('✅ JSON block found, length:', jsonMatch[0].length, 'characters');
      console.log('🔧 Attempting to parse JSON...');
      
      frameAnalysis = JSON.parse(jsonMatch[0]);
      
      console.log('✅ JSON parsed successfully');
      console.log('📊 Frame analysis structure:');
      if (frameAnalysis.discovered_frames) {
        console.log(`  - ${frameAnalysis.discovered_frames.length} discovered frames`);
        frameAnalysis.discovered_frames.forEach((frame, i) => {
          console.log(`    Frame ${i + 1}: "${frame.frame_name}" (confidence: ${frame.confidence_score})`);
        });
      }
      if (frameAnalysis.strategic_summary) {
        console.log(`  - Strategic summary: ${frameAnalysis.strategic_summary.substring(0, 100)}...`);
      }
      
    } catch (parseError) {
      console.error('❌ Failed to parse frame analysis JSON:', parseError);
      console.error('❌ Raw JSON content (first 1000 chars):', jsonMatch?.[0]?.substring(0, 1000) || 'No JSON match');
      console.error('❌ Full response text (first 1000 chars):', textBlocks[0]?.text?.substring(0, 1000));
      throw new Error('Invalid JSON response from analysis');
    }

    console.log('✅ Frame extraction complete');
    console.log(`📋 Discovered ${frameAnalysis.discovered_frames?.length || 0} frames`);

    return NextResponse.json({
      success: true,
      frame_analysis: frameAnalysis,
      analysis_meta: {
        videos_analyzed: fullVideos.length,
        user_channel_included: !!userChannelContext,
        user_high_performers: userChannelContext?.high_performers.length || 0
      }
    });

  } catch (error) {
    console.error('Frame extraction failed:', error);
    return NextResponse.json(
      { 
        success: false,
        error: 'Frame extraction failed',
        details: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  }
}