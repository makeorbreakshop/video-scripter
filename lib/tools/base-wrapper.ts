/**
 * Base wrapper for all tools with caching, error handling, and retry logic
 */

import { 
  ToolConfig, 
  ToolResponse, 
  ToolError, 
  ToolContext, 
  ToolMetrics 
} from '@/types/tools';
import { createHash } from 'crypto';

// Simple in-memory cache implementation (can be replaced with Redis)
class MemoryCache {
  private cache: Map<string, { value: any; expiry: number }> = new Map();

  async get(key: string): Promise<any | null> {
    const item = this.cache.get(key);
    if (!item) return null;
    
    if (Date.now() > item.expiry) {
      this.cache.delete(key);
      return null;
    }
    
    return item.value;
  }

  async set(key: string, value: any, ttl: number = 300): Promise<void> {
    const expiry = Date.now() + (ttl * 1000);
    this.cache.set(key, { value, expiry });
  }

  async delete(key: string): Promise<void> {
    this.cache.delete(key);
  }

  async exists(key: string): Promise<boolean> {
    const item = this.cache.get(key);
    if (!item) return false;
    
    if (Date.now() > item.expiry) {
      this.cache.delete(key);
      return false;
    }
    
    return true;
  }

  // Cleanup expired entries periodically
  cleanup(): void {
    const now = Date.now();
    for (const [key, item] of this.cache.entries()) {
      if (now > item.expiry) {
        this.cache.delete(key);
      }
    }
  }
}

// Global cache instance
const globalCache = new MemoryCache();

// Cleanup expired cache entries every minute
setInterval(() => globalCache.cleanup(), 60000);

// Simple logger implementation
class SimpleLogger {
  private prefix: string;

  constructor(prefix: string = '[Tool]') {
    this.prefix = prefix;
  }

  debug(message: string, data?: any): void {
    if (process.env.NODE_ENV === 'development') {
      console.debug(`${this.prefix} ${message}`, data || '');
    }
  }

  info(message: string, data?: any): void {
    console.info(`${this.prefix} ${message}`, data || '');
  }

  warn(message: string, data?: any): void {
    console.warn(`${this.prefix} ${message}`, data || '');
  }

  error(message: string, error?: any): void {
    console.error(`${this.prefix} ${message}`, error || '');
  }
}

/**
 * Create a cache key from tool name and parameters
 */
function createCacheKey(toolName: string, params: any): string {
  const paramString = JSON.stringify(params, Object.keys(params).sort());
  return createHash('md5').update(`${toolName}:${paramString}`).digest('hex');
}

/**
 * Sleep utility for retry backoff
 */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Wrap a tool handler with caching, error handling, and retry logic
 */
export function wrapTool(config: ToolConfig) {
  return async function wrappedHandler(
    params: any,
    context?: ToolContext
  ): Promise<ToolResponse<any>> {
    const startTime = Date.now();
    const cache = context?.cache || globalCache;
    const logger = context?.logger || new SimpleLogger(`[${config.name}]`);
    
    // Generate cache key if caching is enabled
    let cacheKey: string | null = null;
    if (config.cacheTTL && config.cacheTTL > 0) {
      cacheKey = createCacheKey(config.name, params);
      
      // Check cache
      try {
        const cachedValue = await cache.get(cacheKey);
        if (cachedValue !== null) {
          logger.debug('Cache hit', { cacheKey });
          return {
            success: true,
            data: cachedValue,
            metadata: {
              cached: true,
              executionTime: Date.now() - startTime,
              source: 'cache'
            }
          };
        }
      } catch (error) {
        logger.warn('Cache read error', error);
        // Continue without cache
      }
    }
    
    // Execute with retry logic
    const maxRetries = config.retryConfig?.maxRetries || 3;
    const backoffMs = config.retryConfig?.backoffMs || 1000;
    let lastError: any = null;
    
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        // Set timeout if configured
        let timeoutId: NodeJS.Timeout | null = null;
        const timeoutPromise = new Promise<never>((_, reject) => {
          if (config.timeout) {
            timeoutId = setTimeout(
              () => reject(new Error(`Tool timeout after ${config.timeout}ms`)),
              config.timeout
            );
          }
        });
        
        // Execute tool handler
        const handlerPromise = config.handler(params, context);
        
        const result = config.timeout
          ? await Promise.race([handlerPromise, timeoutPromise])
          : await handlerPromise;
        
        // Clear timeout
        if (timeoutId) clearTimeout(timeoutId);
        
        // Cache successful result
        if (cacheKey && result.success && config.cacheTTL) {
          try {
            await cache.set(cacheKey, result.data, config.cacheTTL);
            logger.debug('Cached result', { cacheKey, ttl: config.cacheTTL });
          } catch (error) {
            logger.warn('Cache write error', error);
            // Continue without caching
          }
        }
        
        // Add metadata
        result.metadata = {
          ...result.metadata,
          cached: false,
          executionTime: Date.now() - startTime,
          source: 'handler'
        };
        
        // Log metrics
        const metrics: ToolMetrics = {
          tool_name: config.name,
          execution_time_ms: Date.now() - startTime,
          cache_hit: false,
          error_occurred: !result.success,
          retry_count: attempt,
          payload_size_bytes: JSON.stringify(result.data || {}).length
        };
        logger.debug('Tool execution complete', metrics);
        
        return result;
        
      } catch (error: any) {
        lastError = error;
        logger.warn(`Attempt ${attempt + 1} failed`, { error: error.message });
        
        // Check if error is retryable
        const isRetryable = 
          error.code === 'ECONNRESET' ||
          error.code === 'ETIMEDOUT' ||
          error.message?.includes('timeout') ||
          error.message?.includes('rate limit') ||
          error.response?.status === 429 ||
          error.response?.status >= 500;
        
        if (!isRetryable || attempt === maxRetries - 1) {
          break;
        }
        
        // Exponential backoff
        const delay = backoffMs * Math.pow(2, attempt);
        logger.debug(`Retrying in ${delay}ms...`);
        await sleep(delay);
      }
    }
    
    // All retries failed
    const error: ToolError = {
      code: lastError?.code || 'TOOL_ERROR',
      message: lastError?.message || 'Tool execution failed',
      details: lastError,
      retryable: false
    };
    
    logger.error('Tool execution failed after retries', error);
    
    return {
      success: false,
      error,
      metadata: {
        cached: false,
        executionTime: Date.now() - startTime,
        source: 'error'
      }
    };
  };
}

/**
 * Execute multiple tools in parallel
 */
export async function executeParallel(
  tools: Array<{ config: ToolConfig; params: any }>,
  context?: ToolContext
): Promise<ToolResponse<any>[]> {
  const promises = tools.map(({ config, params }) => {
    if (!config.parallelSafe) {
      throw new Error(`Tool ${config.name} is not marked as parallel-safe`);
    }
    const wrapped = wrapTool(config);
    return wrapped(params, context);
  });
  
  return Promise.all(promises);
}

/**
 * Create a tool context with default implementations
 */
export function createToolContext(overrides?: Partial<ToolContext>): ToolContext {
  return {
    requestId: overrides?.requestId || crypto.randomUUID(),
    mode: overrides?.mode || 'agentic',
    cache: overrides?.cache || globalCache,
    logger: overrides?.logger || new SimpleLogger(),
    ...overrides
  };
}

export { MemoryCache, SimpleLogger };