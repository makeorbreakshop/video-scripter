'use server'

import { anthropic } from '@ai-sdk/anthropic';
import { generateObject } from 'ai';
import { supabase } from '@/lib/supabase';

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

// Available Claude models
export const CLAUDE_MODELS = [
  {
    id: "claude-3-7-sonnet-20250219",
    name: "Claude 3.7 Sonnet",
    inputCostPer1kTokens: 0.015,
    outputCostPer1kTokens: 0.075,
    maxTokens: 200000
  },
  {
    id: "claude-3-5-sonnet-20240620",
    name: "Claude 3.5 Sonnet",
    inputCostPer1kTokens: 0.008,
    outputCostPer1kTokens: 0.024,
    maxTokens: 200000
  },
  {
    id: "claude-3-haiku-20240307",
    name: "Claude 3 Haiku",
    inputCostPer1kTokens: 0.003,
    outputCostPer1kTokens: 0.015,
    maxTokens: 180000
  },
];

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
    
    // Fetch transcript data
    const { data: transcriptData, error: transcriptError } = await supabase
      .from('video_chunks')
      .select('content')
      .eq('video_id', videoId)
      .order('chunk_index', { ascending: true });
      
    if (transcriptError) {
      console.error('Error fetching transcript chunks:', transcriptError);
      throw new Error(`Failed to fetch transcript: ${transcriptError.message}`);
    }
    
    // Fetch comments
    const { data: commentsData, error: commentsError } = await supabase
      .from('video_comments')
      .select('*')
      .eq('video_id', videoId);
      
    if (commentsError) {
      console.error('Error fetching comments:', commentsError);
      throw new Error(`Failed to fetch comments: ${commentsError.message}`);
    }
    
    // Combine all transcript chunks into a single text
    const fullTranscript = transcriptData.map(chunk => chunk.content).join('\n\n');
    
    // Process comments into a readable format
    const formattedComments = commentsData.map(comment => {
      return `${comment.author} (Likes: ${comment.like_count}, Date: ${comment.published_at}): ${comment.text}`;
    }).join('\n\n');
    
    // Create system prompt
    const systemPrompt = `
You are an expert video content analyzer using the Skyscraper Analysis Framework. Your task is to analyze a YouTube video based on its transcript and comments.

The Skyscraper Analysis Framework consists of:

1. Content Analysis: Structure, key points, technical information, expertise elements, visual cues
2. Audience Analysis: Sentiment, praise points, questions/gaps, use cases, demographic signals, engagement patterns
3. Content Gap Assessment: Missing information, follow-up opportunities, clarity issues, depth/breadth balance
4. Framework Elements: Overall structure, section ratios, information hierarchy, pacing/flow
5. Engagement Techniques: Hook strategy, retention mechanisms, pattern interrupts, interaction prompts
6. Value Delivery Methods: Information packaging, problem-solution framing, practical application, trust building
7. Implementation Blueprint: Content template, key sections, engagement points, differentiation opportunities, CTA strategy

Provide a comprehensive analysis with specific, actionable insights in a structured format.
`;

    // Create user prompt
    const userPrompt = `Please analyze this video content using the Skyscraper Analysis Framework to understand its structure, audience response, and key success factors. The video has ${fullTranscript.length} characters of transcript content and ${commentsData.length} comments to analyze.

TRANSCRIPT:
${fullTranscript}

COMMENTS:
${formattedComments}

Focus on:
1. Identifying the key structural elements and how they contribute to the video's effectiveness
2. Understanding audience engagement patterns and sentiment through comment analysis
3. Extracting actionable insights that can be applied to future content creation
4. Identifying content gaps and opportunities for follow-up content
5. Understanding the video's hook strategy and retention mechanisms
6. Analyzing how value is delivered and trust is built with the audience
7. Creating a practical implementation blueprint for similar content`;

    // Use AI SDK to generate a structured object response
    const { object } = await generateObject<SkyscraperAnalysisResponse>({
      model: anthropic(modelId as any),
      schema: {
        type: 'object',
        properties: {
          content_analysis: {
            type: 'object',
            properties: {
              structural_organization: { type: 'array' },
              key_points: { type: 'array' },
              technical_information: { type: 'array' },
              expertise_elements: { type: 'string' },
              visual_elements: { type: 'array' },
            },
            required: ['structural_organization', 'key_points', 'expertise_elements'],
          },
          audience_analysis: {
            type: 'object',
            properties: {
              sentiment_overview: { type: 'object' },
              praise_points: { type: 'array' },
              questions_gaps: { type: 'array' },
              use_cases: { type: 'array' },
              demographic_signals: { type: 'object' },
              engagement_patterns: { type: 'array' },
            },
            required: ['sentiment_overview', 'praise_points'],
          },
          content_gaps: {
            type: 'object',
            properties: {
              missing_information: { type: 'array' },
              follow_up_opportunities: { type: 'string' },
              clarity_issues: { type: 'string' },
              depth_breadth_balance: { type: 'string' },
            },
            required: ['missing_information', 'follow_up_opportunities'],
          },
          framework_elements: {
            type: 'object',
            properties: {
              overall_structure: { type: 'string' },
              section_ratios: { type: 'object' },
              information_hierarchy: { type: 'string' },
              pacing_flow: { type: 'string' },
            },
            required: ['overall_structure', 'section_ratios'],
          },
          engagement_techniques: {
            type: 'object',
            properties: {
              hook_strategy: { type: 'string' },
              retention_mechanisms: { type: 'array' },
              pattern_interrupts: { type: 'array' },
              interaction_prompts: { type: 'array' },
            },
            required: ['hook_strategy', 'retention_mechanisms'],
          },
          value_delivery: {
            type: 'object',
            properties: {
              information_packaging: { type: 'string' },
              problem_solution_framing: { type: 'string' },
              practical_application: { type: 'array' },
              trust_building: { type: 'array' },
            },
            required: ['information_packaging', 'problem_solution_framing'],
          },
          implementation_blueprint: {
            type: 'object',
            properties: {
              content_template: { type: 'string' },
              key_sections: { type: 'array' },
              engagement_points: { type: 'array' },
              differentiation_opportunities: { type: 'array' },
              cta_strategy: { type: 'string' },
            },
            required: ['content_template', 'key_sections'],
          },
        },
        required: [
          'content_analysis',
          'audience_analysis',
          'content_gaps',
          'framework_elements',
          'engagement_techniques',
          'value_delivery',
          'implementation_blueprint'
        ],
      } as any,
      system: systemPrompt,
      prompt: userPrompt,
      providerOptions: {
        anthropic: {
          thinking: { type: 'enabled', budgetTokens: 10000 },
        },
      },
    });

    // Save the analysis results to the database
    const { data: analysisData, error: analysisError } = await supabase
      .from('skyscraper_analyses')
      .insert({
        video_id: videoId,
        user_id: userId,
        analysis_date: new Date().toISOString(),
        model_id: modelId,
        analysis_data: object as any,
        system_prompt: systemPrompt,
        user_prompt: userPrompt,
        reasoning: '', // Currently not capturing reasoning
      })
      .select('id')
      .single();

    if (analysisError) {
      console.error('Error saving analysis results:', analysisError);
      throw new Error(`Failed to save analysis: ${analysisError.message}`);
    }

    return {
      success: true,
      videoId,
      analysisResults: object,
      analysisId: analysisData.id,
      systemPrompt,
      userPrompt,
    };
  } catch (error) {
    console.error('Error in Skyscraper Analysis:', error);
    throw error;
  }
} 