/**
 * Streaming API endpoint for Idea Heist Agentic Mode
 * Returns Server-Sent Events (SSE) for real-time progress updates
 */

import { NextRequest } from 'next/server';
import { runIdeaHeistAgent } from '@/lib/agentic/orchestrator/idea-heist-agent';
import { getSupabase } from '@/lib/supabase-lazy';
import { isOpenAIConfigured } from '@/lib/agentic/openai-integration';

export async function POST(request: NextRequest) {
  const supabase = getSupabase();
  try {
    // Parse request body
    const body = await request.json();
    const { videoId, mode = 'agentic', options = {} } = body;
    
    if (!videoId) {
      return new Response('Video ID is required', { status: 400 });
    }
    
    // Check if OpenAI is configured
    if (!isOpenAIConfigured()) {
      return new Response('OpenAI API key not configured', { status: 500 });
    }
    
    // Get Supabase client
    
    // Check if video exists
    const { data: video, error: videoError } = await supabase
      .from('videos')
      .select('id, title, channel_id')
      .eq('id', videoId)
      .single();
    
    if (videoError || !video) {
      return new Response('Video not found', { status: 404 });
    }
    
    // Create SSE stream
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      start(controller) {
        // Send initial event
        const initialData = JSON.stringify({
          type: 'start',
          message: `Starting agentic analysis for video ${videoId}`,
          videoId,
          timestamp: new Date().toISOString()
        });
        controller.enqueue(encoder.encode(`data: ${initialData}\n\n`));
        
        // Run agentic analysis with streaming callbacks
        runIdeaHeistAgent(videoId, {
          mode,
          budget: {
            maxFanouts: options.maxFanouts || 1,
            maxValidations: options.maxValidations || 10,
            maxCandidates: options.maxCandidates || 120,
            maxTokens: options.maxTokens || 20000,
            maxDurationMs: options.maxDurationMs || 30000,
            maxToolCalls: options.maxToolCalls || 15
          },
          timeoutMs: options.timeoutMs || 30000,
          retryAttempts: options.retryAttempts || 2,
          fallbackToClassic: options.fallbackToClassic !== false,
          parallelExecution: options.parallelExecution !== false,
          cacheResults: options.cacheResults !== false,
          telemetryEnabled: options.telemetryEnabled !== false,
          // Streaming callbacks
          onTurnStart: (turnType: string) => {
            const data = JSON.stringify({
              type: 'turn_start',
              turnType,
              message: `Starting ${turnType} phase`,
              timestamp: new Date().toISOString()
            });
            controller.enqueue(encoder.encode(`data: ${data}\n\n`));
          },
          onStreamingText: (text: string, turnType: string) => {
            const data = JSON.stringify({
              type: 'streaming_text',
              text,
              turnType,
              timestamp: new Date().toISOString()
            });
            controller.enqueue(encoder.encode(`data: ${data}\n\n`));
          },
          onTurnComplete: (turnType: string, result: any) => {
            const data = JSON.stringify({
              type: 'turn_complete',
              turnType,
              result,
              timestamp: new Date().toISOString()
            });
            controller.enqueue(encoder.encode(`data: ${data}\n\n`));
          }
        }).then(result => {
          // Send final result
          const finalData = JSON.stringify({
            type: 'complete',
            result,
            timestamp: new Date().toISOString()
          });
          controller.enqueue(encoder.encode(`data: ${finalData}\n\n`));
          controller.close();
        }).catch(error => {
          // Send error
          const errorData = JSON.stringify({
            type: 'error',
            error: error.message,
            timestamp: new Date().toISOString()
          });
          controller.enqueue(encoder.encode(`data: ${errorData}\n\n`));
          controller.close();
        });
      }
    });
    
    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST',
        'Access-Control-Allow-Headers': 'Content-Type',
      },
    });
    
  } catch (error) {
    console.error('Streaming agentic analysis error:', error);
    return new Response(
      'Analysis failed',
      { status: 500 }
    );
  }
}