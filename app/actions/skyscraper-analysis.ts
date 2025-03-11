'use server'

import { anthropic } from '@ai-sdk/anthropic';
import { generateText } from 'ai';
import { supabase } from '@/lib/supabase';
import { CLAUDE_MODELS } from '@/app/constants/claude-models';
import { z } from 'zod';

// Define the expected response structure
interface SkyscraperAnalysisResponse {
  content_analysis: {
    structural_organization: Array<{
      title: string;
      start_time: string;
      end_time: string;
      description: string;
    }>;
    key_points: Array<{
      point: string;
      timestamp: string;
      elaboration: string;
    }>;
    technical_information: Array<{
      topic: string;
      details: string;
    }>;
    expertise_elements: string;
    visual_elements: Array<{
      element: string;
      purpose: string;
    }>;
  };
  audience_analysis: {
    sentiment_overview: {
      positive: number;
      neutral: number;
      negative: number;
      key_themes: string[];
    };
    praise_points: Array<{
      topic: string;
      frequency: string;
      examples: string[];
    }>;
    questions_gaps: Array<{
      question: string;
      frequency: string;
      context: string;
    }>;
    use_cases: Array<{
      case: string;
      context: string;
    }>;
    demographic_signals: {
      expertise_level: string;
      industry_focus: string[];
      notable_segments: string[];
    };
    engagement_patterns: Array<{
      pattern: string;
      indicators: string[];
    }>;
  };
  content_gaps: {
    missing_information: Array<{
      topic: string;
      importance: string;
      context: string;
    }>;
    follow_up_opportunities: string;
    clarity_issues: string;
    depth_breadth_balance: string;
  };
  framework_elements: {
    overall_structure: string;
    section_ratios: {
      introduction: number;
      main_content: number;
      conclusion: number;
    };
    information_hierarchy: string;
    pacing_flow: string;
  };
  engagement_techniques: {
    hook_strategy: string;
    retention_mechanisms: Array<{
      technique: string;
      implementation: string;
      effectiveness: string;
    }>;
    pattern_interrupts: Array<{
      type: string;
      timestamp: string;
      purpose: string;
    }>;
    interaction_prompts: Array<{
      prompt_type: string;
      implementation: string;
    }>;
  };
  value_delivery: {
    information_packaging: string;
    problem_solution_framing: string;
    practical_application: Array<{
      application: string;
      context: string;
    }>;
    trust_building: Array<{
      element: string;
      implementation: string;
    }>;
  };
  implementation_blueprint: {
    content_template: string;
    key_sections: Array<{
      section: string;
      purpose: string;
      content_guidance: string;
    }>;
    engagement_points: Array<{
      point: string;
      implementation: string;
    }>;
    differentiation_opportunities: Array<{
      opportunity: string;
      implementation: string;
    }>;
    cta_strategy: string;
  };
}

export async function analyzeVideoWithSkyscraper(
  videoId: string, 
  userId: string,
  modelId: string = 'claude-3-7-sonnet-20250219'
) {
  console.log(`🔍 Starting Skyscraper Analysis for video ${videoId} using ${modelId}`);
  
  try {
    // Get the video metadata
    const { data: videoData, error: videoError } = await supabase
      .from('videos')
      .select('*')
      .eq('id', videoId)
      .single();
      
    if (videoError || !videoData) {
      console.error('Error fetching video data:', videoError);
      throw new Error(`Failed to fetch video: ${videoError?.message || 'Not found'}`);
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
      throw new Error(`Failed to fetch transcript: ${transcriptError.message}`);
    }
    
    console.log(`Found ${transcriptData?.length || 0} transcript chunks`);
    
    // Combine all transcript chunks into a single text
    const fullTranscript = transcriptData.map(chunk => chunk.content).join('\n\n');
    
    if (fullTranscript.length === 0) {
      throw new Error('No transcript content found for this video');
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
`;

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

    // Use AI SDK to generate a structured response using generateText
    const { text } = await generateText({
      model: anthropic(modelId as any),
      system: systemPrompt + "\n\nProvide your response as a valid JSON object with the expected structure, without any markdown formatting or explanatory text.",
      messages: [{ role: 'user', content: userPrompt }],
      temperature: 0.3,
      maxTokens: 4000
    });
    
    // Parse the JSON response
    let analysisObject;
    try {
      analysisObject = JSON.parse(text);
      
      // Apply Zod validation to ensure the response matches our expected schema
      const schema = z.object({
        content_analysis: z.object({
          structural_organization: z.array(z.object({
            title: z.string(),
            start_time: z.string(),
            end_time: z.string(),
            description: z.string(),
          })),
          key_points: z.array(z.object({
            point: z.string(),
            timestamp: z.string(),
            elaboration: z.string(),
          })),
          technical_information: z.array(z.object({
            topic: z.string(),
            details: z.string(),
          })),
          expertise_elements: z.string(),
          visual_elements: z.array(z.object({
            element: z.string(),
            purpose: z.string(),
          })),
        }),
        audience_analysis: z.object({
          sentiment_overview: z.object({
            positive: z.number(),
            neutral: z.number(),
            negative: z.number(),
            key_themes: z.array(z.string()),
          }),
          praise_points: z.array(z.object({
            topic: z.string(),
            frequency: z.string(),
            examples: z.array(z.string()),
          })),
          questions_gaps: z.array(z.object({
            question: z.string(),
            frequency: z.string(),
            context: z.string(),
          })),
          use_cases: z.array(z.object({
            case: z.string(),
            context: z.string(),
          })),
          demographic_signals: z.object({
            expertise_level: z.string(),
            industry_focus: z.array(z.string()),
            notable_segments: z.array(z.string()),
          }),
          engagement_patterns: z.array(z.object({
            pattern: z.string(),
            indicators: z.array(z.string()),
          })),
        }),
        content_gaps: z.object({
          missing_information: z.array(z.object({
            topic: z.string(),
            importance: z.string(),
            context: z.string(),
          })),
          follow_up_opportunities: z.string(),
          clarity_issues: z.string(),
          depth_breadth_balance: z.string(),
        }),
        framework_elements: z.object({
          overall_structure: z.string(),
          section_ratios: z.object({
            introduction: z.number(),
            main_content: z.number(),
            conclusion: z.number(),
          }),
          information_hierarchy: z.string(),
          pacing_flow: z.string(),
        }),
        engagement_techniques: z.object({
          hook_strategy: z.string(),
          retention_mechanisms: z.array(z.object({
            technique: z.string(),
            implementation: z.string(),
            effectiveness: z.string(),
          })),
          pattern_interrupts: z.array(z.object({
            type: z.string(),
            timestamp: z.string(),
            purpose: z.string(),
          })),
          interaction_prompts: z.array(z.object({
            prompt_type: z.string(),
            implementation: z.string(),
          })),
        }),
        value_delivery: z.object({
          information_packaging: z.string(),
          problem_solution_framing: z.string(),
          practical_application: z.array(z.object({
            application: z.string(),
            context: z.string(),
          })),
          trust_building: z.array(z.object({
            element: z.string(),
            implementation: z.string(),
          })),
        }),
        implementation_blueprint: z.object({
          content_template: z.string(),
          key_sections: z.array(z.object({
            section: z.string(),
            purpose: z.string(),
            content_guidance: z.string(),
          })),
          engagement_points: z.array(z.object({
            point: z.string(),
            implementation: z.string(),
          })),
          differentiation_opportunities: z.array(z.object({
            opportunity: z.string(),
            implementation: z.string(),
          })),
          cta_strategy: z.string(),
        }),
      });
      
      // Validate the response (this will throw if validation fails)
      schema.parse(analysisObject);
    } catch (error) {
      console.error('Error parsing or validating JSON response:', error);
      throw new Error('Failed to parse AI response as JSON or response did not match expected schema');
    }

    console.log("Analysis complete, saving to skyscraper_analyses table");

    // Save the analysis results to the database
    const { data: analysisData, error: analysisError } = await supabase
      .from('skyscraper_analyses')
      .insert({
        video_id: videoId,
        user_id: userId,
        analysis_date: new Date().toISOString(),
        model_id: modelId,
        content_analysis: analysisObject.content_analysis,
        audience_analysis: analysisObject.audience_analysis,
        content_gaps: analysisObject.content_gaps,
        structure_elements: analysisObject.framework_elements,
        engagement_techniques: analysisObject.engagement_techniques,
        value_delivery: analysisObject.value_delivery,
        implementation_blueprint: analysisObject.implementation_blueprint,
        model_used: CLAUDE_MODELS.find(model => model.id === modelId)?.name || modelId,
        tokens_used: Math.round(fullTranscript.length / 4), // Rough estimate
        cost: 0, // You can calculate this more precisely if needed
        status: 'completed',
        progress: 100,
        started_at: new Date().toISOString(),
        completed_at: new Date().toISOString(),
      })
      .select('id')
      .single();

    if (analysisError) {
      console.error('Error saving analysis results:', analysisError);
      throw new Error(`Failed to save analysis: ${analysisError.message}`);
    }

    console.log(`Analysis saved with ID: ${analysisData.id}`);

    return {
      success: true,
      videoId,
      analysisResults: analysisObject,
      analysisId: analysisData.id,
      systemPrompt,
      userPrompt,
    };
  } catch (error) {
    console.error('Error in Skyscraper Analysis:', error);
    throw error;
  }
} 