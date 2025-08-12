/**
 * Claude-based Idea Heist Orchestrator
 * Simplified agentic flow using Anthropic's Claude with tool use
 */

import { claudeIntegration } from './claude-integration';
import { getTurnPrompt } from './prompts/system-prompts';
import { getToolRegistry } from '../orchestrator/tool-registry';
import { ModelType, TurnType } from '@/types/orchestrator';
import { AgentLogger } from './logger/agent-logger';

interface AgenticOptions {
  maxFanouts?: number;
  maxValidations?: number;
  maxCandidates?: number;
  maxTokens?: number;
  maxDurationMs?: number;
  fallbackToClassic?: boolean;
}

interface AgenticResult {
  success: boolean;
  mode: 'agentic' | 'fallback';
  pattern?: any;
  error?: string;
  metrics?: {
    toolCalls: number;
    tokensUsed: number;
    executionTimeMs: number;
    modelSwitches: number;
  };
  fallbackUsed?: boolean;
}

/**
 * Claude-based Orchestrator for Idea Heist
 */
export class ClaudeOrchestrator {
  private sessionId: string;
  private startTime: number = 0;
  private totalTokens: number = 0;
  private totalToolCalls: number = 0;
  private modelSwitches: number = 0;
  private logger?: AgentLogger;
  
  constructor() {
    this.sessionId = `claude_session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }
  
  /**
   * Execute the full agentic analysis flow
   */
  async executeAgenticFlow(
    videoId: string,
    options: AgenticOptions = {}
  ): Promise<AgenticResult> {
    this.startTime = Date.now();
    
    // Initialize logger
    this.logger = new AgentLogger(videoId, 'claude');
    this.logger.log('info', 'orchestrator', `Starting Claude agentic analysis for video: ${videoId}`, { options });
    
    console.log(`[🚀 Claude Orchestrator] Starting agentic analysis for video: ${videoId}`);
    
    // Get tool registry instance
    const toolRegistry = getToolRegistry();
    
    const {
      maxFanouts = 2,
      maxValidations = 10,
      maxCandidates = 50,
      maxTokens = 10000,
      maxDurationMs = 60000,
      fallbackToClassic = true
    } = options;
    
    try {
      // Phase 1: Context Gathering
      console.log('\n[📋 Phase 1] Context Gathering...');
      if (this.logger) {
        this.logger.log('info', 'phase', 'Starting context gathering', { phase: 1, videoId });
      }
      const videoContext = await this.executeContextGathering(videoId, toolRegistry);
      
      if (!videoContext) {
        throw new Error('Failed to gather video context');
      }
      
      // Phase 2: Hypothesis Generation
      console.log('\n[🧠 Phase 2] Hypothesis Generation...');
      const hypothesis = await this.executeHypothesisGeneration(videoContext);
      
      // Phase 3: Search Planning & Evidence Gathering
      console.log('\n[🔍 Phase 3] Search Planning & Evidence Gathering...');
      const searchResults = await this.executeSearchPlanning(hypothesis, videoContext, maxFanouts, toolRegistry);
      
      // Phase 4: Validation
      console.log('\n[✅ Phase 4] Validation...');
      const validationResults = await this.executeValidation(hypothesis, searchResults, maxValidations);
      
      // Phase 5: Final Report Generation
      console.log('\n[📊 Phase 5] Final Report Generation...');
      const finalReport = await this.generateFinalReport({
        videoContext,
        hypothesis,
        searchResults,
        validationResults
      });
      
      const executionTime = Date.now() - this.startTime;
      
      console.log(`\n[✅ Claude Orchestrator] Analysis completed successfully in ${executionTime}ms`);
      
      // Complete logging
      if (this.logger) {
        this.logger.log('info', 'orchestrator', 'Analysis completed successfully', {
          executionTimeMs: executionTime,
          toolCalls: this.totalToolCalls,
          tokensUsed: this.totalTokens,
          modelSwitches: this.modelSwitches
        });
        this.logger.logFinalPattern(finalReport);
        await this.logger.complete(true, finalReport);
      }
      
      return {
        success: true,
        mode: 'agentic',
        pattern: finalReport,
        metrics: {
          toolCalls: this.totalToolCalls,
          tokensUsed: this.totalTokens,
          executionTimeMs: executionTime,
          modelSwitches: this.modelSwitches
        }
      };
      
    } catch (error) {
      console.error('[❌ Claude Orchestrator] Agentic flow failed:', error);
      
      // Log the error
      if (this.logger) {
        this.logger.logError(error, 'orchestrator');
      }
      
      if (fallbackToClassic) {
        console.log('[🔄 Claude Orchestrator] Attempting fallback to classic mode...');
        if (this.logger) {
          this.logger.log('info', 'orchestrator', 'Attempting fallback to classic mode');
        }
        
        try {
          const fallbackResult = await this.executeFallbackMode(videoId, toolRegistry);
          
          if (this.logger) {
            await this.logger.complete(true, fallbackResult);
          }
          
          return {
            success: true,
            mode: 'fallback',
            pattern: fallbackResult,
            fallbackUsed: true,
            metrics: {
              toolCalls: this.totalToolCalls,
              tokensUsed: this.totalTokens,
              executionTimeMs: Date.now() - this.startTime,
              modelSwitches: this.modelSwitches
            }
          };
        } catch (fallbackError) {
          console.error('[❌ Claude Orchestrator] Fallback also failed:', fallbackError);
          if (this.logger) {
            this.logger.logError(fallbackError, 'orchestrator');
          }
        }
      }
      
      if (this.logger) {
        await this.logger.complete(false, undefined, String(error));
      }
      
      return {
        success: false,
        mode: 'agentic',
        error: String(error),
        metrics: {
          toolCalls: this.totalToolCalls,
          tokensUsed: this.totalTokens,
          executionTimeMs: Date.now() - this.startTime,
          modelSwitches: this.modelSwitches
        }
      };
    } finally {
      // Clean up session
      claudeIntegration.clearSession(this.sessionId);
    }
  }
  
  /**
   * Phase 1: Context Gathering
   */
  private async executeContextGathering(videoId: string, toolRegistry: any): Promise<any> {
    const systemPrompt = getTurnPrompt('context_gathering');
    const userMessage = `Gather comprehensive context for video ID: ${videoId}. Use the get_video_bundle tool to retrieve all available data including title, thumbnail, performance metrics, and channel information.`;
    
    const result = await claudeIntegration.executeTurn(
      'context_gathering',
      'gpt-5-mini', // Use Haiku for simple data gathering
      systemPrompt,
      userMessage,
      [toolRegistry.get('get_video_bundle')!].filter(Boolean),
      this.sessionId,
      toolRegistry
    );
    
    this.totalTokens += result.tokensUsed;
    this.totalToolCalls += result.toolCalls?.length || 0;
    
    // Extract video context from tool results
    if (result.toolCalls && result.toolCalls.length > 0) {
      const videoBundle = result.toolCalls.find(call => call.toolName === 'get_video_bundle');
      if (videoBundle && videoBundle.status === 'success') {
        // API returns {success: true, data: {...}} structure
        const data = videoBundle.result.data || videoBundle.result;
        const context = {
          videoId,
          title: data.title,
          tps: data.tps || data.temporal_performance_score,
          channelName: data.channel_name,
          channelId: data.channel_id,
          thumbnailUrl: data.thumbnail_url,
          formatType: data.format_type,
          topicNiche: data.topic_niche,
          publishedAt: data.published_at
        };
        
        console.log('[📋 Context] Video loaded:', {
          title: context.title?.substring(0, 50) + '...',
          tps: context.tps,
          channel: context.channelName,
          format: context.formatType
        });
        
        return context;
      }
    }
    
    throw new Error('Failed to retrieve video context');
  }
  
  /**
   * Phase 2: Hypothesis Generation
   */
  private async executeHypothesisGeneration(videoContext: any): Promise<any> {
    const systemPrompt = getTurnPrompt('hypothesis_generation');
    
    // Include thumbnail analysis if available
    let thumbnailAnalysis = '';
    if (videoContext.thumbnailUrl) {
      try {
        console.log('[🖼️  Thumbnail Analysis] Analyzing thumbnail...');
        const visionResult = await claudeIntegration.analyzeImage(
          videoContext.thumbnailUrl,
          'Analyze this YouTube thumbnail. What visual elements, colors, text, and design choices make it compelling? Focus on elements that might drive higher click-through rates.',
          'gpt-5'
        );
        
        thumbnailAnalysis = `\n\nThumbnail Analysis: ${visionResult.analysis}`;
        this.totalTokens += visionResult.tokensUsed;
        
        console.log('[🖼️  Thumbnail Analysis] Completed:', visionResult.analysis.substring(0, 100) + '...');
      } catch (error) {
        console.warn('[🖼️  Thumbnail Analysis] Failed:', error);
      }
    }
    
    const hypothesis = await claudeIntegration.generateHypothesis(
      systemPrompt,
      videoContext,
      'gpt-5' // Use best model for hypothesis generation
    );
    
    console.log('[🧠 Hypothesis] Generated:', {
      statement: hypothesis.statement.substring(0, 100) + '...',
      confidence: hypothesis.confidence,
      testableWith: hypothesis.testableWith.length
    });
    
    return {
      ...hypothesis,
      thumbnailInsights: thumbnailAnalysis
    };
  }
  
  /**
   * Phase 3: Search Planning & Evidence Gathering
   */
  private async executeSearchPlanning(hypothesis: any, videoContext: any, maxFanouts: number, toolRegistry: any): Promise<any> {
    const systemPrompt = getTurnPrompt('search_planning', '', hypothesis.statement)
      .replace('{{HYPOTHESIS}}', hypothesis.statement)
      .replace('{{REMAINING_FANOUTS}}', String(maxFanouts));
    
    const userMessage = `Execute search strategy to find evidence for this hypothesis: "${hypothesis.statement}"

Video Context:
- Title: ${videoContext.title}
- Channel: ${videoContext.channelName}
- Format: ${videoContext.formatType}
- Topic: ${videoContext.topicNiche}

Use multiple search tools to find similar high-performing videos that might support or refute this hypothesis.`;
    
    // Provide all search tools
    const searchTools = [
      toolRegistry.get('search_titles'),
      toolRegistry.get('search_summaries'),
      toolRegistry.get('search_thumbs')
    ].filter(Boolean);
    
    const result = await claudeIntegration.executeTurn(
      'search_planning',
      'gpt-5', // Use best model for search planning
      systemPrompt,
      userMessage,
      searchTools,
      this.sessionId,
      toolRegistry
    );
    
    this.totalTokens += result.tokensUsed;
    this.totalToolCalls += result.toolCalls?.length || 0;
    this.modelSwitches += 1;
    
    // Collect search results
    const candidates: any[] = [];
    let totalCandidates = 0;
    
    if (result.toolCalls) {
      for (const call of result.toolCalls) {
        if (call.status === 'success') {
          // API returns {success: true, data: {results: [...]}} structure
          const data = call.result.data || call.result;
          if (data?.results) {
            candidates.push(...data.results);
            totalCandidates += data.results.length;
          }
        }
      }
    }
    
    console.log('[🔍 Search Results] Found:', {
      searchCalls: result.toolCalls?.length || 0,
      totalCandidates,
      uniqueVideos: new Set(candidates.map(c => c.videoId || c.video_id)).size
    });
    
    return {
      candidates,
      totalCandidates,
      searchCalls: result.toolCalls?.length || 0,
      fanoutsUsed: Math.min(result.toolCalls?.length || 0, maxFanouts)
    };
  }
  
  /**
   * Phase 4: Validation
   */
  private async executeValidation(hypothesis: any, searchResults: any, maxValidations: number): Promise<any> {
    // For now, simple validation based on search results
    const candidates = searchResults.candidates.slice(0, maxValidations);
    
    if (candidates.length === 0) {
      return {
        validated: 0,
        rejected: 0,
        confidence: 0.1
      };
    }
    
    // Simple heuristic validation
    const highPerformers = candidates.filter(c => (c.tps || c.temporal_performance_score || 0) >= 2.0);
    
    console.log('[✅ Validation] Results:', {
      totalCandidates: candidates.length,
      highPerformers: highPerformers.length,
      validationRate: highPerformers.length / candidates.length
    });
    
    return {
      validated: highPerformers.length,
      rejected: candidates.length - highPerformers.length,
      confidence: highPerformers.length / candidates.length,
      examples: highPerformers.slice(0, 5).map(c => ({
        videoId: c.videoId || c.video_id,
        title: c.title,
        tps: c.tps || c.temporal_performance_score,
        channelName: c.channelName || c.channel_name
      }))
    };
  }
  
  /**
   * Phase 5: Generate Final Report
   */
  private async generateFinalReport(analysisState: any): Promise<any> {
    const systemPrompt = getTurnPrompt('finalization');
    
    const report = await claudeIntegration.generateFinalReport(
      systemPrompt,
      analysisState,
      'gpt-5' // Use best model for final report
    );
    
    this.modelSwitches += 1;
    
    // Ensure required fields are present
    const finalReport = {
      version: "1.0",
      videoId: analysisState.videoContext.videoId,
      analysisMode: "agentic",
      timestamp: new Date().toISOString(),
      ...report,
      metadata: {
        totalVideosAnalyzed: analysisState.searchResults?.totalCandidates || 0,
        totalChannelsAnalyzed: analysisState.searchResults?.uniqueChannels || 0,
        tokensUsed: this.totalTokens,
        executionTimeMs: Date.now() - this.startTime,
        toolCallCount: this.totalToolCalls,
        modelSwitches: this.modelSwitches,
        totalCost: 0,
        ...report.metadata
      }
    };
    
    return finalReport;
  }
  
  /**
   * Fallback mode using simpler analysis
   */
  private async executeFallbackMode(videoId: string, toolRegistry: any): Promise<any> {
    console.log('[🔄 Fallback Mode] Using simplified analysis...');
    
    // Simple fallback that just gets video context and generates basic report
    const videoContext = await this.executeContextGathering(videoId, toolRegistry);
    
    return {
      version: "1.0",
      videoId,
      analysisMode: "fallback",
      timestamp: new Date().toISOString(),
      primaryPattern: {
        type: "fallback",
        statement: `Video "${videoContext.title}" shows ${videoContext.tps}x performance, but detailed analysis was not available.`,
        confidence: 0.3,
        strength: 0.3,
        evidence: [],
        niches: [videoContext.topicNiche || 'unknown'],
        performanceImpact: {
          averageTPS: videoContext.tps || 1.0,
          tpsLift: (videoContext.tps || 1.0) - 1.0,
          sampleSize: 1
        },
        actionability: "low"
      },
      secondaryPatterns: [],
      competitiveAnalysis: {
        topCompetitors: [],
        untappedFormats: [],
        contentGaps: []
      },
      channelInsights: {
        currentBaseline: {
          avgTPS: 1.0,
          p50TPS: 1.0,
          p90TPS: 2.0
        },
        strengthTopics: [],
        weaknessTopics: [],
        growthTrajectory: "unknown"
      },
      recommendations: [
        {
          priority: "immediate",
          action: "Analyze video performance manually for detailed insights",
          expectedImpact: "Better understanding of success factors",
          confidence: 0.5
        }
      ],
      metadata: {
        totalVideosAnalyzed: 1,
        totalChannelsAnalyzed: 1,
        tokensUsed: this.totalTokens,
        executionTimeMs: Date.now() - this.startTime,
        toolCallCount: this.totalToolCalls,
        modelSwitches: this.modelSwitches,
        totalCost: 0
      },
      confidence: {
        overall: 0.3,
        dataQuality: 0.5,
        patternClarity: 0.2
      }
    };
  }
}

/**
 * Main entry point for Claude-based agentic analysis
 */
export async function executeClaudeAgenticAnalysis(
  videoId: string,
  options: AgenticOptions = {}
): Promise<AgenticResult> {
  const orchestrator = new ClaudeOrchestrator();
  return await orchestrator.executeAgenticFlow(videoId, options);
}