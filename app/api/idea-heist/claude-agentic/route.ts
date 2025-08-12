/**
 * Claude-based Agentic Mode API Endpoint
 * Uses Anthropic's Claude models instead of OpenAI
 */

import { NextRequest, NextResponse } from 'next/server';
import { executeClaudeAgenticAnalysis } from '@/lib/agentic/claude-orchestrator';
import { isClaudeConfigured } from '@/lib/agentic/claude-integration';
import { createClient } from '@supabase/supabase-js';

export async function POST(request: NextRequest) {
  const startTime = Date.now();
  
  try {
    // Check if Claude is configured
    if (!isClaudeConfigured()) {
      return NextResponse.json(
        { 
          success: false, 
          error: 'Claude API key not configured. Please set ANTHROPIC_API_KEY environment variable.',
          mode: 'error'
        },
        { status: 500 }
      );
    }
    
    const { videoId, options = {} } = await request.json();
    
    if (!videoId) {
      return NextResponse.json(
        { 
          success: false, 
          error: 'videoId is required',
          mode: 'error'
        },
        { status: 400 }
      );
    }
    
    console.log(`[🎯 Claude Agentic API] Starting analysis for video: ${videoId}`);
    console.log(`[🎯 Claude Agentic API] Options:`, options);
    
    // Set reasonable defaults
    const agenticOptions = {
      maxFanouts: 2,
      maxValidations: 10,
      maxCandidates: 50,
      maxTokens: 15000,
      maxDurationMs: 90000, // 90 seconds
      fallbackToClassic: true,
      ...options
    };
    
    // Execute the Claude-based agentic analysis
    const result = await executeClaudeAgenticAnalysis(videoId, agenticOptions);
    
    const executionTime = Date.now() - startTime;
    
    // Add execution time to metrics
    if (result.metrics) {
      result.metrics.executionTimeMs = executionTime;
    }
    
    // Store the result in the database if successful
    if (result.success && result.pattern) {
      try {
        const supabase = createClient(
          process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL!,
          process.env.SUPABASE_SERVICE_ROLE_KEY!
        );
        
        const { error: insertError } = await supabase
          .from('idea_heist_discoveries')
          .insert({
            video_id: videoId,
            discovery_mode: 'agentic',
            pattern_statement: result.pattern.primaryPattern?.statement || result.pattern.statement,
            confidence: result.pattern.primaryPattern?.confidence || result.pattern.confidence || 0.5,
            evidence: result.pattern.primaryPattern?.evidence || result.pattern.evidence || [],
            validations: result.pattern.primaryPattern?.validations || 0,
            niches: result.pattern.primaryPattern?.niches || [],
            hypothesis: result.pattern.hypothesis || null,
            search_results: result.pattern.searchResults || null,
            validation_results: result.pattern.validationResults || null,
            metrics: result.metrics,
            budget_usage: result.pattern.metadata || {},
            fallback_used: result.fallbackUsed || false,
            created_at: new Date().toISOString()
          });
        
        if (insertError) {
          console.error('[💾 Claude Database] Failed to store discovery:', insertError);
          // Don't fail the request just because storage failed
        } else {
          console.log('[💾 Claude Database] Discovery successfully stored in idea_heist_discoveries table');
        }
      } catch (dbError) {
        console.error('[💾 Claude Database] Database operation failed:', dbError);
      }
    }
    
    // Log the result summary
    console.log(`[🎯 Claude Agentic API] Analysis completed:`, {
      success: result.success,
      mode: result.mode,
      fallbackUsed: result.fallbackUsed,
      toolCalls: result.metrics?.toolCalls,
      tokensUsed: result.metrics?.tokensUsed,
      executionTimeMs: executionTime,
      hasPattern: !!result.pattern,
      savedToDatabase: result.success && !!result.pattern
    });
    
    return NextResponse.json(result);
    
  } catch (error) {
    const executionTime = Date.now() - startTime;
    
    console.error('[❌ Claude Agentic API] Execution failed:', error);
    
    return NextResponse.json(
      {
        success: false,
        mode: 'error',
        error: String(error),
        metrics: {
          toolCalls: 0,
          tokensUsed: 0,
          executionTimeMs: executionTime,
          modelSwitches: 0
        }
      },
      { status: 500 }
    );
  }
}

// GET endpoint for testing
export async function GET() {
  return NextResponse.json({
    message: 'Claude Agentic Mode API',
    status: 'active',
    configured: isClaudeConfigured(),
    models: [
      'claude-3-5-sonnet-20241022', // Best for complex reasoning
      'claude-3-5-haiku-20241022'   // Fast for simple tasks
    ],
    capabilities: [
      'Tool use with search, analysis, and data tools',
      'Vision analysis for thumbnails',
      'Multi-turn conversations with context',
      'Hypothesis generation and validation',
      'Pattern discovery and reporting'
    ]
  });
}