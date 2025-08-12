/**
 * Enhanced Streaming API endpoint for Idea Heist Agentic Mode V2
 * Implements OpenAI-suggested streaming approach with real-time updates
 */

import { NextRequest } from 'next/server';
import { IdeaHeistAgent } from '@/lib/agentic/orchestrator/idea-heist-agent';
import { createClient } from '@supabase/supabase-js';
import { isOpenAIConfigured } from '@/lib/agentic/openai-integration';
import { createAgentLogger } from '@/lib/agentic/logger/agent-logger';

export async function POST(request: NextRequest) {
  // Set up streaming response
  const encoder = new TextEncoder();
  const stream = new TransformStream();
  const writer = stream.writable.getWriter();
  
  // Start processing in background
  (async () => {
    let logger: any = null;
    
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
      
      // Send initial status
      await writer.write(encoder.encode(`data: ${JSON.stringify({ 
        type: 'status', 
        message: 'Initializing agent...',
        videoId,
        timestamp: new Date().toISOString()
      })}\n\n`));
      
      // Check configuration
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
      
      // Verify video exists
      const { data: video, error: videoError } = await supabase
        .from('videos')
        .select('id, title, channel_id, channel_name, view_count, temporal_performance_score')
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
      
      // Send video info
      await writer.write(encoder.encode(`data: ${JSON.stringify({ 
        type: 'video_found', 
        video: {
          title: video.title,
          channel: video.channel_name,
          views: video.view_count,
          performance: video.temporal_performance_score
        }
      })}\n\n`));
      
      // Create logger with streaming support
      logger = createAgentLogger(videoId);
      
      // Set up log streaming
      logger.on('log', (entry: any) => {
        // Stream different types of logs
        if (entry.level === 'reasoning') {
          writer.write(encoder.encode(`data: ${JSON.stringify({ 
            type: 'reasoning',
            message: entry.message,
            data: entry.data,
            timestamp: entry.timestamp
          })}\n\n`)).catch(() => {});
        } else if (entry.level === 'tool') {
          writer.write(encoder.encode(`data: ${JSON.stringify({ 
            type: 'tool_call',
            tool: entry.data?.toolName,
            params: entry.data?.params,
            success: entry.data?.success,
            timestamp: entry.timestamp
          })}\n\n`)).catch(() => {});
        } else if (entry.level === 'model') {
          writer.write(encoder.encode(`data: ${JSON.stringify({ 
            type: 'model_call',
            model: entry.data?.model,
            tokens: entry.data?.tokens,
            cost: entry.data?.cost,
            timestamp: entry.timestamp
          })}\n\n`)).catch(() => {});
        } else if (entry.category === 'orchestrator') {
          writer.write(encoder.encode(`data: ${JSON.stringify({ 
            type: 'progress',
            message: entry.message,
            turnNumber: entry.data?.turnNumber,
            turnType: entry.data?.turnType,
            timestamp: entry.timestamp
          })}\n\n`)).catch(() => {});
        }
      });
      
      // Send task board initialization
      await writer.write(encoder.encode(`data: ${JSON.stringify({ 
        type: 'task_board',
        tasks: [
          { id: 'context', name: 'Context Gathering', status: 'pending' },
          { id: 'hypothesis', name: 'Hypothesis Generation', status: 'pending' },
          { id: 'search', name: 'Search Planning', status: 'pending' },
          { id: 'enrichment', name: 'Data Enrichment', status: 'pending' },
          { id: 'validation', name: 'Pattern Validation', status: 'pending' },
          { id: 'finalization', name: 'Report Generation', status: 'pending' }
        ]
      })}\n\n`));
      
      // Create and run agent with the shared logger
      const agent = new IdeaHeistAgent({
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
      }, logger); // Pass the logger to the agent
      
      // Update task board as turns progress
      logger.on('log', (entry: any) => {
        if (entry.message?.includes('Executing turn:')) {
          const turnType = entry.data?.turnType;
          const taskMap: Record<string, string> = {
            'context_gathering': 'context',
            'hypothesis_generation': 'hypothesis',
            'search_planning': 'search',
            'enrichment': 'enrichment',
            'validation': 'validation',
            'finalization': 'finalization'
          };
          
          const taskId = taskMap[turnType];
          if (taskId) {
            writer.write(encoder.encode(`data: ${JSON.stringify({ 
              type: 'task_update',
              taskId,
              status: 'running'
            })}\n\n`)).catch(() => {});
          }
        } else if (entry.message?.includes('complete')) {
          const turnType = entry.data?.turnType;
          const taskMap: Record<string, string> = {
            'context_gathering': 'context',
            'hypothesis_generation': 'hypothesis',
            'search_planning': 'search',
            'enrichment': 'enrichment',
            'validation': 'validation',
            'finalization': 'finalization'
          };
          
          const taskId = taskMap[turnType];
          if (taskId) {
            writer.write(encoder.encode(`data: ${JSON.stringify({ 
              type: 'task_update',
              taskId,
              status: 'complete',
              metrics: {
                tokens: entry.data?.tokensUsed,
                duration: entry.data?.durationMs,
                cost: entry.data?.cost
              }
            })}\n\n`)).catch(() => {});
          }
        }
      });
      
      // Run the analysis
      await writer.write(encoder.encode(`data: ${JSON.stringify({ 
        type: 'status',
        message: 'Starting agentic analysis...'
      })}\n\n`));
      
      const result = await agent.runIdeaHeistAgent(videoId);
      
      // Send running metrics footer
      await writer.write(encoder.encode(`data: ${JSON.stringify({ 
        type: 'metrics_footer',
        totalTools: result.budgetUsage?.toolCalls || 0,
        totalTokens: result.budgetUsage?.tokens || 0,
        totalCost: result.budgetUsage?.totalCost || 0,
        duration: result.metrics?.totalDuration || 0
      })}\n\n`));
      
      // Store result in database if successful
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
            hypothesis: result.debug?.hypothesis,
            search_results: result.debug?.searchResults,
            validation_results: result.debug?.validationResults,
            metrics: result.metrics,
            budget_usage: result.budgetUsage,
            fallback_used: result.fallbackUsed || false,
            created_at: new Date().toISOString()
          });
        
        if (insertError) {
          console.error('Failed to store discovery:', insertError);
        }
      }
      
      // Send final result with structured format
      const structuredResult = {
        version: "1.0",
        summary_md: result.pattern?.pattern_name || result.pattern?.statement || "",
        blocks: [
          {
            type: "TITLE_PATTERNS",
            data: { 
              patterns: result.pattern?.evidence?.filter((e: any) => e.type === 'title') || []
            }
          },
          {
            type: "THUMB_PATTERNS",
            data: { 
              patterns: result.pattern?.evidence?.filter((e: any) => e.type === 'thumbnail') || []
            }
          },
          {
            type: "OUTLIERS",
            data: { 
              videos: result.validation?.results?.flatMap((r: any) => r.videos) || []
            }
          },
          {
            type: "CHECKLIST",
            data: {
              items: result.debug?.recommendations || []
            }
          }
        ],
        source_ids: result.pattern?.evidence?.map((e: any) => `yt:${e.videoId}`) || [],
        meta: {
          run_time_ms: result.metrics?.totalDuration || 0,
          tools_used: ["db", "pinecone", "youtube"],
          total_tokens: result.budgetUsage?.tokens || 0,
          total_cost: result.budgetUsage?.totalCost || 0,
          log_file: logger?.getLogFilePath()
        }
      };
      
      await writer.write(encoder.encode(`data: ${JSON.stringify({ 
        type: 'complete',
        result: structuredResult,
        success: result.success,
        mode: result.mode,
        pattern: result.pattern,
        source_video: result.source_video,
        validation: result.validation,
        debug: result.debug,
        metrics: result.metrics,
        budgetUsage: result.budgetUsage,
        logFile: logger?.getLogFilePath()
      })}\n\n`));
      
      // Close stream
      await writer.close();
      
    } catch (error) {
      console.error('Streaming error:', error);
      
      await writer.write(encoder.encode(`data: ${JSON.stringify({ 
        type: 'error',
        message: 'Analysis failed',
        error: error instanceof Error ? error.message : String(error)
      })}\n\n`));
      
      await writer.close();
      
    } finally {
      // Complete logger if exists
      if (logger) {
        console.log(`📝 Agent logs saved to: ${logger.getLogFilePath()}`);
      }
    }
  })();
  
  // Return streaming response
  return new Response(stream.readable, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    },
  });
}

/**
 * GET endpoint to check status
 */
export async function GET(request: NextRequest) {
  return new Response(JSON.stringify({
    status: 'ready',
    version: '2.0.0',
    features: [
      'Real-time streaming',
      'Task board visualization', 
      'Structured output format',
      'Comprehensive logging',
      'Error resilience'
    ],
    openaiConfigured: isOpenAIConfigured(),
    capabilities: {
      tools: 18,
      models: ['gpt-5', 'gpt-5-mini', 'gpt-5-nano'],
      modes: ['agentic', 'classic'],
      streaming: true,
      logging: true
    }
  }), {
    headers: { 'Content-Type': 'application/json' }
  });
}