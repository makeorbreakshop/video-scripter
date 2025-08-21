import { NextResponse } from 'next/server';
import { getSupabase } from '@/lib/supabase';
import { getOpenAIApiKey, isPgvectorEnabled } from '@/lib/env-config';
import Anthropic from '@anthropic-ai/sdk';

// Environment constants
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;

// Define model type
type ClaudeModelId = 
  | "claude-3-7-sonnet-20240620"
  | "claude-3-5-sonnet-20240620"
  | "claude-3-opus-20240229"
  | "claude-3-sonnet-20240229"
  | "claude-3-haiku-20240307";

type ClaudeModelInfo = {
  name: string;
  maxTokens: number;
};

// Available Claude models
const CLAUDE_MODELS: Record<ClaudeModelId, ClaudeModelInfo> = {
  "claude-3-7-sonnet-20240620": {
    name: "Claude 3.7 Sonnet",
    maxTokens: 4000
  },
  "claude-3-5-sonnet-20240620": {
    name: "Claude 3.5 Sonnet",
    maxTokens: 4000
  },
  "claude-3-opus-20240229": {
    name: "Claude 3 Opus",
    maxTokens: 4000
  },
  "claude-3-sonnet-20240229": {
    name: "Claude 3 Sonnet",
    maxTokens: 4000
  },
  "claude-3-haiku-20240307": {
    name: "Claude 3 Haiku",
    maxTokens: 4000
  }
};

// Default model
const DEFAULT_MODEL: ClaudeModelId = "claude-3-7-sonnet-20240620";

// Helper function to estimate token count
function calculateTokensUsed(analysisResults: any): number {
  const text = JSON.stringify(analysisResults);
  // Rough approximation: 1 token ≈ 4 characters for English text
  return Math.ceil(text.length / 4);
}

// Helper function to calculate cost based on tokens used
function calculateCost(tokensUsed: number): number {
  const costPerThousandTokens = 0.02; // Example cost per 1000 tokens
  return (tokensUsed / 1000) * costPerThousandTokens;
}

// Transform incoming data to match database schema
function transformAnalysisData(data: any) {
  // Ensure user_id is a valid UUID
  const userId = data.userId === 'test-user-id' ? '00000000-0000-0000-0000-000000000000' : data.userId;

  // Return transformed data
  return {
    ...data,
    userId,
    // Map other fields if necessary
  };
}

/**
 * API route for analyzing a single video with Claude
 * 
 * POST /api/skyscraper/analyze-single
 * 
 * Request Body:
 * {
 *   videoId: string,     // YouTube video ID to analyze
 *   userId: string,      // User ID for data access
 *   modelId: string,     // Optional: Claude model ID to use
 *   analysisResults: object, // The analysis results from Claude
 * }
 * 
 * Response:
 * {
 *   success: boolean,
 *   videoId: string,
 *   analysisId: string,
 *   message: string,
 *   error?: string       // Error message if any
 * }
 */
export async function POST(request: Request) {
  const supabase = getSupabase();
  try {
    // Check if necessary configurations are available
    if (!ANTHROPIC_API_KEY) {
      return NextResponse.json(
        { error: 'Claude API integration is not configured (missing API key)' },
        { status: 500 }
      );
    }
    
    // Parse request body
    const rawData = await request.json();
    const { videoId, modelId, analysisResults } = rawData;

    // Transform data
    const transformedData = transformAnalysisData(rawData);

    // Validate required parameters
    if (!videoId) {
      return NextResponse.json(
        { error: 'Video ID is required' },
        { status: 400 }
      );
    }
    
    if (!transformedData.userId) {
      return NextResponse.json(
        { error: 'User ID is required' },
        { status: 400 }
      );
    }

    if (!analysisResults) {
      return NextResponse.json(
        { error: 'Analysis results are required' },
        { status: 400 }
      );
    }
    
    // Determine which model to use
    const selectedModelId = modelId && modelId in CLAUDE_MODELS 
      ? modelId as ClaudeModelId 
      : DEFAULT_MODEL;
    
    console.log(`🔍 API: Saving Analysis for video ${videoId}`);
    
    // Get the video metadata if needed for logging purposes
    const { data: videoData, error: videoError } = await supabase
      .from('videos')
      .select('title, channel_id') // Use channel_id instead of channelTitle
      .eq('id', videoId)
      .single();
      
    if (videoError) {
      console.warn('Warning: Could not fetch video details:', videoError);
      // Continue anyway since we're just saving results
    }
    
    const startTime = new Date();

    // Calculate tokens used and cost
    const tokensUsed = calculateTokensUsed(analysisResults);
    const cost = calculateCost(tokensUsed);

    // Store the analysis results in the skyscraper_analyses table
    try {
      console.log('Storing analysis results in the database...');
      
      // If the analysis results don't match our expected format,
      // ensure we have at least the minimal required structure
      const processedResults = {
        content_analysis: analysisResults.content_analysis || 
                          { description: "Content analysis not available" },
                          
        audience_analysis: analysisResults.audience_analysis || 
                           { description: "Audience analysis not available" },
                           
        content_gaps: analysisResults.content_gaps || 
                      { description: "Content gaps analysis not available" },
                      
        structure_elements: analysisResults.framework_elements || 
                            analysisResults.structure_elements ||
                            { description: "Structure elements not available" },
                            
        engagement_techniques: analysisResults.engagement_techniques || 
                              { description: "Engagement techniques not available" },
                              
        value_delivery: analysisResults.value_delivery || 
                        { description: "Value delivery analysis not available" },
                        
        implementation_blueprint: analysisResults.implementation_blueprint || 
                                 { description: "Implementation blueprint not available" }
      };
      
      // Debug the processed results
      console.log('Processed analysis results keys:', Object.keys(processedResults).join(', '));
      
      // Insert the analysis results into the skyscraper_analyses table
      const { data: insertData, error: insertError } = await supabase
        .from('skyscraper_analyses')
        .insert({
          video_id: videoId,
          user_id: transformedData.userId,
          model_used: selectedModelId,
          content_analysis: processedResults.content_analysis,
          audience_analysis: processedResults.audience_analysis,
          content_gaps: processedResults.content_gaps,
          structure_elements: processedResults.structure_elements, // Map framework_elements to structure_elements
          engagement_techniques: processedResults.engagement_techniques,
          value_delivery: processedResults.value_delivery,
          implementation_blueprint: processedResults.implementation_blueprint,
          tokens_used: tokensUsed,
          cost: cost,
          status: 'completed',
          progress: 100,
          started_at: startTime.toISOString(),
          completed_at: new Date().toISOString()
        })
        .select()
        .single();
        
      if (insertError) {
        console.error('Error inserting analysis results:', insertError);
        throw new Error(`Failed to store analysis results: ${insertError.message}`);
      }
      
      console.log('Analysis results stored successfully:', insertData);
      
      // Return success response
      return NextResponse.json({
        success: true,
        videoId,
        analysisId: insertData.id,
        message: 'Analysis results saved successfully'
      });
    } catch (error) {
      console.error('Error storing analysis results:', error);
      
      return NextResponse.json({
        success: false,
        videoId,
        error: `Database operation failed: ${error instanceof Error ? error.message : String(error)}`
      }, { status: 500 });
    }
    
  } catch (error) {
    console.error('Error in saving analysis:', error);
    return NextResponse.json(
      { 
        error: `Operation failed: ${error instanceof Error ? error.message : String(error)}`,
        success: false
      },
      { status: 500 }
    );
  }
} 