/**
 * Error Recovery and Resilience Module
 * Provides retry logic, fallback mechanisms, and error recovery
 */

import { AgentLogger } from '../logger/agent-logger';

export interface RetryConfig {
  maxAttempts: number;
  initialDelay: number;
  maxDelay: number;
  backoffFactor: number;
  retryableErrors: string[];
}

export interface RecoveryStrategy {
  type: 'retry' | 'fallback' | 'partial' | 'skip';
  action: () => Promise<any>;
  description: string;
}

export class ErrorRecovery {
  private logger?: AgentLogger;
  private retryConfig: RetryConfig;
  private errorHistory: Map<string, Error[]> = new Map();
  
  constructor(logger?: AgentLogger, config?: Partial<RetryConfig>) {
    this.logger = logger;
    this.retryConfig = {
      maxAttempts: 3,
      initialDelay: 1000,
      maxDelay: 30000,
      backoffFactor: 2,
      retryableErrors: [
        'ENOTFOUND',
        'ECONNREFUSED',
        'ETIMEDOUT',
        'ECONNRESET',
        'rate_limit_exceeded',
        'timeout',
        'network_error'
      ],
      ...config
    };
  }
  
  /**
   * Execute function with retry logic
   */
  async executeWithRetry<T>(
    fn: () => Promise<T>,
    context: string,
    customConfig?: Partial<RetryConfig>
  ): Promise<T> {
    const config = { ...this.retryConfig, ...customConfig };
    let lastError: Error | null = null;
    let delay = config.initialDelay;
    
    for (let attempt = 1; attempt <= config.maxAttempts; attempt++) {
      try {
        this.logger?.log('debug', 'retry', `Attempt ${attempt}/${config.maxAttempts} for ${context}`);
        
        const result = await fn();
        
        // Success - clear error history
        this.errorHistory.delete(context);
        
        if (attempt > 1) {
          this.logger?.log('info', 'recovery', `Recovered after ${attempt} attempts: ${context}`);
        }
        
        return result;
        
      } catch (error: any) {
        lastError = error;
        
        // Record error
        if (!this.errorHistory.has(context)) {
          this.errorHistory.set(context, []);
        }
        this.errorHistory.get(context)!.push(error);
        
        // Check if retryable
        if (!this.isRetryableError(error, config)) {
          this.logger?.logError(error, `Non-retryable error in ${context}`);
          throw error;
        }
        
        // Check if we have attempts left
        if (attempt >= config.maxAttempts) {
          this.logger?.logError(error, `Max retry attempts exceeded for ${context}`);
          throw new Error(`Failed after ${config.maxAttempts} attempts: ${error.message}`);
        }
        
        // Log retry
        this.logger?.log('warn', 'retry', `Retrying ${context} after error: ${error.message}`, {
          attempt,
          delay,
          errorCode: error.code
        });
        
        // Wait before retry
        await this.delay(delay);
        
        // Exponential backoff
        delay = Math.min(delay * config.backoffFactor, config.maxDelay);
      }
    }
    
    throw lastError || new Error(`Failed to execute ${context}`);
  }
  
  /**
   * Determine recovery strategy for an error
   */
  async determineRecoveryStrategy(
    error: Error,
    context: string,
    options: {
      canFallback?: boolean;
      canPartial?: boolean;
      canSkip?: boolean;
      fallbackFn?: () => Promise<any>;
      partialFn?: () => Promise<any>;
    } = {}
  ): Promise<RecoveryStrategy> {
    const errorType = this.classifyError(error);
    
    // Network/transient errors - retry
    if (this.isRetryableError(error, this.retryConfig)) {
      return {
        type: 'retry',
        action: async () => {
          await this.delay(this.retryConfig.initialDelay);
          throw error; // Re-throw to trigger retry
        },
        description: `Retry due to ${errorType} error`
      };
    }
    
    // API quota/rate limit - fallback if available
    if (errorType === 'rate_limit' && options.canFallback && options.fallbackFn) {
      return {
        type: 'fallback',
        action: options.fallbackFn,
        description: 'Fallback to alternative method due to rate limit'
      };
    }
    
    // Partial failure - return partial results if available
    if (errorType === 'partial_failure' && options.canPartial && options.partialFn) {
      return {
        type: 'partial',
        action: options.partialFn,
        description: 'Return partial results due to incomplete operation'
      };
    }
    
    // Non-critical error - skip if allowed
    if (errorType === 'non_critical' && options.canSkip) {
      return {
        type: 'skip',
        action: async () => null,
        description: 'Skip non-critical operation'
      };
    }
    
    // No recovery possible
    throw error;
  }
  
  /**
   * Create checkpoint for recovery
   */
  async createCheckpoint(state: any, context: string): Promise<void> {
    try {
      const checkpoint = {
        timestamp: new Date().toISOString(),
        context,
        state: JSON.stringify(state)
      };
      
      // Store checkpoint (in production, this would go to database)
      if (this.logger) {
        this.logger.log('debug', 'checkpoint', `Checkpoint created for ${context}`, checkpoint);
      }
      
    } catch (error) {
      console.warn('Failed to create checkpoint:', error);
    }
  }
  
  /**
   * Restore from checkpoint
   */
  async restoreFromCheckpoint(context: string): Promise<any | null> {
    try {
      // In production, this would retrieve from database
      this.logger?.log('debug', 'checkpoint', `Attempting to restore checkpoint for ${context}`);
      return null;
      
    } catch (error) {
      console.warn('Failed to restore checkpoint:', error);
      return null;
    }
  }
  
  /**
   * Wrap a section with error boundary
   */
  async withErrorBoundary<T>(
    fn: () => Promise<T>,
    context: string,
    defaultValue: T
  ): Promise<T> {
    try {
      return await fn();
    } catch (error: any) {
      this.logger?.logError(error, `Error boundary triggered for ${context}`);
      
      // Attempt recovery
      try {
        const strategy = await this.determineRecoveryStrategy(error, context, {
          canSkip: true
        });
        
        if (strategy.type === 'skip') {
          return defaultValue;
        }
        
        return await strategy.action();
        
      } catch (recoveryError) {
        this.logger?.logError(recoveryError, `Recovery failed for ${context}`);
        return defaultValue;
      }
    }
  }
  
  /**
   * Circuit breaker pattern
   */
  private circuitBreakers: Map<string, {
    failures: number;
    lastFailure: number;
    isOpen: boolean;
  }> = new Map();
  
  async withCircuitBreaker<T>(
    fn: () => Promise<T>,
    context: string,
    options: {
      failureThreshold?: number;
      resetTimeout?: number;
    } = {}
  ): Promise<T> {
    const { failureThreshold = 5, resetTimeout = 60000 } = options;
    
    // Get or create circuit breaker
    if (!this.circuitBreakers.has(context)) {
      this.circuitBreakers.set(context, {
        failures: 0,
        lastFailure: 0,
        isOpen: false
      });
    }
    
    const breaker = this.circuitBreakers.get(context)!;
    
    // Check if circuit should be reset
    if (breaker.isOpen && Date.now() - breaker.lastFailure > resetTimeout) {
      breaker.isOpen = false;
      breaker.failures = 0;
      this.logger?.log('info', 'circuit', `Circuit breaker reset for ${context}`);
    }
    
    // Check if circuit is open
    if (breaker.isOpen) {
      throw new Error(`Circuit breaker open for ${context}`);
    }
    
    try {
      const result = await fn();
      
      // Success - reset failures
      breaker.failures = 0;
      return result;
      
    } catch (error) {
      breaker.failures++;
      breaker.lastFailure = Date.now();
      
      if (breaker.failures >= failureThreshold) {
        breaker.isOpen = true;
        this.logger?.log('error', 'circuit', `Circuit breaker opened for ${context}`, {
          failures: breaker.failures
        });
      }
      
      throw error;
    }
  }
  
  /**
   * Helper methods
   */
  
  private isRetryableError(error: any, config: RetryConfig): boolean {
    // Check error code
    if (error.code && config.retryableErrors.includes(error.code)) {
      return true;
    }
    
    // Check error message
    const message = error.message?.toLowerCase() || '';
    return config.retryableErrors.some(keyword => 
      message.includes(keyword.toLowerCase())
    );
  }
  
  private classifyError(error: any): string {
    const code = error.code || '';
    const message = error.message?.toLowerCase() || '';
    
    if (code.startsWith('E') || message.includes('network')) {
      return 'network';
    }
    if (message.includes('rate') || message.includes('limit')) {
      return 'rate_limit';
    }
    if (message.includes('timeout')) {
      return 'timeout';
    }
    if (message.includes('partial')) {
      return 'partial_failure';
    }
    if (error.severity === 'low' || message.includes('warning')) {
      return 'non_critical';
    }
    
    return 'unknown';
  }
  
  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
  
  /**
   * Get error statistics
   */
  getErrorStats(): Record<string, any> {
    const stats: Record<string, any> = {};
    
    for (const [context, errors] of this.errorHistory) {
      stats[context] = {
        count: errors.length,
        lastError: errors[errors.length - 1]?.message,
        errorTypes: [...new Set(errors.map(e => this.classifyError(e)))]
      };
    }
    
    return stats;
  }
}

/**
 * Create error recovery instance
 */
export function createErrorRecovery(
  logger?: AgentLogger,
  config?: Partial<RetryConfig>
): ErrorRecovery {
  return new ErrorRecovery(logger, config);
}