/**
 * Tool Executor for Idea Heist Agentic Mode
 * Handles real execution of tool API endpoints
 */

import { ToolDefinition, ToolContext } from '@/types/orchestrator';

/**
 * Base URL for API calls - uses relative URLs in production
 */
const getBaseUrl = () => {
  if (typeof window !== 'undefined') {
    // Client-side: use relative URL
    return '';
  }
  // Server-side: use full URL
  const protocol = process.env.NODE_ENV === 'production' ? 'https' : 'http';
  let host = process.env.VERCEL_URL || process.env.NEXT_PUBLIC_APP_URL || process.env.APP_URL || '';
  
  // Clean up host to remove protocol if it exists
  host = host.replace(/^https?:\/\//, '');
  
  if (!host) {
    // Fall back to relative URL if we cannot resolve a host in this environment
    return '';
  }
  return `${protocol}://${host}`;
};

/**
 * Execute a tool by calling its API endpoint
 */
export async function executeToolEndpoint(
  tool: ToolDefinition,
  params: any,
  context: ToolContext
): Promise<any> {
  const baseUrl = getBaseUrl();
  const endpoint = getToolEndpoint(tool.name);
  
  if (!endpoint) {
    throw new Error(`No endpoint defined for tool: ${tool.name}`);
  }
  
  const url = `${baseUrl}${endpoint}`;
  
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-request-id': context.requestId,
        'x-session-id': context.sessionId,
        'x-analysis-mode': context.mode
      },
      body: JSON.stringify(params)
    });
    
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Tool ${tool.name} failed: ${response.statusText} - ${errorText}`);
    }
    
    const result = await response.json();
    
    // Check if the tool response indicates an error
    if (result.success === false && result.error) {
      throw new Error(result.error.message || 'Tool execution failed');
    }
    
    // Return the data portion of successful responses
    return result.data || result;
    
  } catch (error) {
    console.error(`Error executing tool ${tool.name}:`, error);
    throw error;
  }
}

/**
 * Map tool names to their API endpoints
 */
function getToolEndpoint(toolName: string): string | null {
  const endpoints: Record<string, string> = {
    // Context tools
    'get_video_bundle': '/api/tools/get-video-bundle',
    'get_channel_baseline': '/api/tools/get-channel-baseline',
    'list_channel_history': '/api/tools/list-channel-history',
    
    // Search tools
    'search_titles': '/api/tools/search-titles',
    'search_summaries': '/api/tools/search-summaries',
    'search_thumbs': '/api/tools/search-thumbs',
    
    // Enrichment tools
    'perf_snapshot': '/api/tools/perf-snapshot',
    'fetch_thumbs': '/api/tools/fetch-thumbs',
    'topic_lookup': '/api/tools/topic-lookup',
    
    // Performance analysis tools
    'get_performance_timeline': '/api/tools/get-performance-timeline',
    'get_channel_performance_distribution': '/api/tools/get-channel-performance-distribution',
    'find_competitive_successes': '/api/tools/find-competitive-successes',
    
    // Novelty detection tools
    'detect_novelty_factors': '/api/tools/detect-novelty-factors',
    'find_content_gaps': '/api/tools/find-content-gaps',
    
    // Semantic intelligence tools
    'calculate_pattern_significance': '/api/tools/calculate-pattern-significance',
    'find_correlated_features': '/api/tools/find-correlated-features',
    'get_comprehensive_video_analysis': '/api/tools/get-comprehensive-video-analysis',
    'suggest_pattern_hypotheses': '/api/tools/suggest-pattern-hypotheses'
  };
  
  return endpoints[toolName] || null;
}

/**
 * Execute multiple tools in parallel
 */
export async function executeToolsInParallel(
  tools: Array<{ tool: ToolDefinition; params: any }>,
  context: ToolContext
): Promise<Array<{ toolName: string; result?: any; error?: any }>> {
  const promises = tools.map(async ({ tool, params }) => {
    try {
      const result = await executeToolEndpoint(tool, params, context);
      return { toolName: tool.name, result };
    } catch (error) {
      return { toolName: tool.name, error: String(error) };
    }
  });
  
  return Promise.all(promises);
}

/**
 * Validate tool parameters before execution
 */
export function validateToolParams(
  tool: ToolDefinition,
  params: any
): { valid: boolean; errors?: string[] } {
  const errors: string[] = [];
  
  if (!tool.parameters) {
    return { valid: true };
  }
  
  const schema = tool.parameters as any;
  
  // Check required parameters
  if (schema.required && Array.isArray(schema.required)) {
    for (const required of schema.required) {
      if (!(required in params)) {
        errors.push(`Missing required parameter: ${required}`);
      }
    }
  }
  
  // Basic type checking for properties
  if (schema.properties) {
    for (const [key, propSchema] of Object.entries(schema.properties) as any) {
      if (key in params) {
        const value = params[key];
        const expectedType = propSchema.type;
        
        if (expectedType === 'string' && typeof value !== 'string') {
          errors.push(`Parameter ${key} should be a string`);
        } else if (expectedType === 'number' && typeof value !== 'number') {
          errors.push(`Parameter ${key} should be a number`);
        } else if (expectedType === 'boolean' && typeof value !== 'boolean') {
          errors.push(`Parameter ${key} should be a boolean`);
        } else if (expectedType === 'array' && !Array.isArray(value)) {
          errors.push(`Parameter ${key} should be an array`);
        } else if (expectedType === 'object' && typeof value !== 'object') {
          errors.push(`Parameter ${key} should be an object`);
        }
        
        // Check max/min for numbers
        if (expectedType === 'number') {
          if (propSchema.maximum !== undefined && value > propSchema.maximum) {
            errors.push(`Parameter ${key} exceeds maximum value of ${propSchema.maximum}`);
          }
          if (propSchema.minimum !== undefined && value < propSchema.minimum) {
            errors.push(`Parameter ${key} is below minimum value of ${propSchema.minimum}`);
          }
        }
      }
    }
  }
  
  return {
    valid: errors.length === 0,
    errors: errors.length > 0 ? errors : undefined
  };
}

/**
 * Tool execution cache for avoiding duplicate calls
 */
class ToolExecutionCache {
  private cache: Map<string, { result: any; timestamp: number }> = new Map();
  private ttl: number = 5 * 60 * 1000; // 5 minutes default TTL
  
  getCacheKey(toolName: string, params: any): string {
    return `${toolName}:${JSON.stringify(params)}`;
  }
  
  get(toolName: string, params: any): any | null {
    const key = this.getCacheKey(toolName, params);
    const cached = this.cache.get(key);
    
    if (cached) {
      const age = Date.now() - cached.timestamp;
      if (age < this.ttl) {
        return cached.result;
      }
      // Remove expired entry
      this.cache.delete(key);
    }
    
    return null;
  }
  
  set(toolName: string, params: any, result: any): void {
    const key = this.getCacheKey(toolName, params);
    this.cache.set(key, {
      result,
      timestamp: Date.now()
    });
  }
  
  clear(): void {
    this.cache.clear();
  }
  
  setTTL(ttlMs: number): void {
    this.ttl = ttlMs;
  }
}

// Export a singleton cache instance
export const toolCache = new ToolExecutionCache();

/**
 * Execute a tool with caching
 */
export async function executeToolWithCache(
  tool: ToolDefinition,
  params: any,
  context: ToolContext,
  useCache: boolean = true
): Promise<any> {
  // Check cache first if enabled
  if (useCache && tool.cacheable) {
    const cached = toolCache.get(tool.name, params);
    if (cached !== null) {
      console.log(`Using cached result for ${tool.name}`);
      return cached;
    }
  }
  
  // Validate parameters
  const validation = validateToolParams(tool, params);
  if (!validation.valid) {
    throw new Error(`Invalid parameters for ${tool.name}: ${validation.errors?.join(', ')}`);
  }
  
  // Execute the tool
  const result = await executeToolEndpoint(tool, params, context);
  
  // Cache the result if cacheable
  if (useCache && tool.cacheable) {
    toolCache.set(tool.name, params, result);
  }
  
  return result;
}