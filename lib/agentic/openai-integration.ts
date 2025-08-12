/**
 * OpenAI Integration for Idea Heist Agentic Mode
 * Implements GPT-5 Responses API for the orchestrator
  * Uses new responses.create() API instead of chat.completions
 */

import OpenAI from 'openai';
import { 
  ModelType,
  TurnType,
  ToolCall,
  ToolDefinition
} from '@/types/orchestrator';
import { StructuredOutputEnforcer } from './schemas/structured-output';
import { FinalPatternReportSchema, FinalPatternReportJsonSchema } from './schemas/pattern-report';
import { executeToolWithCache } from './tool-executor';

// GPT-5 specific types
type ReasoningEffort = 'minimal' | 'low' | 'medium' | 'high' | 'maximum';
type Verbosity = 'low' | 'medium' | 'high';

// Initialize OpenAI client (only if API key is available)
let openai: OpenAI | null = null;

// Function to ensure OpenAI is initialized
function getOpenAIClient(): OpenAI | null {
  if (!openai && process.env.OPENAI_API_KEY) {
    console.log('[OpenAI] Initializing client with API key');
    openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
    });
  }
  if (!openai) {
    console.warn('[OpenAI] No API key found, using mock mode');
  }
  return openai;
}

/**
 * Model mapping - GPT-5 models now use native names
 * GPT-5 models released January 2025
 */
const MODEL_MAP: Record<ModelType, string> = {
  'gpt-5': 'gpt-5',           // Full GPT-5 model
  'gpt-5-mini': 'gpt-5-mini', // Optimized for search planning
  'gpt-5-nano': 'gpt-5-nano'  // Efficient for simple tasks
};

/**
 * Reasoning effort mapping for different turn types
 */
const REASONING_EFFORT_MAP: Record<TurnType, ReasoningEffort> = {
  'context_gathering': 'minimal',
  'hypothesis_generation': 'high',
  'search_planning': 'high',      // High effort for persistent tool calling
  'enrichment': 'medium',
  'validation': 'medium',
  'finalization': 'high'
};

/**
 * OpenAI API integration class
 */
export class OpenAIIntegration {
  private sessionStore: Map<string, string> = new Map(); // sessionId -> previous_response_id
  private modelSessions: Map<string, string> = new Map(); // `${sessionId}:${model}` -> previous_response_id
  
  /**
   * Execute a turn with GPT-5 Responses API with proper tool loop
   */
  async executeTurn(
    turnType: TurnType,
    model: ModelType,
    systemPrompt: string,
    userMessage: string,
    tools?: ToolDefinition[],
    sessionId?: string,
    toolRegistry?: { get: (name: string) => ToolDefinition | undefined }
  ): Promise<{
    content?: string;
    toolCalls?: any[];
    tokensUsed: number;
    responseId?: string;
  }> {
    const client = getOpenAIClient();
    if (!client) {
      throw new Error('OpenAI client not initialized. Please set OPENAI_API_KEY environment variable.');
    }
    
    const modelName = MODEL_MAP[model];
    const reasoningEffort = REASONING_EFFORT_MAP[turnType];
    
    try {
      // Combine system and user prompts for Responses API
      const fullPrompt = `${systemPrompt}\n\nUser: ${userMessage}`;
      
      // Convert tools to GPT-5 freeform format
      const gpt5Tools = tools ? this.convertToolsToGPT5(tools) : undefined;
      
      // Debug tool conversion
      if (turnType === 'search_planning' && gpt5Tools) {
        console.log('[🔧 GPT-5 Tools] Converted tools:', gpt5Tools.map(t => t.name));
      }
      
      // Special handling for finalization turn - request JSON output
       if (turnType === 'finalization') {
         const response = await (client as any).responses.create({
           model: modelName,
           input: fullPrompt,
           reasoning: { effort: reasoningEffort },
           text: { verbosity: 'medium' },
           response_format: {
             type: 'json_schema',
             json_schema: {
               name: 'final_pattern_report',
               schema: FinalPatternReportJsonSchema.schema,
               strict: true
             }
           }
         });
         
         return {
           content: response.output_text || response.output || undefined,
           tokensUsed: (response.usage?.input_tokens || 0) + (response.usage?.output_tokens || 0)
         };
       }
      
      // Regular response with optional tools
      const responseOptions: any = {
        model: modelName,
        input: fullPrompt,
        reasoning: { effort: reasoningEffort },
        text: { verbosity: turnType === 'search_planning' ? 'high' : 'medium' }
      };
      
      // Add session continuity for same-model turns
      if (sessionId) {
        const sessionKey = `${sessionId}:${model}`;
        const previousResponseId = this.modelSessions.get(sessionKey);
        if (previousResponseId) {
          responseOptions.previous_response_id = previousResponseId;
          console.log(`[🔗 Session Continuity] Using previous_response_id: ${previousResponseId.substring(0, 20)}...`);
        }
      }
      
      if (gpt5Tools && gpt5Tools.length > 0) {
        responseOptions.tools = gpt5Tools;
        responseOptions.tool_choice = 'required';
        
        // For search planning, emphasize tool usage in prompt
        if (turnType === 'search_planning') {
          responseOptions.input = fullPrompt + 
            '\n\nCRITICAL: You MUST use the provided tools to search for evidence. ' +
            'Call multiple search tools with diverse queries to find supporting videos.';
          console.log('[🔧 GPT-5] High reasoning effort for search planning');
        }
      }
      
      let response = await (client as any).responses.create(responseOptions);
      let totalTokens = (response.usage?.input_tokens || 0) + (response.usage?.output_tokens || 0);
      let allToolCalls: any[] = [];
      
      // Implement the tool loop - continue until model stops calling tools
      let loopCount = 0;
      const maxLoops = 5; // Prevent infinite loops
      
      while (loopCount < maxLoops) {
        loopCount++;
        
        // Parse tool calls from current response
        const toolCalls = this.parseToolCallsFromResponse(response);
        
        if (toolCalls.length === 0) {
          // No more tool calls, conversation is complete
          break;
        }
        
        // Execute tools if registry is provided
        if (toolRegistry) {
          console.log(`[🔧 Tool Loop ${loopCount}] Executing ${toolCalls.length} tools`);
          
          const toolResults = await this.executeToolCalls(toolCalls, toolRegistry, {});
          allToolCalls.push(...toolResults);
          
          // Submit tool outputs back to Responses API for continuation
          const toolOutputs = toolResults.map(result => ({
            tool_call_id: result.id,
            output: result.status === 'success' 
              ? JSON.stringify(result.result)
              : JSON.stringify({ error: result.error?.message || 'tool_error' })
          }));
          
          // Submit tool outputs back to Responses API to continue
          try {
            // Continue the same response with tool outputs via previous_response_id
            response = await (client as any).responses.create({
              model: modelName,
              input: [], // Required parameter for continuation
              previous_response_id: response.id,
              tool_outputs: toolOutputs,
              reasoning: { effort: reasoningEffort },
              text: { verbosity: turnType === 'search_planning' ? 'high' : 'medium' }
            });
            
            totalTokens += (response.usage?.input_tokens || 0) + (response.usage?.output_tokens || 0);
          } catch (error) {
            console.warn(`[🔧 Tool Loop ${loopCount}] Continue failed, breaking loop:`, error);
            break;
          }
          
        } else {
          // No tool registry provided, just collect tool calls without executing
          allToolCalls.push(...toolCalls);
          break;
        }
      }
      
      // Debug logging for tool calls
      if (turnType === 'search_planning') {
        console.log('[🔍 GPT-5 Search Planning] Tools provided:', gpt5Tools?.length || 0);
        console.log('[🔍 GPT-5 Search Planning] Tool loops completed:', loopCount);
        console.log('[🔍 GPT-5 Search Planning] Total tool calls executed:', allToolCalls.length);
        
        if (allToolCalls.length > 0) {
          console.log('[🔍 GPT-5 Search Planning] Tool calls:', allToolCalls.map(tc => ({
            name: tc.toolName || tc.name || tc.function?.name,
            status: tc.status
          })));
        } else {
          const outputText = typeof (response.output_text || response.output) === 'string' 
            ? (response.output_text || response.output) 
            : JSON.stringify(response.output_text || response.output);
          console.log('[🔍 GPT-5 Search Planning] NO TOOL CALLS - Response:', outputText?.substring(0, 200));
        }
      }
      
      // Store response ID for session continuity
      if (sessionId && response.id) {
        const sessionKey = `${sessionId}:${model}`;
        this.modelSessions.set(sessionKey, response.id);
        console.log(`[🔗 Session Continuity] Stored response_id for future turns: ${response.id.substring(0, 20)}...`);
      }
      
      return {
        content: response.output_text || response.output || undefined,
        toolCalls: allToolCalls,
        tokensUsed: totalTokens,
        responseId: response.id
      };
      
    } catch (error) {
      console.error(`GPT-5 API error for ${turnType}:`, error);
      throw error;
    }
  }
  
  /**
   * Execute tool calls and return results
   */
  async executeToolCalls(
    toolCalls: Array<{ id: string; function: { name: string; arguments: string } }>,
    toolRegistry: { get: (name: string) => ToolDefinition | undefined },
    context: any
  ): Promise<ToolCall[]> {
    const results: ToolCall[] = [];
    
    // Execute tools in parallel when possible
    const toolPromises = toolCalls.map(async (call) => {
      const tool = toolRegistry.get(call.function.name);
      if (!tool) {
        return {
          id: call.id,
          toolName: call.function.name,
          params: {},
          status: 'error' as const,
          error: {
            code: 'TOOL_NOT_FOUND',
            message: `Tool ${call.function.name} not found`,
            retryable: false
          },
          startTime: new Date(),
          endTime: new Date()
        };
      }
      
      const params = JSON.parse(call.function.arguments || '{}');
      const startTime = new Date();
      
      try {
        // Use the real tool executor instead of handler
        const result = await executeToolWithCache(
          tool,
          params,
          context,
          true // Use cache
        );
        
        return {
          id: call.id,
          toolName: call.function.name,
          params,
          status: 'success' as const,
          result,
          startTime,
          endTime: new Date()
        };
      } catch (error) {
        console.error(`Tool ${call.function.name} failed:`, error);
        return {
          id: call.id,
          toolName: call.function.name,
          params,
          status: 'error' as const,
          error: {
            code: 'TOOL_EXECUTION_ERROR',
            message: String(error),
            retryable: true
          },
          startTime,
          endTime: new Date()
        };
      }
    });
    
    const executedTools = await Promise.all(toolPromises);
    return executedTools;
  }
  
  /**
   * Generate hypothesis using GPT-5 Responses API
   */
  async generateHypothesis(
    systemPrompt: string,
    videoContext: any,
    model: ModelType = 'gpt-5'
  ): Promise<{
    statement: string;
    confidence: number;
    supportingEvidence: string[];
    testableWith: string[];
  }> {
    const client = getOpenAIClient();
    if (!client) {
      throw new Error('OpenAI client not initialized. Please set OPENAI_API_KEY environment variable.');
    }
    
    const modelName = MODEL_MAP[model];
    
    const fullPrompt = `${systemPrompt}

Based on the video context:
- Title: ${videoContext.title}
- TPS: ${videoContext.tps}
- Channel: ${videoContext.channelName}
- Format: ${videoContext.formatType || 'unknown'}
- Topic: ${videoContext.topicNiche || 'unknown'}

Generate a testable hypothesis about why this video might be outperforming.
Return as JSON with this exact structure:
{
  "statement": "Clear hypothesis statement about why this video is successful",
  "confidence": 0.75,
  "reasoning": "Detailed explanation of supporting reasoning for this hypothesis",
  "testableWith": ["get_video_bundle", "search_titles", "perf_snapshot"],
  "expectedEvidence": 3
}`;
    
    // Log what we're asking the AI
    console.log('[🤖 GPT-5 Hypothesis] Input:', {
      model: modelName,
      video: videoContext.title,
      performance: `${videoContext.tps}x baseline`,
      format: videoContext.formatType,
      niche: videoContext.topicNiche
    });
    
    const response = await (client as any).responses.create({
      model: modelName,
      input: fullPrompt,
      reasoning: { effort: 'high' },  // High effort for hypothesis generation
      text: { verbosity: 'medium' }
    });
    
    const output = response.output_text || response.output;
    if (!output) throw new Error('No hypothesis generated');
    
    // Log AI's raw thinking
    const outputText = typeof output === 'string' ? output : JSON.stringify(output);
    console.log('[🤖 GPT-5 Hypothesis] Raw response:', outputText.substring(0, 300) + '...');
    
    const hypothesisRaw = StructuredOutputEnforcer.enforceHypothesis(output);
    const hypothesis = {
      statement: hypothesisRaw.statement,
      confidence: hypothesisRaw.confidence,
      supportingEvidence: Array.isArray((hypothesisRaw as any).supportingEvidence)
        ? (hypothesisRaw as any).supportingEvidence
        : ((hypothesisRaw as any).reasoning ? [String((hypothesisRaw as any).reasoning)] : []),
      testableWith: hypothesisRaw.testableWith
    };
    
    // Log the key insight
    console.log('[🧠 GPT-5 Logic] Hypothesis:', hypothesis.statement);
    console.log('[🧠 GPT-5 Logic] Confidence:', hypothesis.confidence);
    // Reasoning text may be included in supportingEvidence via repair step
    console.log('[🧠 GPT-5 Logic] Reasoning:', Array.isArray(hypothesis.supportingEvidence) && hypothesis.supportingEvidence.length > 0 ? hypothesis.supportingEvidence.join(' ') : 'Not provided');
    
    return hypothesis;
  }
  
  /**
   * Validate candidates using GPT-5 Responses API
   */
  async validateCandidates(
    systemPrompt: string,
    hypothesis: string,
    candidates: any[],
    model: ModelType = 'gpt-5-mini'
  ): Promise<{
    validated: number;
    rejected: number;
    patterns: any[];
  }> {
    const client = getOpenAIClient();
    if (!client) {
      throw new Error('OpenAI client not initialized. Please set OPENAI_API_KEY environment variable.');
    }
    
    const modelName = MODEL_MAP[model];
    
    const fullPrompt = `${systemPrompt}

Hypothesis to test: ${hypothesis}

Candidates to validate:
${JSON.stringify(candidates, null, 2)}

For each candidate, determine if it supports the hypothesis.
Return as JSON with: results (array of {videoId, validated, confidence, reasoning}), summary.`;
    
    const response = await (client as any).responses.create({
      model: modelName,
      input: fullPrompt,
      reasoning: { effort: 'medium' },  // Medium effort for validation
      text: { verbosity: 'low' }
    });
    
    const output = response.output_text || response.output;
    if (!output) throw new Error('No validation results');
    
    // Log AI's validation thinking
    const outputText = typeof output === 'string' ? output : JSON.stringify(output);
    console.log('[🔍 GPT-5 Validation] Raw response:', outputText.substring(0, 300) + '...');
    
    const validation = StructuredOutputEnforcer.enforceBatchValidation(output);
    
    // Log validation results
    console.log('[✅ GPT-5 Logic] Validated:', validation.summary.totalValidated);
    console.log('[❌ GPT-5 Logic] Rejected:', validation.summary.totalRejected);
    if (validation.summary.strongestPattern) {
      console.log('[💡 GPT-5 Logic] Pattern found:', validation.summary.strongestPattern);
    }
    
    return {
      validated: validation.summary.totalValidated,
      rejected: validation.summary.totalRejected,
      patterns: validation.results
        .filter(r => r.validated && r.patternType)
        .map(r => ({
          type: r.patternType,
          strength: r.patternStrength || r.confidence,
          examples: [r.videoId]
        }))
    };
  }
  
  /**
   * Generate final report using GPT-5 Responses API
   */
  async generateFinalReport(
    systemPrompt: string,
    analysisState: any,
    model: ModelType = 'gpt-5'
  ): Promise<any> {
    // Log report generation context
    console.log('[📊 OpenAI Final Report] Generating with context:', {
      hasHypothesis: !!analysisState.hypothesis,
      candidatesAnalyzed: analysisState.searchResults?.totalCandidates || 0,
      validatedCount: analysisState.validationResults?.validated || 0
    });
    
    const client = getOpenAIClient();
    if (!client) {
      throw new Error('OpenAI client not initialized. Please set OPENAI_API_KEY environment variable.');
    }
    
    const modelName = MODEL_MAP[model];
    
    const userMessage = `
Generate the final pattern analysis report based on this analysis:

Video Context:
${JSON.stringify(analysisState.videoContext, null, 2)}

Hypothesis:
${JSON.stringify(analysisState.hypothesis, null, 2)}

Validation Results:
${JSON.stringify(analysisState.validationResults, null, 2)}

Search Results:
Total candidates analyzed: ${analysisState.searchResults?.totalCandidates || 0}

Generate a complete FinalPatternReport following this EXACT JSON structure:

{
  "version": "1.0",
  "videoId": "${analysisState.videoContext?.videoId || 'unknown'}",
  "analysisMode": "agentic",
  "timestamp": "${new Date().toISOString()}",
  "primaryPattern": {
    "type": "format" | "topic" | "timing" | "thumbnail" | "title" | "engagement" | "cross_channel" | "seasonal",
    "statement": "Clear pattern statement",
    "confidence": 0.75,
    "strength": 0.8,
    "evidence": [
      {
        "videoId": "xxx",
        "title": "Video title",
        "tps": 3.5,
        "channelName": "Channel",
        "relevance": 0.9,
        "excerpt": "Optional excerpt"
      }
    ],
    "niches": ["niche1", "niche2"],
    "performanceImpact": {
      "averageTPS": 3.2,
      "tpsLift": 1.5,
      "sampleSize": 50
    },
    "actionability": "high" | "medium" | "low"
  },
  "secondaryPatterns": [
    // Similar structure to primaryPattern, 0-4 items
  ],
  "competitiveAnalysis": {
    "topCompetitors": [
      {
        "channelId": "xxx",
        "channelName": "Channel",
        "avgTPS": 2.5,
        "videoCount": 100
      }
    ],
    "untappedFormats": ["format1", "format2"],
    "contentGaps": ["gap1", "gap2"]
  },
  "channelInsights": {
    "currentBaseline": {
      "avgTPS": 1.5,
      "p50TPS": 1.2,
      "p90TPS": 2.8
    },
    "strengthTopics": ["topic1", "topic2"],
    "weaknessTopics": ["topic3", "topic4"],
    "growthTrajectory": "accelerating" | "steady" | "declining" | "volatile"
  },
  "recommendations": [
    {
      "priority": "immediate" | "short_term" | "long_term",
      "action": "Specific action to take",
      "expectedImpact": "Expected outcome",
      "confidence": 0.8
    }
  ],
  "metadata": {
    "totalVideosAnalyzed": ${analysisState.searchResults?.totalCandidates || 0},
    "totalChannelsAnalyzed": ${analysisState.searchResults?.uniqueChannels || 0},
    "tokensUsed": 0,
    "executionTimeMs": 0,
    "toolCallCount": ${analysisState.toolCalls?.length || 0},
    "modelSwitches": 0,
    "totalCost": 0
  },
  "confidence": {
    "overall": 0.75,
    "dataQuality": 0.8,
    "patternClarity": 0.7
  }
}

IMPORTANT: 
- ALL fields are required
- Use the exact field names shown
- Numbers should be actual numbers, not strings
- Arrays must have at least the minimum required items
- Evidence array needs at least 3 items
- Recommendations array needs 3-10 items
- Secondary patterns can have 0-4 items
`;
    
    const fullPrompt = `${systemPrompt}\n\n${userMessage}`;
    
    const response = await (client as any).responses.create({
      model: modelName,
      input: fullPrompt,
      reasoning: { effort: 'high' },  // High effort for final report
      text: { verbosity: 'high' }  // High verbosity for detailed report
    });
    
    const output = response.output_text || response.output;
    if (!output) throw new Error('No report generated');
    
    // Log AI's final analysis
    const outputText = typeof output === 'string' ? output : JSON.stringify(output);
    console.log('[📊 GPT-5 Final Report] Raw response length:', outputText.length);
    console.log('[📊 GPT-5 Final Report] Response preview:', outputText.substring(0, 500) + '...');
    
    const report = StructuredOutputEnforcer.enforceFinalReport(output);
    
    // Log key findings
    if (report.primaryPattern) {
      console.log('[🎯 GPT-5 Findings] Primary pattern:', report.primaryPattern.statement);
      console.log('[🎯 GPT-5 Findings] Confidence:', report.primaryPattern.confidence);
      console.log('[🎯 GPT-5 Findings] Evidence count:', report.primaryPattern.evidence?.length || 0);
    }
    console.log('[🎯 GPT-5 Findings] Secondary patterns:', report.secondaryPatterns?.length || 0);
    console.log('[🎯 GPT-5 Findings] Recommendations:', report.recommendations?.length || 0);
    
    return report;
  }
  
  /**
   * Convert tool definitions to GPT-5 freeform format
   */
  private convertToolsToGPT5(tools: ToolDefinition[]): any[] {
    // Convert registry tools to Responses API function tools with JSON Schema parameters
    // Based on error "Missing required parameter: 'tools[0].name'", the format needs name at root level
    return tools.map(tool => ({
      type: 'function',
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters || { type: 'object', properties: {}, required: [] }
    }));
  }
  
  /**
   * Convert tool definitions to OpenAI format (fallback for GPT-4)
   */
  private convertToolsToOpenAI(tools: ToolDefinition[]): OpenAI.Chat.ChatCompletionTool[] {
    return tools.map(tool => ({
      type: 'function' as const,
      function: {
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters || {
          type: 'object',
          properties: {},
          required: []
        }
      }
    }));
  }
  
  /**
   * Parse tool calls from response - handles multiple formats
   */
  private parseToolCallsFromResponse(response: any): any[] {
    let toolCalls: any[] = [];
    
    // Primary: Direct tool_calls field
    if (response.tool_calls && Array.isArray(response.tool_calls)) {
      toolCalls = response.tool_calls;
    }
    // Secondary: Chat completions format (fallback compatibility)
    else if (response.choices && response.choices[0]?.message?.tool_calls) {
      toolCalls = response.choices[0].message.tool_calls;
    }
    // Tertiary: Structured output format
    else if (Array.isArray(response.output)) {
      for (const item of response.output) {
        if (item.type === 'tool_calls' && Array.isArray(item.tool_calls)) {
          toolCalls.push(...item.tool_calls);
        } else if (item.type === 'function_call' && item.name) {
          toolCalls.push({
            id: item.id || item.call_id || `call_${Date.now()}`,
            function: {
              name: item.name,
              arguments: item.arguments || '{}'
            }
          });
        }
      }
    }
    // Fallback: Parse from text content
    else if ((response.output_text || response.output) && (response.output_text || response.output).includes('TOOL_CALL:')) {
      toolCalls = this.parseFreeformToolCalls(response.output_text || response.output);
    }
    
    return toolCalls;
  }

  /**
   * Parse freeform tool calls from GPT-5 output
   */
  private parseFreeformToolCalls(output: string): any[] {
    const toolCalls: any[] = [];
    const lines = output.split('\n');
    
    for (const line of lines) {
      if (line.includes('TOOL_CALL:')) {
        try {
          // Extract tool call in format: TOOL_CALL: tool_name({args})
          const match = line.match(/TOOL_CALL:\s*(\w+)\((.*)\)/);
          if (match) {
            toolCalls.push({
              id: `call_${Date.now()}_${Math.random()}`,
              function: {
                name: match[1],
                arguments: match[2] || '{}'
              }
            });
          }
        } catch (e) {
          console.warn('Failed to parse tool call:', line);
        }
      }
    }
    
    return toolCalls;
  }
  
  /**
   * Clear session continuity (e.g., when switching models)
   */
  clearSessionContinuity(sessionId: string, model?: ModelType): void {
    if (model) {
      const sessionKey = `${sessionId}:${model}`;
      this.modelSessions.delete(sessionKey);
      console.log(`[🔗 Session Continuity] Cleared session for ${model}`);
    } else {
      // Clear all sessions for this sessionId
      const keys = Array.from(this.modelSessions.keys()).filter(key => key.startsWith(`${sessionId}:`));
      keys.forEach(key => this.modelSessions.delete(key));
      console.log(`[🔗 Session Continuity] Cleared all sessions for ${sessionId}`);
    }
  }

  /**
   * Stream a response using GPT-5 Responses API
   */
  async *streamResponse(
    model: ModelType,
    systemPrompt: string,
    userMessage: string
  ): AsyncGenerator<string> {
    const client = getOpenAIClient();
    if (!client) {
      throw new Error('OpenAI client not initialized. Please set OPENAI_API_KEY environment variable.');
    }
    
    const modelName = MODEL_MAP[model];
    const fullPrompt = `${systemPrompt}\n\nUser: ${userMessage}`;
    
    // GPT-5 Responses API supports streaming
    const stream = await (client as any).responses.create({
      model: modelName,
      input: fullPrompt,
      reasoning: { effort: 'medium' },
      text: { verbosity: 'medium' },
      stream: true
    });
    
    for await (const chunk of stream) {
      const content = chunk.output_delta || chunk.delta?.output;
      if (content) {
        yield content;
      }
    }
  }
}

/**
 * Singleton instance
 */
export const openaiIntegration = new OpenAIIntegration();

/**
 * Helper function to check if OpenAI API key is configured
 */
export function isOpenAIConfigured(): boolean {
  const hasKey = Boolean(process.env.OPENAI_API_KEY);
  if (!hasKey) {
    console.log('[OpenAI] API key check failed - env var not found');
  }
  return hasKey;
}

/**
 * Cost estimation for different models
 */
export const MODEL_COSTS = {
  'gpt-5': { input: 0.01, output: 0.03 }, // Estimated pricing
  'gpt-5-mini': { input: 0.003, output: 0.006 }, // GPT-4 pricing
  'gpt-5-nano': { input: 0.0005, output: 0.0015 } // GPT-3.5 pricing
};

/**
 * Calculate cost for a completion
 */
export function calculateCost(
  model: ModelType,
  inputTokens: number,
  outputTokens: number
): number {
  const costs = MODEL_COSTS[model];
  const inputCost = (inputTokens / 1000) * costs.input;
  const outputCost = (outputTokens / 1000) * costs.output;
  return inputCost + outputCost;
}