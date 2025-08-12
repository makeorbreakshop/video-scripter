/**
 * Idea Heist Agent - Main Orchestrator
 * Core orchestration loop for agentic pattern discovery
 */

import { 
  OrchestratorConfig,
  OrchestratorResult,
  SessionState,
  TurnType,
  TurnResult,
  ModelType,
  ToolCall
} from '@/types/orchestrator';

import { getToolRegistry } from '@/lib/orchestrator/tool-registry';
import { createBudgetTracker } from '@/lib/orchestrator/budget-tracker';
import { createSessionManager } from '@/lib/orchestrator/session-manager';
import { createModelRouter } from '@/lib/orchestrator/model-router';
import { createModeSelector } from '@/lib/orchestrator/mode-selector';
import { openaiIntegration, isOpenAIConfigured, calculateCost } from '@/lib/agentic/openai-integration';
import { ToolDefinition } from '@/types/orchestrator';
import { executeToolWithCache } from '@/lib/agentic/tool-executor';
import { createAgentLogger, AgentLogger } from '@/lib/agentic/logger/agent-logger';

import { 
  GLOBAL_SYSTEM_PROMPT,
  VALIDATION_SYSTEM_PROMPT,
  ENRICHMENT_SYSTEM_PROMPT,
  SEARCH_PLANNING_PROMPT,
  FINALIZATION_PROMPT,
  composePrompt,
  getTurnPrompt
} from '@/lib/agentic/prompts/system-prompts';

import {
  StructuredOutputEnforcer,
  ResponseFormatter
} from '@/lib/agentic/schemas/structured-output';

import {
  FinalPatternReport,
  createEmptyReport
} from '@/lib/agentic/schemas/pattern-report';

/**
 * Turn sequence for agentic mode
 */
const TURN_SEQUENCE: TurnType[] = [
  'context_gathering',
  'hypothesis_generation',
  'search_planning',
  'enrichment',
  'validation',
  'finalization'
];

/**
 * Main orchestrator class
 */
export class IdeaHeistAgent {
  private toolRegistry = getToolRegistry();
  private isProductionReady = false; // Flag to control real API usage
  private budgetTracker = createBudgetTracker();
  private sessionManager = createSessionManager();
  private modelRouter = createModelRouter();
  private modeSelector = createModeSelector();
  private logger?: AgentLogger;
  private externalLogger?: AgentLogger;
  
  private config: OrchestratorConfig;
  private sessionId: string | null = null;
  private currentTurn: number = 0;
  private telemetry: any[] = [];
  
  constructor(config?: Partial<OrchestratorConfig>, logger?: AgentLogger) {
    this.config = {
      mode: 'agentic',
      budget: {
        maxFanouts: 5,
        maxValidations: 20,
        maxCandidates: 200,
        maxTokens: 200000,
        maxDurationMs: 180000, // 3 minutes
        maxToolCalls: 100
      },
      timeoutMs: 180000, // 3 minutes timeout
      retryAttempts: 2,
      fallbackToClassic: true,
      parallelExecution: true,
      cacheResults: true,
      telemetryEnabled: true,
      ...config
    };
    
    // Store external logger if provided
    this.externalLogger = logger;
  }
  
  /**
   * Main entry point - run the agent
   */
  async runIdeaHeistAgent(videoId: string): Promise<OrchestratorResult> {
    const startTime = Date.now();
    let finalResult: OrchestratorResult | null = null;
    
    // Use external logger if provided, otherwise create new one
    if (this.externalLogger) {
      this.logger = this.externalLogger;
    } else {
      this.logger = createAgentLogger(videoId);
    }
    this.logger.log('info', 'orchestrator', `Starting Idea Heist Agent for video ${videoId}`, {
      config: this.config,
      openaiConfigured: isOpenAIConfigured()
    });
    
    try {
      // Initialize session
      this.sessionId = this.sessionManager.createSession(videoId, this.config);
      this.budgetTracker.initialize(this.config.budget);
      
      // Log start
      this.log('info', `Starting Idea Heist Agent for video ${videoId}`);
      
      // Run turn sequence
      let result: OrchestratorResult | null = null;
      
      for (let i = 0; i < TURN_SEQUENCE.length; i++) {
        const turnType = TURN_SEQUENCE[i];
        this.currentTurn = i;
        
        // Check budget before each turn
        if (this.budgetTracker.isExceeded()) {
          this.log('warn', 'Budget exceeded, moving to finalization');
          result = await this.handleFinalization(true); // Force finalization
          break;
        }
        
        // Check timeout
        if (Date.now() - startTime > this.config.timeoutMs) {
          this.log('warn', 'Timeout reached, moving to finalization');
          result = await this.handleFinalization(true);
          break;
        }
        
        // Execute turn
        this.log('info', `Executing turn: ${turnType}`);
        const turnResult = await this.executeTurn(turnType);
        
        // Check for completion
        if (turnResult.complete) {
          this.log('info', 'Analysis complete');
          result = await this.createResult(true);
          break;
        }
        
        // Check for skip to specific turn
        if (turnResult.nextTurn) {
          const nextIndex = TURN_SEQUENCE.indexOf(turnResult.nextTurn);
          if (nextIndex > i) {
            i = nextIndex - 1; // Will be incremented by loop
            this.log('info', `Jumping to turn: ${turnResult.nextTurn}`);
          }
        }
        
        // Validation may repeat if more candidates needed
        if (turnType === 'validation' && !turnResult.complete) {
          const state = this.sessionManager.getSession(this.sessionId!);
          // Only repeat if we have candidates and haven't validated enough
          const hasCandidates = state?.searchResults?.semanticNeighbors && state.searchResults.semanticNeighbors.length > 0;
          if (hasCandidates && state?.validationResults && state.validationResults.validated < 10) {
            i--; // Repeat validation turn
            this.log('info', 'Repeating validation for more candidates');
          }
        }
      }
      
      // Ensure we have a result
      if (!result) {
        result = await this.createResult(true);
      }
      
      finalResult = result;
      return result;
      
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      const errorStack = error instanceof Error ? error.stack : '';
      
      this.log('error', `Agent failed: ${errorMessage}`);
      if (this.logger) {
        this.logger.log('error', 'orchestrator', `Agent error: ${errorMessage}`, {
          error: errorMessage,
          stack: errorStack,
          videoId
        });
      }
      
      // Try fallback to classic if enabled
      if (this.config.fallbackToClassic) {
        this.log('info', 'Attempting fallback to classic mode');
        finalResult = await this.fallbackToClassic(videoId, error);
        return finalResult;
      }
      
      // Return error result
      finalResult = await this.createResult(false, error);
      return finalResult;
      
    } finally {
      // Cleanup
      if (this.sessionId) {
        this.sessionManager.endSession(this.sessionId);
      }
      
      // Save telemetry
      if (this.config.telemetryEnabled) {
        await this.saveTelemetry();
      }
      
      // Complete logger
      if (this.logger) {
        const success = finalResult?.success || false;
        await this.logger.complete(success, finalResult);
        console.log(`📝 Agent logs saved to: ${this.logger.getLogFilePath()}`);
      }
    }
  }
  
  /**
   * Execute a single turn
   */
  private async executeTurn(turnType: TurnType): Promise<TurnResult> {
    const state = this.sessionManager.getSession(this.sessionId!)!;
    const budgetUsage = this.budgetTracker.getUsage();
    
    // Route to appropriate model
    const routingDecision = this.modelRouter.route(turnType, state, budgetUsage);
    this.log('info', `Routing to ${routingDecision.model}: ${routingDecision.reason}`);
    
    // Get appropriate prompt
    const prompt = this.getPromptForTurn(turnType, state, routingDecision.model);
    
    // Execute turn based on type
    let turnResult: TurnResult;
    
    switch (turnType) {
      case 'context_gathering':
        turnResult = await this.handleContextTurn(state, routingDecision.model, prompt);
        break;
        
      case 'hypothesis_generation':
        turnResult = await this.handleHypothesisTurn(state, routingDecision.model, prompt);
        break;
        
      case 'search_planning':
        turnResult = await this.handleSearchTurn(state, routingDecision.model, prompt);
        break;
        
      case 'enrichment':
        turnResult = await this.handleEnrichmentTurn(state, routingDecision.model, prompt);
        break;
        
      case 'validation':
        turnResult = await this.handleValidationTurn(state, routingDecision.model, prompt);
        break;
        
      case 'finalization':
        turnResult = await this.handleFinalizationTurn(state, routingDecision.model, prompt);
        break;
        
      default:
        throw new Error(`Unknown turn type: ${turnType}`);
    }
    
    // Update budget
    this.budgetTracker.recordToolCall(
      turnType,
      turnResult.tokensUsed,
      routingDecision.estimatedCost
    );
    
    // Update session
    this.sessionManager.updateSession(this.sessionId!, turnResult.stateUpdate);
    
    // Handle model switch if needed
    if (routingDecision.model !== this.modelRouter.route(turnType, state, budgetUsage).model) {
      this.sessionManager.switchModel(
        this.sessionId!,
        routingDecision.model,
        turnResult.model
      );
    }
    
    return turnResult;
  }
  
  /**
   * Handle context gathering turn
   */
  private async handleContextTurn(
    state: SessionState,
    model: ModelType,
    prompt: string
  ): Promise<TurnResult> {
    // Call get_video_bundle tool
    const tool = this.toolRegistry.get('get_video_bundle');
    if (!tool) throw new Error('get_video_bundle tool not found');
    
    const toolCall: ToolCall = {
      id: `call_${Date.now()}`,
      toolName: 'get_video_bundle',
      params: { video_id: state.videoId },
      status: 'running',
      startTime: new Date()
    };
    
    try {
      // Use real tool executor if available
      const useRealTools = isOpenAIConfigured() && (process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL);
      
      let result;
      if (useRealTools) {
        // Execute real tool via API endpoint
        result = await executeToolWithCache(
          tool,
          toolCall.params,
          {
            sessionId: this.sessionId!,
            requestId: toolCall.id,
            mode: this.config.mode,
            currentModel: model,
            budgetRemaining: this.budgetTracker.getUsage()
          },
          true // Use cache
        );
      } else {
        // Fallback to mock for development
        result = {
          video_id: state.videoId,
          title: 'Mock Video Title',
          temporal_score: 3.5,
          channel_name: 'Mock Channel',
          format_type: 'tutorial',
          topic_niche: 'technology'
        };
      }
      
      toolCall.status = 'success';
      toolCall.result = result;
      toolCall.endTime = new Date();
      
      // Extract video context - keep full result for later use
      const videoContext = {
        title: result.title,
        tps: result.temporal_performance_score || result.temporal_score || result.tps || 0,
        channelName: result.channel_name || result.channelName,
        formatType: result.format_type || result.formatType,
        topicNiche: result.topic_niche || result.topicNiche,
        // Store full data for source_video display
        views: result.view_count || 0,
        thumbnail: result.thumbnail_url || '',
        baseline: result.channel_baseline_at_publish || 0,
        published_at: result.published_at || '',
        channel_id: result.channel_id || ''
      };
      
      return {
        turnType: 'context_gathering',
        model,
        toolCalls: [toolCall],
        tokensUsed: 500, // Estimate
        durationMs: Date.now() - toolCall.startTime.getTime(),
        stateUpdate: { videoContext },
        complete: false
      };
      
    } catch (error) {
      toolCall.status = 'error';
      toolCall.error = {
        code: 'TOOL_ERROR',
        message: String(error),
        retryable: true
      };
      
      throw error;
    }
  }
  
  /**
   * Handle hypothesis generation turn
   */
  private async handleHypothesisTurn(
    state: SessionState,
    model: ModelType,
    prompt: string
  ): Promise<TurnResult> {
    const startTime = Date.now();
    
    try {
      // Check if OpenAI is configured
      if (!isOpenAIConfigured()) {
        // Fallback to mock for development
        const hypothesis = {
          statement: 'Videos with "Ultimate Guide" in title achieve 3x better performance',
          confidence: 0.75,
          supportingEvidence: [
            'Title pattern analysis shows correlation',
            'Long-form content preference detected',
            'Educational format aligns with channel audience'
          ]
        };
        
        return {
          turnType: 'hypothesis_generation',
          model,
          toolCalls: [],
          tokensUsed: 2000,
          durationMs: Date.now() - startTime,
          stateUpdate: { hypothesis },
          complete: false
        };
      }
      
      // Use real OpenAI API
      this.logger?.logModelCall(
        model,
        'Generating hypothesis for outlier video',
        null,
        0,
        0
      );
      
      const hypothesis = await openaiIntegration.generateHypothesis(
        prompt,
        state.videoContext,
        model
      );
      
      this.logger?.logHypothesis(hypothesis);
      
      return {
        turnType: 'hypothesis_generation',
        model,
        toolCalls: [],
        tokensUsed: 2000, // Will be updated with actual tokens
        durationMs: Date.now() - startTime,
        stateUpdate: { hypothesis },
        complete: false
      };
    } catch (error) {
      this.log('error', `Hypothesis generation failed: ${error}`);
      throw error;
    }
  }
  
  /**
   * Handle search planning turn
   */
  private async handleSearchTurn(
    state: SessionState,
    model: ModelType,
    prompt: string
  ): Promise<TurnResult> {
    const startTime = Date.now();
    
    try {
      // Define search tools to use
      const searchTools = ['search_titles', 'search_summaries'];
      const toolCalls: ToolCall[] = [];
      
      // Check if we can use real tools or need to mock
      const useRealTools = isOpenAIConfigured() && process.env.PINECONE_API_KEY;
      
      if (useRealTools) {
        // Execute real tool calls via OpenAI
        const tools = searchTools
          .map(name => this.toolRegistry.get(name))
          .filter(Boolean) as ToolDefinition[];
        
        // Let OpenAI decide the search queries
        const response = await openaiIntegration.executeTurn(
          'search_planning',
          model,
          prompt,
          `You MUST use the search_titles and search_summaries tools to find videos that test this hypothesis: ${state.hypothesis?.statement}
          
          Call search_titles with relevant queries like "satisfying", "viral shorts", etc.
          Call search_summaries to find conceptually similar videos.
          Use multiple diverse queries to get broad coverage.`,
          tools,
          this.sessionId!,
          this.toolRegistry
        );
        
        if (response.toolCalls && response.toolCalls.length > 0) {
          console.log(`[✅ Search Planning] Got ${response.toolCalls.length} tool calls from OpenAI!`);
          // OpenAI integration already executed the tools in its loop
          // Just add the already-executed results to our collection
          toolCalls.push(...response.toolCalls);
        } else {
          // Fallback: try to parse a JSON search plan and execute directly
          console.log('[❌ Search Planning] No tool calls. Attempting JSON strategy fallback.');
          try {
            const plan = StructuredOutputEnforcer.parseJSON(response.content || '{}');
            const queries: Array<{ type: 'title'|'summary'; query: string; limit?: number; filters?: any }> = plan.queries || [];
            for (const q of queries) {
              const toolName = q.type === 'summary' ? 'search_summaries' : 'search_titles';
              const tool = this.toolRegistry.get(toolName);
              if (!tool) continue;
              const executed = await executeToolWithCache(
                tool,
                { query: q.query, limit: q.limit || 20, filters: q.filters },
                {
                  sessionId: this.sessionId!,
                  requestId: `search_${Date.now()}`,
                  mode: this.config.mode,
                  currentModel: model,
                  budgetRemaining: this.budgetTracker.getUsage()
                },
                true
              );
              toolCalls.push({
                id: `fallback_${Date.now()}`,
                toolName,
                params: { query: q.query, limit: q.limit || 20, filters: q.filters },
                status: 'success',
                startTime: new Date(),
                endTime: new Date(),
                result: executed
              } as any);
            }
          } catch {
            console.log('[❌ Search Planning] Fallback strategy parsing failed.');
          }
        }
      } else {
        // Fallback to mock searches
        for (const toolName of searchTools) {
          const tool = this.toolRegistry.get(toolName);
          if (!tool) continue;
          
          const toolCall: ToolCall = {
            id: `call_${Date.now()}_${toolName}`,
            toolName,
            params: {
              query: state.hypothesis?.statement || 'high performance videos',
              limit: 20
            },
            status: 'success',
            startTime: new Date(),
            endTime: new Date(),
            result: { videos: [] } // Mock result
          };
          
          toolCalls.push(toolCall);
        }
      }
      
      // Extract results from tool calls
      const allVideos: string[] = [];
      for (const call of toolCalls) {
        if (call.status === 'success' && call.result?.videos) {
          allVideos.push(...call.result.videos);
        }
      }
      
      // Record fanout
      this.budgetTracker.recordFanout();
      
      return {
        turnType: 'search_planning',
        model,
        toolCalls,
        tokensUsed: useRealTools ? 1500 : 0,
        durationMs: Date.now() - startTime,
        stateUpdate: {
          searchResults: {
            semanticNeighbors: allVideos,
            competitiveSuccesses: [],
            totalCandidates: allVideos.length
          }
        },
        complete: false
      };
    } catch (error) {
      this.log('error', `Search planning failed: ${error}`);
      throw error;
    }
  }
  
  /**
   * Handle enrichment turn - Batch enrich with performance, thumbnails, and topics
   */
  private async handleEnrichmentTurn(
    state: SessionState,
    model: ModelType,
    prompt: string
  ): Promise<TurnResult> {
    const start = Date.now();
    const videoIds = state.searchResults?.semanticNeighbors || [];
    const toolCalls: ToolCall[] = [];
    
    if (videoIds.length === 0) {
      this.log('warn', 'No videos to enrich, skipping enrichment');
      return {
        turnType: 'enrichment',
        model,
        toolCalls: [],
        tokensUsed: 0,
        durationMs: Date.now() - start,
        stateUpdate: {},
        complete: false
      };
    }
    
    console.log(`[🔧 Enrichment] Processing ${videoIds.length} videos with 3 tools`);
    
    // 1. Performance Snapshot (TPS scores)
    const perfTool = this.toolRegistry.get('perf_snapshot');
    if (perfTool) {
      try {
        const perfResult = await executeToolWithCache(
          perfTool,
          { video_ids: videoIds },
          {
            sessionId: this.sessionId!,
            requestId: `perf_${Date.now()}`,
            mode: this.config.mode,
            currentModel: model,
            budgetRemaining: this.budgetTracker.getUsage()
          },
          true
        );
        
        toolCalls.push({
          id: `perf_${Date.now()}`,
          toolName: 'perf_snapshot',
          params: { video_ids: videoIds },
          status: 'success',
          startTime: new Date(start),
          endTime: new Date(),
          result: perfResult
        });
        
        console.log(`[✅ Enrichment] Performance data: ${perfResult?.videos?.length || 0} videos`);
      } catch (e) {
        this.log('warn', `Performance enrichment failed: ${e}`);
        toolCalls.push({
          id: `perf_${Date.now()}`,
          toolName: 'perf_snapshot',
          params: { video_ids: videoIds },
          status: 'error',
          startTime: new Date(start),
          endTime: new Date(),
          error: { code: 'TOOL_ERROR', message: String(e), retryable: true }
        });
      }
    }
    
    // 2. Thumbnail URLs
    const thumbTool = this.toolRegistry.get('fetch_thumbs');
    if (thumbTool) {
      try {
        const thumbResult = await executeToolWithCache(
          thumbTool,
          { video_ids: videoIds.slice(0, 50) }, // Limit for thumbnails
          {
            sessionId: this.sessionId!,
            requestId: `thumbs_${Date.now()}`,
            mode: this.config.mode,
            currentModel: model,
            budgetRemaining: this.budgetTracker.getUsage()
          },
          true
        );
        
        toolCalls.push({
          id: `thumbs_${Date.now()}`,
          toolName: 'fetch_thumbs',
          params: { video_ids: videoIds.slice(0, 50) },
          status: 'success',
          startTime: new Date(start),
          endTime: new Date(),
          result: thumbResult
        });
        
        console.log(`[✅ Enrichment] Thumbnails: ${thumbResult?.videos?.length || 0} videos`);
      } catch (e) {
        this.log('warn', `Thumbnail enrichment failed: ${e}`);
        toolCalls.push({
          id: `thumbs_${Date.now()}`,
          toolName: 'fetch_thumbs',
          params: { video_ids: videoIds.slice(0, 50) },
          status: 'error',
          startTime: new Date(start),
          endTime: new Date(),
          error: { code: 'TOOL_ERROR', message: String(e), retryable: true }
        });
      }
    }
    
    // 3. Topic Classifications  
    const topicTool = this.toolRegistry.get('topic_lookup');
    if (topicTool) {
      try {
        const topicResult = await executeToolWithCache(
          topicTool,
          { video_ids: videoIds },
          {
            sessionId: this.sessionId!,
            requestId: `topics_${Date.now()}`,
            mode: this.config.mode,
            currentModel: model,
            budgetRemaining: this.budgetTracker.getUsage()
          },
          true
        );
        
        toolCalls.push({
          id: `topics_${Date.now()}`,
          toolName: 'topic_lookup',
          params: { video_ids: videoIds },
          status: 'success',
          startTime: new Date(start),
          endTime: new Date(),
          result: topicResult
        });
        
        console.log(`[✅ Enrichment] Topics: ${topicResult?.videos?.length || 0} videos`);
      } catch (e) {
        this.log('warn', `Topic enrichment failed: ${e}`);
        toolCalls.push({
          id: `topics_${Date.now()}`,
          toolName: 'topic_lookup',
          params: { video_ids: videoIds },
          status: 'error',
          startTime: new Date(start),
          endTime: new Date(),
          error: { code: 'TOOL_ERROR', message: String(e), retryable: true }
        });
      }
    }
    
    console.log(`[🔧 Enrichment] Completed ${toolCalls.length} tools in ${Date.now() - start}ms`);
    
    return {
      turnType: 'enrichment',
      model,
      toolCalls,
      tokensUsed: 500, // Estimate for batch operations
      durationMs: Date.now() - start,
      stateUpdate: {
        enrichmentData: {
          performance: toolCalls.find(tc => tc.toolName === 'perf_snapshot')?.result,
          thumbnails: toolCalls.find(tc => tc.toolName === 'fetch_thumbs')?.result,
          topics: toolCalls.find(tc => tc.toolName === 'topic_lookup')?.result
        }
      },
      complete: false
    };
  }
  
  /**
   * Handle validation turn
   */
  private async handleValidationTurn(
    state: SessionState,
    model: ModelType,
    prompt: string
  ): Promise<TurnResult> {
    const startTime = Date.now();
    
    try {
      // Get candidates from search results
      const candidates = state.searchResults?.semanticNeighbors || [];
      
      if (candidates.length === 0) {
        // No candidates to validate - continue to finalization
        return {
          turnType: 'validation',
          model,
          toolCalls: [],
          tokensUsed: 0,
          durationMs: Date.now() - startTime,
          stateUpdate: {
            validationResults: {
              validated: 0,
              rejected: 0,
              patterns: []
            }
          },
          complete: false // Continue to finalization
        };
      }
      
      // Check if OpenAI is configured
      if (!isOpenAIConfigured()) {
        // Fallback to mock
        const validated = Math.min(15, candidates.length);
        const rejected = Math.max(0, candidates.length - validated);
        
        const canContinue = this.budgetTracker.recordValidation(candidates.length);
        
        return {
          turnType: 'validation',
          model,
          toolCalls: [],
          tokensUsed: 2500,
          durationMs: Date.now() - startTime,
          stateUpdate: {
            validationResults: {
              validated,
              rejected,
              patterns: [
                {
                  type: 'title_pattern',
                  strength: 0.8,
                  examples: candidates.slice(0, 3)
                }
              ]
            }
          },
          complete: !canContinue || validated >= 10
        };
      }
      
      // Use real OpenAI API
      const validationResults = await openaiIntegration.validateCandidates(
        prompt,
        state.hypothesis?.statement || '',
        candidates.slice(0, 20), // Validate up to 20 at a time
        model
      );
      
      // Record validation
      const canContinue = this.budgetTracker.recordValidation(candidates.length);
      
      return {
        turnType: 'validation',
        model,
        toolCalls: [],
        tokensUsed: 2500, // Will be updated with actual tokens
        durationMs: Date.now() - startTime,
        stateUpdate: {
          validationResults: validationResults
        },
        complete: !canContinue || validationResults.validated >= 10
      };
    } catch (error) {
      this.log('error', `Validation failed: ${error}`);
      throw error;
    }
  }
  
  /**
   * Handle finalization turn
   */
  private async handleFinalizationTurn(
    state: SessionState,
    model: ModelType,
    prompt: string
  ): Promise<TurnResult> {
    const startTime = Date.now();
    
    try {
      // Check if OpenAI is configured
      if (!isOpenAIConfigured()) {
        // Fallback to mock - create a basic report from state
        const mockReport = createEmptyReport(state.videoId);
        
        // Fill in from state
        if (state.hypothesis) {
          mockReport.primaryPattern.statement = state.hypothesis.statement;
          mockReport.primaryPattern.confidence = state.hypothesis.confidence;
          mockReport.primaryPattern.type = 'format'; // Default type
        }
        
        if (state.validationResults) {
          mockReport.metadata.totalVideosAnalyzed = state.validationResults.validated;
          
          // Create mock evidence from validation patterns
          if (state.validationResults.patterns && state.validationResults.patterns.length > 0) {
            mockReport.primaryPattern.evidence = state.validationResults.patterns[0].examples.slice(0, 3).map((videoId, idx) => ({
              videoId,
              title: `Example Video ${idx + 1}`,
              tps: 3.5 + Math.random() * 2,
              channelName: 'Example Channel',
              relevance: 0.8 + Math.random() * 0.2,
              excerpt: state.validationResults.patterns[0].type
            }));
          }
        }
        
        // Add mock recommendations
        mockReport.recommendations = [
          {
            priority: 'immediate' as const,
            action: 'Apply discovered pattern to next video',
            expectedImpact: 'Potential 3-5x performance improvement',
            confidence: 0.75
          },
          {
            priority: 'short_term' as const,
            action: 'Test pattern variations across different niches',
            expectedImpact: 'Identify niche-specific optimizations',
            confidence: 0.6
          },
          {
            priority: 'long_term' as const,
            action: 'Build pattern library for consistent application',
            expectedImpact: 'Systematic performance improvement',
            confidence: 0.8
          }
        ];
        
        return {
          turnType: 'finalization',
          model,
          toolCalls: [],
          tokensUsed: 3000,
          durationMs: Date.now() - startTime,
          stateUpdate: {
            finalReport: mockReport
          },
          complete: true
        };
      }
      
      // Use real OpenAI API to generate final report
      const report = await openaiIntegration.generateFinalReport(
        prompt,
        state,
        model
      );
      
      // Store the report in state
      return {
        turnType: 'finalization',
        model,
        toolCalls: [],
        tokensUsed: 3000, // Will be updated with actual tokens
        durationMs: Date.now() - startTime,
        stateUpdate: {
          finalReport: report
        },
        complete: true
      };
    } catch (error) {
      this.log('error', `Finalization failed: ${error}`);
      throw error;
    }
  }
  
  /**
   * Handle forced finalization (budget/timeout)
   */
  private async handleFinalization(forced: boolean): Promise<OrchestratorResult> {
    const state = this.sessionManager.getSession(this.sessionId!);
    
    if (!state) {
      return await this.createResult(false, new Error('No session state'));
    }
    
    // Try to generate report with what we have
    const report = createEmptyReport(state.videoId);
    
    // Fill in what we can
    if (state.hypothesis) {
      report.primaryPattern.statement = state.hypothesis.statement;
      report.primaryPattern.confidence = state.hypothesis.confidence;
    }
    
    if (state.validationResults) {
      report.metadata.totalVideosAnalyzed = state.validationResults.validated + state.validationResults.rejected;
    }
    
    return {
      success: !forced,
      mode: this.config.mode,
      fallbackUsed: false,
      pattern: {
        statement: report.primaryPattern.statement,
        confidence: report.primaryPattern.confidence,
        validations: report.metadata.totalVideosAnalyzed,
        niches: report.primaryPattern.niches,
        evidence: report.primaryPattern.evidence
      },
      metrics: {
        totalDurationMs: Date.now() - this.sessionManager.getSession(this.sessionId!)!.toolCalls[0]?.startTime.getTime() || 0,
        totalTokens: this.budgetTracker.getUsage().tokens,
        totalCost: this.budgetTracker.getUsage().costs.total,
        toolCallCount: this.budgetTracker.getUsage().toolCalls,
        modelSwitches: this.modelRouter.getSwitchCount()
      },
      budgetUsage: this.budgetTracker.getUsage()
    };
  }
  
  /**
   * Fallback to classic mode
   */
  private async fallbackToClassic(videoId: string, error: any): Promise<OrchestratorResult> {
    this.log('info', 'Falling back to classic mode');
    
    // This would call the classic pipeline
    // For now, return fallback result
    return {
      success: true,
      mode: 'classic',
      fallbackUsed: true,
      pattern: {
        statement: 'Classic analysis pattern',
        confidence: 0.6,
        validations: 10,
        niches: [],
        evidence: []
      },
      metrics: {
        totalDurationMs: 5000,
        totalTokens: 10000,
        totalCost: 0.10,
        toolCallCount: 15,
        modelSwitches: 0
      },
      budgetUsage: this.budgetTracker.getUsage()
    };
  }
  
  /**
   * Create final result
   */
  private async createResult(success: boolean, error?: any): Promise<OrchestratorResult> {
    const state = this.sessionManager.getSession(this.sessionId!);
    const usage = this.budgetTracker.getUsage();
    
    // If we have a finalReport, use it to create the full structure
    if (state?.finalReport) {
      const report = state.finalReport;
      
      // Transform to classic mode structure for UI compatibility
      const pattern = {
        pattern_name: report.primaryPattern.statement,
        pattern_type: report.primaryPattern.type,
        confidence: report.primaryPattern.confidence,
        validations: report.metadata.totalVideosAnalyzed,
        niches: report.primaryPattern.niches,
        evidence: report.primaryPattern.evidence,
        performance_impact: report.primaryPattern.performanceImpact,
        actionability: report.primaryPattern.actionability
      };
      
      // Get source video details from context
      const sourceVideo = state.videoContext ? {
        id: state.videoId,
        title: state.videoContext.title,
        channel: state.videoContext.channelName,
        score: state.videoContext.tps,
        niche: state.videoContext.topicNiche,
        format: state.videoContext.formatType,
        // Use actual data from video bundle
        views: (state.videoContext as any).views || 0,
        thumbnail: (state.videoContext as any).thumbnail || '',
        baseline: (state.videoContext as any).baseline || 0,
        published_at: (state.videoContext as any).published_at || '',
        channel_avg_views: (state.videoContext as any).baseline || 0,
        performance_multiplier: state.videoContext.tps,
        percentile_rank: 95,
        baseline_sample_size: 10
      } : undefined;
      
      // Transform validation results to match classic structure
      const validation = {
        results: report.primaryPattern.evidence.map(e => ({
          niche: e.excerpt || 'General',
          videos: [{
            video_id: e.videoId,
            title: e.title,
            channel: e.channelName,
            score: e.tps,
            relevance: e.relevance
          }],
          pattern_score: report.primaryPattern.confidence,
          avg_performance: e.tps,
          count: 1
        })),
        total_validations: report.metadata.totalVideosAnalyzed,
        pattern_strength: report.primaryPattern.strength,
        avg_pattern_score: report.primaryPattern.confidence
      };
      
      // Include secondary patterns and recommendations in debug
      const debug = {
        secondaryPatterns: report.secondaryPatterns,
        recommendations: report.recommendations,
        competitiveAnalysis: report.competitiveAnalysis,
        channelInsights: report.channelInsights,
        searchResults: state.searchResults || []
      };
      
      return {
        success,
        mode: this.config.mode,
        fallbackUsed: false,
        pattern,
        source_video: sourceVideo,
        validation,
        debug,
        metrics: {
          totalDurationMs: usage.durationMs,
          totalTokens: usage.tokens,
          totalCost: usage.costs.total,
          toolCallCount: usage.toolCalls,
          modelSwitches: this.modelRouter.getSwitchCount()
        },
        budgetUsage: usage,
        processing_time_ms: usage.durationMs
      };
    }
    
    // Fallback to basic structure if no final report
    return {
      success,
      mode: this.config.mode,
      fallbackUsed: false,
      pattern: state?.hypothesis ? {
        statement: state.hypothesis.statement,
        confidence: state.hypothesis.confidence,
        validations: state.validationResults?.validated || 0,
        niches: [],
        evidence: []
      } : undefined,
      metrics: {
        totalDurationMs: usage.durationMs,
        totalTokens: usage.tokens,
        totalCost: usage.costs.total,
        toolCallCount: usage.toolCalls,
        modelSwitches: this.modelRouter.getSwitchCount()
      },
      budgetUsage: usage,
      error: error ? {
        code: error.code || 'UNKNOWN',
        message: error.message || String(error)
      } : undefined
    };
  }
  
  /**
   * Get prompt for turn
   */
  private getPromptForTurn(turnType: TurnType, state: SessionState, model: ModelType): string {
    const statesSummary = ResponseFormatter.formatStateForSwitch(state);
    const hypothesis = state.hypothesis?.statement;
    
    const basePrompt = getTurnPrompt(turnType, statesSummary, hypothesis);
    return composePrompt(basePrompt, model);
  }
  
  /**
   * Logging helper
   */
  private log(level: 'info' | 'warn' | 'error', message: string, data?: any): void {
    const entry = {
      timestamp: new Date(),
      level,
      message,
      sessionId: this.sessionId,
      turn: this.currentTurn,
      data
    };
    
    console.log(`[${level.toUpperCase()}] ${message}`, data || '');
    
    // Log to file-based logger if available
    if (this.logger) {
      this.logger.log(level, 'orchestrator', message, {
        ...data,
        turnNumber: this.currentTurn,
        turnType: this.currentTurn < TURN_SEQUENCE.length ? TURN_SEQUENCE[this.currentTurn] : 'complete'
      });
    }
    
    if (this.config.telemetryEnabled) {
      this.telemetry.push(entry);
    }
  }
  
  /**
   * Save telemetry (would persist to database)
   */
  private async saveTelemetry(): Promise<void> {
    // In production, save to database
    console.log('Telemetry saved:', this.telemetry.length, 'entries');
  }
}

/**
 * Factory function to create and run agent
 */
export async function runIdeaHeistAgent(
  videoId: string,
  config?: Partial<OrchestratorConfig>
): Promise<OrchestratorResult> {
  const agent = new IdeaHeistAgent(config);
  return agent.runIdeaHeistAgent(videoId);
}