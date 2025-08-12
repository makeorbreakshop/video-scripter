/**
 * Anthropic Claude Integration for Idea Heist Agentic Mode
 * Implements Claude's tool use API for the orchestrator
 */

import Anthropic from '@anthropic-ai/sdk';
import { 
  ModelType,
  TurnType,
  ToolCall,
  ToolDefinition
} from '@/types/orchestrator';
import { executeToolWithCache } from './tool-executor';

// Claude model mapping
const CLAUDE_MODEL_MAP: Record<ModelType, string> = {
  'gpt-5': 'claude-3-5-sonnet-20241022',        // Best Claude model for complex reasoning
  'gpt-5-mini': 'claude-3-5-haiku-20241022',    // Fast Claude model for simple tasks
  'gpt-5-nano': 'claude-3-5-haiku-20241022'     // Use Haiku for nano-equivalent
};

// Initialize Anthropic client
let anthropic: Anthropic | null = null;

function getAnthropicClient(): Anthropic | null {
  if (!anthropic && process.env.ANTHROPIC_API_KEY) {
    console.log('[Claude] Initializing client with API key');
    anthropic = new Anthropic({
      apiKey: process.env.ANTHROPIC_API_KEY,
    });
  }
  if (!anthropic) {
    console.warn('[Claude] No API key found, using mock mode');
  }
  return anthropic;
}

/**
 * Claude API integration class
 */
export class ClaudeIntegration {
  private conversationHistory: Map<string, any[]> = new Map(); // sessionId -> messages
  
  /**
   * Execute a turn with Claude's Messages API with proper tool loop
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
    const client = getAnthropicClient();
    if (!client) {
      throw new Error('Claude client not initialized. Please set ANTHROPIC_API_KEY environment variable.');
    }
    
    const modelName = CLAUDE_MODEL_MAP[model];
    
    try {
      // Get or create conversation history for this session
      let messages = sessionId ? (this.conversationHistory.get(sessionId) || []) : [];
      
      // Add user message
      messages.push({
        role: 'user',
        content: userMessage
      });
      
      // Convert tools to Claude format
      const claudeTools = tools ? this.convertToolsToClaude(tools) : undefined;
      
      // Debug tool conversion
      if (turnType === 'search_planning' && claudeTools) {
        console.log('[🔧 Claude Tools] Converted tools:', claudeTools.map(t => t.name));
      }
      
      let totalTokens = 0;
      let allToolCalls: any[] = [];
      
      // Implement the tool loop
      let loopCount = 0;
      const maxLoops = 5;
      
      while (loopCount < maxLoops) {
        loopCount++;
        
        const requestParams: any = {
          model: modelName,
          max_tokens: 4000,
          system: systemPrompt,
          messages: [...messages] // Clone to avoid mutation
        };
        
        if (claudeTools && claudeTools.length > 0) {
          requestParams.tools = claudeTools;
          
          // For search planning, emphasize tool usage
          if (turnType === 'search_planning') {
            requestParams.system = systemPrompt + 
              '\n\nCRITICAL: You MUST use the provided tools to search for evidence. ' +
              'Call multiple search tools with diverse queries to find supporting videos.';
            console.log('[🔧 Claude] Emphasizing tool usage for search planning');
          }
        }
        
        const response = await client.messages.create(requestParams);
        
        totalTokens += response.usage.input_tokens + response.usage.output_tokens;
        
        // Parse tool calls from response
        const toolCalls = this.parseToolCallsFromResponse(response);
        
        if (toolCalls.length === 0) {
          // No tool calls, conversation is complete
          const textContent = this.extractTextContent(response);
          
          // Update conversation history
          if (sessionId) {
            messages.push({
              role: 'assistant',
              content: response.content
            });
            this.conversationHistory.set(sessionId, messages);
          }
          
          return {
            content: textContent,
            toolCalls: allToolCalls,
            tokensUsed: totalTokens,
            responseId: response.id
          };
        }
        
        // Execute tools if registry is provided
        if (toolRegistry) {
          console.log(`[🔧 Tool Loop ${loopCount}] Executing ${toolCalls.length} tools`);
          
          const toolResults = await this.executeToolCalls(toolCalls, toolRegistry, {});
          allToolCalls.push(...toolResults);
          
          // Add assistant message with tool calls
          messages.push({
            role: 'assistant',
            content: response.content
          });
          
          // Add tool results as user messages
          const toolResultMessages = toolResults.map(result => ({
            type: 'tool_result',
            tool_use_id: result.id,
            content: result.status === 'success' 
              ? JSON.stringify(result.result)
              : `Error: ${result.error?.message || 'tool_error'}`
          }));
          
          messages.push({
            role: 'user',
            content: toolResultMessages
          });
          
        } else {
          // No tool registry provided, just collect tool calls without executing
          allToolCalls.push(...toolCalls);
          break;
        }
      }
      
      // Debug logging for tool calls
      if (turnType === 'search_planning') {
        console.log('[🔍 Claude Search Planning] Tools provided:', claudeTools?.length || 0);
        console.log('[🔍 Claude Search Planning] Tool loops completed:', loopCount);
        console.log('[🔍 Claude Search Planning] Total tool calls executed:', allToolCalls.length);
        
        if (allToolCalls.length > 0) {
          console.log('[🔍 Claude Search Planning] Tool calls:', allToolCalls.map(tc => ({
            name: tc.toolName || tc.name,
            status: tc.status
          })));
        } else {
          console.log('[🔍 Claude Search Planning] NO TOOL CALLS - This might indicate an issue');
        }
      }
      
      // Update conversation history
      if (sessionId) {
        this.conversationHistory.set(sessionId, messages);
      }
      
      return {
        content: undefined, // Tool loop completed but no final text
        toolCalls: allToolCalls,
        tokensUsed: totalTokens,
        responseId: 'tool_loop_complete'
      };
      
    } catch (error) {
      console.error(`Claude API error for ${turnType}:`, error);
      throw error;
    }
  }
  
  /**
   * Execute tool calls and return results
   */
  async executeToolCalls(
    toolCalls: Array<{ id: string; name: string; input: any }>,
    toolRegistry: { get: (name: string) => ToolDefinition | undefined },
    context: any
  ): Promise<ToolCall[]> {
    const results: ToolCall[] = [];
    
    // Execute tools in parallel when possible
    const toolPromises = toolCalls.map(async (call) => {
      const tool = toolRegistry.get(call.name);
      if (!tool) {
        return {
          id: call.id,
          toolName: call.name,
          params: call.input,
          status: 'error' as const,
          error: {
            code: 'TOOL_NOT_FOUND',
            message: `Tool ${call.name} not found`,
            retryable: false
          },
          startTime: new Date(),
          endTime: new Date()
        };
      }
      
      const startTime = new Date();
      
      try {
        const result = await executeToolWithCache(
          tool,
          call.input,
          context,
          true // Use cache
        );
        
        return {
          id: call.id,
          toolName: call.name,
          params: call.input,
          status: 'success' as const,
          result,
          startTime,
          endTime: new Date()
        };
      } catch (error) {
        console.error(`Tool ${call.name} failed:`, error);
        return {
          id: call.id,
          toolName: call.name,
          params: call.input,
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
   * Analyze image with Claude's vision capabilities
   */
  async analyzeImage(
    imageUrl: string,
    prompt: string,
    model: ModelType = 'gpt-5'
  ): Promise<{
    analysis: string;
    tokensUsed: number;
  }> {
    const client = getAnthropicClient();
    if (!client) {
      throw new Error('Claude client not initialized. Please set ANTHROPIC_API_KEY environment variable.');
    }
    
    const modelName = CLAUDE_MODEL_MAP[model];
    
    try {
      // Fetch and encode image
      const response = await fetch(imageUrl);
      if (!response.ok) {
        throw new Error(`Failed to fetch image: ${response.statusText}`);
      }
      
      const imageBuffer = await response.arrayBuffer();
      const base64Image = Buffer.from(imageBuffer).toString('base64');
      
      // Determine media type from URL or response
      const contentType = response.headers.get('content-type') || 'image/jpeg';
      
      console.log('[🖼️  Claude Vision] Analyzing image:', {
        url: imageUrl.substring(0, 100) + '...',
        size: imageBuffer.byteLength,
        type: contentType
      });
      
      const result = await client.messages.create({
        model: modelName,
        max_tokens: 1000,
        messages: [{
          role: 'user',
          content: [
            {
              type: 'image',
              source: {
                type: 'base64',
                media_type: contentType,
                data: base64Image
              }
            },
            {
              type: 'text',
              text: prompt
            }
          ]
        }]
      });
      
      const analysis = this.extractTextContent(result);
      
      console.log('[🖼️  Claude Vision] Analysis completed:', analysis.substring(0, 200) + '...');
      
      return {
        analysis,
        tokensUsed: result.usage.input_tokens + result.usage.output_tokens
      };
      
    } catch (error) {
      console.error('Claude vision analysis failed:', error);
      throw error;
    }
  }
  
  /**
   * Generate hypothesis using Claude
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
    const client = getAnthropicClient();
    if (!client) {
      throw new Error('Claude client not initialized. Please set ANTHROPIC_API_KEY environment variable.');
    }
    
    const modelName = CLAUDE_MODEL_MAP[model];
    
    console.log('[🤖 Claude Hypothesis] Input:', {
      model: modelName,
      video: videoContext.title,
      performance: `${videoContext.tps}x baseline`,
      format: videoContext.formatType,
      niche: videoContext.topicNiche
    });
    
    // Use a tool to force JSON output
    const response = await client.messages.create({
      model: modelName,
      max_tokens: 1000,
      system: `${systemPrompt}\n\nYou MUST use the generate_hypothesis tool to provide your analysis. Do not respond with plain text.`,
      tools: [{
        name: 'generate_hypothesis',
        description: 'Generate a testable hypothesis about video performance',
        input_schema: {
          type: 'object',
          properties: {
            statement: {
              type: 'string',
              description: 'Clear hypothesis statement about why this video is successful'
            },
            confidence: {
              type: 'number',
              minimum: 0,
              maximum: 1,
              description: 'Confidence level in the hypothesis'
            },
            reasoning: {
              type: 'string',
              description: 'Detailed explanation of supporting reasoning for this hypothesis'
            },
            testableWith: {
              type: 'array',
              items: { type: 'string' },
              description: 'Tools that can be used to test this hypothesis'
            }
          },
          required: ['statement', 'confidence', 'reasoning', 'testableWith']
        }
      }],
      tool_choice: { type: 'tool', name: 'generate_hypothesis' },
      messages: [{
        role: 'user',
        content: `Based on the video context:
- Title: ${videoContext.title}
- TPS: ${videoContext.tps}
- Channel: ${videoContext.channelName}
- Format: ${videoContext.formatType || 'unknown'}
- Topic: ${videoContext.topicNiche || 'unknown'}

Generate a testable hypothesis about why this video might be outperforming using the generate_hypothesis tool.`
      }]
    });
    
    // Parse tool use response
    const toolCalls = this.parseToolCallsFromResponse(response);
    
    if (toolCalls.length === 0) {
      const content = this.extractTextContent(response);
      console.log('[🤖 Claude Hypothesis] No tool calls, raw response:', content.substring(0, 300) + '...');
      throw new Error('Claude did not use the generate_hypothesis tool');
    }
    
    const hypothesisCall = toolCalls[0];
    console.log('[🤖 Claude Hypothesis] Tool input:', JSON.stringify(hypothesisCall.input));
    
    const hypothesis = {
      statement: hypothesisCall.input.statement,
      confidence: hypothesisCall.input.confidence,
      supportingEvidence: hypothesisCall.input.reasoning ? [hypothesisCall.input.reasoning] : [],
      testableWith: hypothesisCall.input.testableWith || []
    };
    
    console.log('[🧠 Claude Logic] Hypothesis:', hypothesis.statement);
    console.log('[🧠 Claude Logic] Confidence:', hypothesis.confidence);
    
    return hypothesis;
  }
  
  /**
   * Generate final report using Claude
   */
  async generateFinalReport(
    systemPrompt: string,
    analysisState: any,
    model: ModelType = 'gpt-5'
  ): Promise<any> {
    console.log('[📊 Claude Final Report] Generating with context:', {
      hasHypothesis: !!analysisState.hypothesis,
      candidatesAnalyzed: analysisState.searchResults?.totalCandidates || 0,
      validatedCount: analysisState.validationResults?.validated || 0
    });
    
    const client = getAnthropicClient();
    if (!client) {
      throw new Error('Claude client not initialized. Please set ANTHROPIC_API_KEY environment variable.');
    }
    
    const modelName = CLAUDE_MODEL_MAP[model];
    
    const userMessage = `Generate the final pattern analysis report based on this analysis:

Video Context:
${JSON.stringify(analysisState.videoContext, null, 2)}

Hypothesis:
${JSON.stringify(analysisState.hypothesis, null, 2)}

Validation Results:
${JSON.stringify(analysisState.validationResults, null, 2)}

Search Results:
Total candidates analyzed: ${analysisState.searchResults?.totalCandidates || 0}

Generate a complete FinalPatternReport as JSON with ALL required fields.`;
    
    const response = await client.messages.create({
      model: modelName,
      max_tokens: 2000,
      system: systemPrompt,
      messages: [{
        role: 'user',
        content: userMessage
      }]
    });
    
    const content = this.extractTextContent(response);
    console.log('[📊 Claude Final Report] Raw response length:', content.length);
    console.log('[📊 Claude Final Report] Response preview:', content.substring(0, 500) + '...');
    
    try {
      const report = JSON.parse(content);
      
      if (report.primaryPattern) {
        console.log('[🎯 Claude Findings] Primary pattern:', report.primaryPattern.statement);
        console.log('[🎯 Claude Findings] Confidence:', report.primaryPattern.confidence);
        console.log('[🎯 Claude Findings] Evidence count:', report.primaryPattern.evidence?.length || 0);
      }
      console.log('[🎯 Claude Findings] Secondary patterns:', report.secondaryPatterns?.length || 0);
      console.log('[🎯 Claude Findings] Recommendations:', report.recommendations?.length || 0);
      
      return report;
    } catch (error) {
      throw new Error(`Failed to parse final report JSON: ${error}`);
    }
  }
  
  /**
   * Convert tool definitions to Claude format
   */
  private convertToolsToClaude(tools: ToolDefinition[]): any[] {
    return tools.map(tool => ({
      name: tool.name,
      description: tool.description,
      input_schema: tool.parameters || {
        type: 'object',
        properties: {},
        required: []
      }
    }));
  }
  
  /**
   * Parse tool calls from Claude response
   */
  private parseToolCallsFromResponse(response: any): any[] {
    const toolCalls: any[] = [];
    
    if (response.content && Array.isArray(response.content)) {
      for (const block of response.content) {
        if (block.type === 'tool_use') {
          toolCalls.push({
            id: block.id,
            name: block.name,
            input: block.input
          });
        }
      }
    }
    
    return toolCalls;
  }
  
  /**
   * Extract text content from Claude response
   */
  private extractTextContent(response: any): string {
    if (response.content && Array.isArray(response.content)) {
      const textBlocks = response.content.filter(block => block.type === 'text');
      return textBlocks.map(block => block.text).join('\n');
    }
    
    return '';
  }
  
  /**
   * Clear conversation history for a session
   */
  clearSession(sessionId: string): void {
    this.conversationHistory.delete(sessionId);
    console.log(`[🔗 Claude Session] Cleared session ${sessionId}`);
  }
}

/**
 * Singleton instance
 */
export const claudeIntegration = new ClaudeIntegration();

/**
 * Helper function to check if Claude API key is configured
 */
export function isClaudeConfigured(): boolean {
  const hasKey = Boolean(process.env.ANTHROPIC_API_KEY);
  if (!hasKey) {
    console.log('[Claude] API key check failed - env var not found');
  }
  return hasKey;
}

/**
 * Cost estimation for Claude models
 */
export const CLAUDE_MODEL_COSTS = {
  'gpt-5': { input: 0.003, output: 0.015 },       // Claude Sonnet pricing
  'gpt-5-mini': { input: 0.0003, output: 0.0015 }, // Claude Haiku pricing
  'gpt-5-nano': { input: 0.0003, output: 0.0015 }  // Claude Haiku pricing
};

/**
 * Calculate cost for a completion
 */
export function calculateCost(
  model: ModelType,
  inputTokens: number,
  outputTokens: number
): number {
  const costs = CLAUDE_MODEL_COSTS[model];
  const inputCost = (inputTokens / 1000) * costs.input;
  const outputCost = (outputTokens / 1000) * costs.output;
  return inputCost + outputCost;
}