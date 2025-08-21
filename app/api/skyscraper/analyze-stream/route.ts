import { NextResponse } from 'next/server';
import { anthropic } from '@ai-sdk/anthropic';
import { streamText } from 'ai';
import { getSupabase } from '@/lib/supabase';

/**
 * API route for streaming Skyscraper Analysis from Claude
 * 
 * POST /api/skyscraper/analyze-stream
 * 
 * Request Body:
 * {
 *   videoId: string,     // YouTube video ID to analyze
 *   userId: string,      // User ID for data access
 *   modelId: string      // Claude model ID to use
 * }
 */
export async function POST(request: Request) {
  const supabase = getSupabase();
  try {
    // Parse request body
    const { videoId, userId, modelId = 'claude-3-7-sonnet-20250219' } = await request.json();
    
    // Validate required parameters
    if (!videoId) {
      return NextResponse.json(
        { error: 'Video ID is required' },
        { status: 400 }
      );
    }
    
    if (!userId) {
      return NextResponse.json(
        { error: 'User ID is required' },
        { status: 400 }
      );
    }
    
    console.log(`🔍 Streaming: Starting Skyscraper Analysis for video ${videoId} using ${modelId}`);
    
    // Get the video metadata
    const { data: videoData, error: videoError } = await supabase
      .from('videos')
      .select('*')
      .eq('id', videoId)
      .single();
      
    if (videoError || !videoData) {
      console.error('Error fetching video data:', videoError);
      return NextResponse.json(
        { error: `Failed to fetch video: ${videoError?.message || 'Not found'}` },
        { status: 404 }
      );
    }
    
    console.log(`Video data found: ${videoData.title}`);
    
    // Fetch transcript data from the chunks table with content_type = 'transcript'
    const { data: transcriptData, error: transcriptError } = await supabase
      .from('chunks')
      .select('content, start_time, end_time')
      .eq('video_id', videoId)
      .eq('content_type', 'transcript')
      .order('start_time', { ascending: true });
      
    if (transcriptError) {
      console.error('Error fetching transcript chunks:', transcriptError);
      return NextResponse.json(
        { error: `Failed to fetch transcript: ${transcriptError.message}` },
        { status: 500 }
      );
    }
    
    console.log(`Found ${transcriptData?.length || 0} transcript chunks`);
    
    // Combine all transcript chunks into a single text
    const fullTranscript = transcriptData.map(chunk => chunk.content).join('\n\n');
    
    if (fullTranscript.length === 0) {
      return NextResponse.json(
        { error: 'No transcript content found for this video' },
        { status: 404 }
      );
    }
    
    // Fetch comments from the chunks table with content_type = 'comment_cluster'
    const { data: commentsData, error: commentsError } = await supabase
      .from('chunks')
      .select('content, metadata, user_id, created_at')
      .eq('video_id', videoId)
      .eq('content_type', 'comment_cluster')
      .order('created_at', { ascending: true });
      
    if (commentsError) {
      console.error('Error fetching comments:', commentsError);
      // Continue without comments
    }
    
    // Process comments into a readable format
    let formattedComments = "";
    let totalCommentCount = 0;
    if (commentsData && commentsData.length > 0) {
      console.log(`Found ${commentsData.length} comment clusters`);
      
      // Calculate the total number of individual comments
      totalCommentCount = commentsData.reduce((total, cluster) => {
        return total + (Number(cluster.metadata?.commentCount) || 0);
      }, 0);
      console.log(`Total individual comments: ${totalCommentCount}`);
      
      formattedComments = commentsData.map(commentCluster => {
        // Extract metadata from the comment cluster
        const commentCount = commentCluster.metadata?.commentCount || 'Unknown';
        const authorCount = commentCluster.metadata?.authorCount || 'Unknown';
        const keywords = commentCluster.metadata?.keywords?.join(', ') || 'None';
        const averageLikes = commentCluster.metadata?.averageLikeCount || 0;
        
        return `COMMENT CLUSTER (${commentCount} comments from ${authorCount} authors, Keywords: ${keywords}, Avg. Likes: ${averageLikes}):\n${commentCluster.content}`;
      }).join('\n\n');
    } else {
      console.log('No comments found for this video');
      formattedComments = "";
    }
    
    console.log(`Transcript length: ${fullTranscript.length} characters`);
    console.log(`Comments count: ${totalCommentCount}`);
    
    // Create system prompt
    const systemPrompt = `
You are an expert video content analyzer using the Skyscraper Analysis Framework. Your task is to analyze a YouTube video based on its transcript${commentsData && commentsData.length > 0 ? ' and comments' : ''}.

The Skyscraper Analysis Framework consists of:

1. Content Analysis: Structure, key points, technical information, expertise elements, visual cues
2. Audience Analysis: Sentiment, ${commentsData && commentsData.length > 0 ? 'praise points, questions/gaps, ' : 'prediction of audience response, '}use cases, demographic signals${commentsData && commentsData.length > 0 ? ', engagement patterns' : ''}
3. Content Gap Assessment: Missing information, follow-up opportunities, clarity issues, depth/breadth balance
4. Framework Elements: Overall structure, section ratios, information hierarchy, pacing/flow
5. Engagement Techniques: Hook strategy, retention mechanisms, pattern interrupts, interaction prompts
6. Value Delivery Methods: Information packaging, problem-solution framing, practical application, trust building
7. Implementation Blueprint: Content template, key sections, engagement points, differentiation opportunities, CTA strategy

Provide a comprehensive analysis with specific, actionable insights in a structured format.${commentsData && commentsData.length === 0 ? ' Note that for this analysis you\'ll need to rely solely on the transcript as comment data is not available.' : ''}

Your response MUST be formatted as a valid JSON object with the following structure:
{
  "content_analysis": {
    "structural_organization": [
      { "title": string, "start_time": string, "end_time": string, "description": string }
    ],
    "key_points": [
      { "point": string, "timestamp": string, "elaboration": string }
    ],
    "technical_information": [
      { "topic": string, "details": string }
    ],
    "expertise_elements": string,
    "visual_elements": [
      { "element": string, "purpose": string }
    ]
  },
  "audience_analysis": {
    "sentiment_overview": {
      "positive": number,
      "neutral": number,
      "negative": number,
      "key_themes": [string]
    },
    "praise_points": [
      { "topic": string, "frequency": string, "examples": [string] }
    ],
    "questions_gaps": [
      { "question": string, "frequency": string, "context": string }
    ],
    "use_cases": [
      { "case": string, "context": string }
    ],
    "demographic_signals": {
      "expertise_level": string,
      "industry_focus": [string],
      "notable_segments": [string]
    },
    "engagement_patterns": [
      { "pattern": string, "indicators": [string] }
    ]
  },
  "content_gaps": {
    "missing_information": [
      { "topic": string, "importance": string, "context": string }
    ],
    "follow_up_opportunities": string,
    "clarity_issues": string,
    "depth_breadth_balance": string
  },
  "framework_elements": {
    "overall_structure": string,
    "section_ratios": {
      "introduction": number,
      "main_content": number,
      "conclusion": number
    },
    "information_hierarchy": string,
    "pacing_flow": string
  },
  "engagement_techniques": {
    "hook_strategy": string,
    "retention_mechanisms": [
      { "technique": string, "implementation": string, "effectiveness": string }
    ],
    "pattern_interrupts": [
      { "type": string, "timestamp": string, "purpose": string }
    ],
    "interaction_prompts": [
      { "prompt_type": string, "implementation": string }
    ]
  },
  "value_delivery": {
    "information_packaging": string,
    "problem_solution_framing": string,
    "practical_application": [
      { "application": string, "context": string }
    ],
    "trust_building": [
      { "element": string, "implementation": string }
    ]
  },
  "implementation_blueprint": {
    "content_template": string,
    "key_sections": [
      { "section": string, "purpose": string, "content_guidance": string }
    ],
    "engagement_points": [
      { "point": string, "implementation": string }
    ],
    "differentiation_opportunities": [
      { "opportunity": string, "implementation": string }
    ],
    "cta_strategy": string
  }
}

Make sure to not include any explanatory text, comments, markdown, or any other formatting. Only return the pure JSON object.`;

    // Create user prompt
    const userPrompt = `Please analyze this video content using the Skyscraper Analysis Framework to understand its structure${commentsData && commentsData.length > 0 ? ', audience response, ' : ' and '}key success factors. The video has ${fullTranscript.length} characters of transcript content${commentsData && commentsData.length > 0 ? ` and ${totalCommentCount} comments to analyze` : ''}.

TRANSCRIPT:
${fullTranscript}
${commentsData && commentsData.length > 0 ? `
COMMENTS:
${formattedComments}
` : ''}

Focus on:
1. Identifying the key structural elements and how they contribute to the video's effectiveness
2. ${commentsData && commentsData.length > 0 ? 'Understanding audience engagement patterns and sentiment through comment analysis' : 'Predicting audience engagement patterns based on the content'}
3. Extracting actionable insights that can be applied to future content creation
4. Identifying content gaps and opportunities for follow-up content
5. Understanding the video's hook strategy and retention mechanisms
6. Analyzing how value is delivered and trust is built with the audience
7. Creating a practical implementation blueprint for similar content`;
    
    // Set up Claude with streaming enabled
    const result = streamText({
      model: anthropic(modelId as any),
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
      temperature: 0.3,
      maxTokens: 4000,
      providerOptions: {
        anthropic: {
          thinking: { type: 'enabled', budgetTokens: 12000 },
        },
      },
    });
    
    // Return the streaming response with reasoning tokens enabled
    return result.toDataStreamResponse({
      sendReasoning: true,
    });
    
  } catch (error) {
    console.error('Error in streaming Skyscraper Analysis:', error);
    return NextResponse.json(
      { error: 'Failed to analyze video' },
      { status: 500 }
    );
  }
} 