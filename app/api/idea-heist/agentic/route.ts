/**
 * API endpoint for Idea Heist Agentic Mode
 * Runs the complete agentic analysis pipeline
 */

import { NextRequest, NextResponse } from 'next/server';
import { runIdeaHeistAgent } from '@/lib/agentic/orchestrator/idea-heist-agent';
import { createClient } from '@supabase/supabase-js';
import { isOpenAIConfigured } from '@/lib/agentic/openai-integration';

export async function POST(request: NextRequest) {
  try {
    // Parse request body
    const body = await request.json();
    const { videoId, mode = 'agentic', options = {} } = body;
    
    if (!videoId) {
      return NextResponse.json(
        { error: 'Video ID is required' },
        { status: 400 }
      );
    }
    
    // Check if OpenAI is configured
    if (!isOpenAIConfigured()) {
      console.warn('OpenAI API key not configured, using mock mode');
    }
    
    // Get Supabase client
    const supabase = createClient(
      process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );
    
    // Check if video exists
    const { data: video, error: videoError } = await supabase
      .from('videos')
      .select('id, title, channel_id')
      .eq('id', videoId)
      .single();
    
    if (videoError || !video) {
      return NextResponse.json(
        { error: 'Video not found', details: videoError?.message },
        { status: 404 }
      );
    }
    
    // Run the agentic analysis
    console.log(`Starting agentic analysis for video ${videoId}`);
    
    const result = await runIdeaHeistAgent(videoId, {
      mode,
      budget: {
        maxFanouts: options.maxFanouts || 5,
        maxValidations: options.maxValidations || 20,
        maxCandidates: options.maxCandidates || 200,
        maxTokens: options.maxTokens || 200000,
        maxDurationMs: options.maxDurationMs || 180000,
        maxToolCalls: options.maxToolCalls || 100
      },
      timeoutMs: options.timeoutMs || 180000,
      retryAttempts: options.retryAttempts || 2,
      fallbackToClassic: options.fallbackToClassic !== false,
      parallelExecution: options.parallelExecution !== false,
      cacheResults: options.cacheResults !== false,
      telemetryEnabled: options.telemetryEnabled !== false
    });
    
    // Store the result in the database if successful
    if (result.success && result.pattern) {
      const { error: insertError } = await supabase
        .from('idea_heist_discoveries')
        .insert({
          video_id: videoId,
          discovery_mode: result.mode,
          pattern_statement: result.pattern.statement,
          confidence: result.pattern.confidence,
          evidence: result.pattern.evidence || [],
          validations: result.pattern.validations || 0,
          niches: result.pattern.niches || [],
          metrics: result.metrics,
          budget_usage: result.budgetUsage,
          fallback_used: result.fallbackUsed || false,
          created_at: new Date().toISOString()
        });
      
      if (insertError) {
        console.error('Failed to store discovery:', insertError);
        // Don't fail the request just because storage failed
        console.log('Pattern discovery was successful even though storage failed');
      } else {
        console.log('Discovery successfully stored in idea_heist_discoveries table');
      }
    }
    
    // Return the result
    return NextResponse.json({
      success: result.success,
      mode: result.mode,
      fallbackUsed: result.fallbackUsed,
      pattern: result.pattern,
      source_video: (result as any).source_video,
      validation: (result as any).validation,
      debug: (result as any).debug,
      metrics: result.metrics,
      budgetUsage: result.budgetUsage,
      error: result.error,
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    console.error('Agentic analysis error:', error);
    
    return NextResponse.json(
      {
        error: 'Analysis failed',
        details: error instanceof Error ? error.message : String(error)
      },
      { status: 500 }
    );
  }
}

/**
 * GET endpoint to check status
 */
export async function GET(request: NextRequest) {
  return NextResponse.json({
    status: 'ready',
    openaiConfigured: isOpenAIConfigured(),
    pineconeConfigured: Boolean(process.env.PINECONE_API_KEY),
    supabaseConfigured: Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL),
    version: '1.0.0',
    capabilities: {
      tools: 18,
      models: ['gpt-5', 'gpt-5-mini', 'gpt-5-nano'],
      modes: ['agentic', 'classic'],
      maxConcurrentSessions: 10
    }
  });
}