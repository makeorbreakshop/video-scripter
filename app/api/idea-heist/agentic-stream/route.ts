/**
 * Streaming API endpoint for Idea Heist Agentic Mode
 * Streams debug information and results in real-time
 */

import { NextRequest } from 'next/server';
import { runIdeaHeistAgent } from '@/lib/agentic/orchestrator/idea-heist-agent';
import { createClient } from '@supabase/supabase-js';
import { isOpenAIConfigured } from '@/lib/agentic/openai-integration';

export async function POST(request: NextRequest) {
  // Set up streaming response
  const encoder = new TextEncoder();
  const stream = new TransformStream();
  const writer = stream.writable.getWriter();
  
  // Start processing in background
  (async () => {
    try {
      // Parse request body
      const body = await request.json();
      const { videoId, mode = 'agentic', options = {} } = body;
      
      if (!videoId) {
        await writer.write(encoder.encode(`data: ${JSON.stringify({ 
          type: 'error', 
          message: 'Video ID is required' 
        })}\n\n`));
        await writer.close();
        return;
      }
      
      // Send initial message
      await writer.write(encoder.encode(`data: ${JSON.stringify({ 
        type: 'status', 
        message: 'Starting agentic analysis...',
        videoId 
      })}\n\n`));
      
      // Check if OpenAI is configured
      if (!isOpenAIConfigured()) {
        await writer.write(encoder.encode(`data: ${JSON.stringify({ 
          type: 'warning', 
          message: 'OpenAI API key not configured, using mock mode' 
        })}\n\n`));
      }
      
      // Get Supabase client
      const supabase = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY!
      );
      
      // Check if video exists
      const { data: video, error: videoError } = await supabase
        .from('videos')
        .select('id, title, channel_id')
        .eq('id', videoId)
        .single();
      
      if (videoError || !video) {
        await writer.write(encoder.encode(`data: ${JSON.stringify({ 
          type: 'error', 
          message: 'Video not found',
          details: videoError?.message 
        })}\n\n`));
        await writer.close();
        return;
      }
      
      await writer.write(encoder.encode(`data: ${JSON.stringify({ 
        type: 'info', 
        message: `Found video: ${video.title}` 
      })}\n\n`));
      
      // Create a custom logger that streams debug info
      const streamingLogger = {
        log: (message: string, data?: any) => {
          console.log(message, data);
          
          // Stream OpenAI reasoning and tool calls
          if (message.includes('OpenAI') || message.includes('Tool') || message.includes('Turn')) {
            writer.write(encoder.encode(`data: ${JSON.stringify({ 
              type: 'debug', 
              message,
              data,
              timestamp: new Date().toISOString()
            })}\n\n`)).catch(console.error);
          }
        },
        error: (message: string, error?: any) => {
          console.error(message, error);
          writer.write(encoder.encode(`data: ${JSON.stringify({ 
            type: 'error', 
            message,
            error: error?.message || error,
            timestamp: new Date().toISOString()
          })}\n\n`)).catch(console.error);
        }
      };
      
      // Intercept console.log temporarily to capture debug output
      const originalConsoleLog = console.log;
      const originalConsoleError = console.error;
      
      console.log = (...args) => {
        originalConsoleLog(...args);
        
        // Stream relevant debug info
        const message = args.join(' ');
        if (message.includes('🤖') || message.includes('🧠') || 
            message.includes('🔍') || message.includes('✅') || 
            message.includes('❌') || message.includes('💡') || 
            message.includes('📊') || message.includes('🎯') ||
            message.includes('Turn') || message.includes('Tool')) {
          writer.write(encoder.encode(`data: ${JSON.stringify({ 
            type: 'reasoning', 
            message,
            timestamp: new Date().toISOString()
          })}\n\n`)).catch(() => {});
        }
      };
      
      console.error = (...args) => {
        originalConsoleError(...args);
        writer.write(encoder.encode(`data: ${JSON.stringify({ 
          type: 'error', 
          message: args.join(' '),
          timestamp: new Date().toISOString()
        })}\n\n`)).catch(() => {});
      };
      
      // Run the agentic analysis
      await writer.write(encoder.encode(`data: ${JSON.stringify({ 
        type: 'status', 
        message: 'Running agentic analysis pipeline...' 
      })}\n\n`));
      
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
      
      // Restore original console functions
      console.log = originalConsoleLog;
      console.error = originalConsoleError;
      
      // Send the final result
      await writer.write(encoder.encode(`data: ${JSON.stringify({ 
        type: 'result',
        success: result.success,
        mode: result.mode,
        fallbackUsed: result.fallbackUsed,
        pattern: result.pattern,
        source_video: result.source_video,
        validation: result.validation,
        debug: result.debug,
        metrics: result.metrics,
        budgetUsage: result.budgetUsage,
        error: result.error,
        timestamp: new Date().toISOString()
      })}\n\n`));
      
      // Store the result in the database if successful
      if (result.success && result.pattern) {
        const { error: insertError } = await supabase
          .from('idea_heist_discoveries')
          .insert({
            video_id: videoId,
            discovery_mode: result.mode,
            pattern_statement: result.pattern.pattern_name || result.pattern.statement,
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
          await writer.write(encoder.encode(`data: ${JSON.stringify({ 
            type: 'warning', 
            message: 'Failed to store discovery in database',
            error: insertError.message 
          })}\n\n`));
        } else {
          await writer.write(encoder.encode(`data: ${JSON.stringify({ 
            type: 'success', 
            message: 'Discovery stored in database' 
          })}\n\n`));
        }
      }
      
      // Send completion message
      await writer.write(encoder.encode(`data: ${JSON.stringify({ 
        type: 'complete',
        message: 'Analysis complete',
        success: result.success
      })}\n\n`));
      
    } catch (error) {
      console.error('Streaming error:', error);
      await writer.write(encoder.encode(`data: ${JSON.stringify({ 
        type: 'error',
        message: 'Analysis failed',
        error: error instanceof Error ? error.message : String(error)
      })}\n\n`));
    } finally {
      await writer.close();
    }
  })();
  
  // Return the streaming response
  return new Response(stream.readable, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    },
  });
}