/**
 * Adaptive Rate Limiter for API requests
 * Dynamically adjusts concurrency and delays based on response patterns
 */

interface RateLimiterConfig {
  maxRequestsPerSecond: number;
  targetUtilization: number; // 0.0 - 1.0 (e.g., 0.85 = 85%)
  minConcurrency: number;
  maxConcurrency: number;
  backoffMultiplier: number;
  recoveryMultiplier: number;
  sampleWindowMs: number;
}

interface RequestMetrics {
  timestamp: number;
  duration: number;
  success: boolean;
  rateLimited: boolean;
}

export class AdaptiveRateLimiter {
  private config: RateLimiterConfig;
  private currentConcurrency: number;
  private requestHistory: RequestMetrics[] = [];
  private consecutiveRateLimits: number = 0;
  private lastAdjustmentTime: number = Date.now();
  private totalRequests: number = 0;
  private rateLimitedRequests: number = 0;

  constructor(config: Partial<RateLimiterConfig> = {}) {
    this.config = {
      maxRequestsPerSecond: 10, // Replicate's limit
      targetUtilization: 0.85, // Target 85% of max
      minConcurrency: 1,
      maxConcurrency: 10,
      backoffMultiplier: 0.5, // Reduce by 50% on rate limit
      recoveryMultiplier: 1.1, // Increase by 10% when stable
      sampleWindowMs: 5000, // 5 second rolling window
      ...config
    };
    
    // Start at a conservative concurrency level
    this.currentConcurrency = Math.min(5, this.config.maxConcurrency);
  }

  /**
   * Get current concurrency level
   */
  getConcurrency(): number {
    return this.currentConcurrency;
  }

  /**
   * Calculate delay between batches based on current metrics
   */
  getDelayMs(): number {
    const targetRequestsPerSecond = this.config.maxRequestsPerSecond * this.config.targetUtilization;
    const delayBetweenBatches = (this.currentConcurrency / targetRequestsPerSecond) * 1000;
    return Math.max(100, Math.round(delayBetweenBatches)); // Minimum 100ms
  }

  /**
   * Record a request and update metrics
   */
  recordRequest(duration: number, success: boolean, rateLimited: boolean = false): void {
    const metric: RequestMetrics = {
      timestamp: Date.now(),
      duration,
      success,
      rateLimited
    };

    this.requestHistory.push(metric);
    this.totalRequests++;
    
    if (rateLimited) {
      this.rateLimitedRequests++;
      this.consecutiveRateLimits++;
      this.handleRateLimit();
    } else {
      this.consecutiveRateLimits = 0;
    }

    // Clean old metrics outside the sample window
    this.cleanOldMetrics();
    
    // Adjust concurrency if needed
    this.maybeAdjustConcurrency();
  }

  /**
   * Handle rate limit by immediately backing off
   */
  private handleRateLimit(): void {
    const newConcurrency = Math.max(
      this.config.minConcurrency,
      Math.floor(this.currentConcurrency * this.config.backoffMultiplier)
    );
    
    if (newConcurrency !== this.currentConcurrency) {
      console.log(`⚠️ Rate limit detected! Reducing concurrency: ${this.currentConcurrency} → ${newConcurrency}`);
      this.currentConcurrency = newConcurrency;
      this.lastAdjustmentTime = Date.now();
    }
  }

  /**
   * Periodically adjust concurrency based on performance
   */
  private maybeAdjustConcurrency(): void {
    const now = Date.now();
    const timeSinceLastAdjustment = now - this.lastAdjustmentTime;
    
    // Only adjust every 2 seconds to avoid thrashing
    if (timeSinceLastAdjustment < 2000) return;
    
    // Don't increase if we've had recent rate limits
    if (this.consecutiveRateLimits > 0) return;

    const recentMetrics = this.getRecentMetrics();
    if (recentMetrics.length < 10) return; // Need enough data

    const avgRequestsPerSecond = this.calculateRequestRate();
    const targetRate = this.config.maxRequestsPerSecond * this.config.targetUtilization;
    const utilizationRatio = avgRequestsPerSecond / targetRate;

    // If we're well below target and no rate limits, increase concurrency
    if (utilizationRatio < 0.8 && this.currentConcurrency < this.config.maxConcurrency) {
      const newConcurrency = Math.min(
        this.config.maxConcurrency,
        Math.ceil(this.currentConcurrency * this.config.recoveryMultiplier)
      );
      
      if (newConcurrency !== this.currentConcurrency) {
        console.log(`📈 Increasing concurrency: ${this.currentConcurrency} → ${newConcurrency} (utilization: ${(utilizationRatio * 100).toFixed(1)}%)`);
        this.currentConcurrency = newConcurrency;
        this.lastAdjustmentTime = now;
      }
    }
  }

  /**
   * Calculate current request rate
   */
  private calculateRequestRate(): number {
    const recentMetrics = this.getRecentMetrics();
    if (recentMetrics.length === 0) return 0;

    const timeSpanMs = Date.now() - recentMetrics[0].timestamp;
    if (timeSpanMs === 0) return 0;

    return (recentMetrics.length / timeSpanMs) * 1000; // requests per second
  }

  /**
   * Get metrics within the sample window
   */
  private getRecentMetrics(): RequestMetrics[] {
    const cutoffTime = Date.now() - this.config.sampleWindowMs;
    return this.requestHistory.filter(m => m.timestamp > cutoffTime);
  }

  /**
   * Clean metrics older than the sample window
   */
  private cleanOldMetrics(): void {
    const cutoffTime = Date.now() - this.config.sampleWindowMs * 2; // Keep 2x window for analysis
    this.requestHistory = this.requestHistory.filter(m => m.timestamp > cutoffTime);
  }

  /**
   * Get current statistics
   */
  getStats() {
    const recentMetrics = this.getRecentMetrics();
    const requestRate = this.calculateRequestRate();
    const targetRate = this.config.maxRequestsPerSecond * this.config.targetUtilization;
    
    return {
      currentConcurrency: this.currentConcurrency,
      requestRate: requestRate.toFixed(1),
      targetRate: targetRate.toFixed(1),
      utilization: ((requestRate / this.config.maxRequestsPerSecond) * 100).toFixed(1) + '%',
      totalRequests: this.totalRequests,
      rateLimitedRequests: this.rateLimitedRequests,
      rateLimitPercentage: this.totalRequests > 0 
        ? ((this.rateLimitedRequests / this.totalRequests) * 100).toFixed(2) + '%'
        : '0%',
      recentRequests: recentMetrics.length,
      avgDuration: recentMetrics.length > 0
        ? (recentMetrics.reduce((sum, m) => sum + m.duration, 0) / recentMetrics.length).toFixed(0) + 'ms'
        : 'N/A'
    };
  }

  /**
   * Reset the rate limiter
   */
  reset(): void {
    this.currentConcurrency = Math.min(5, this.config.maxConcurrency);
    this.requestHistory = [];
    this.consecutiveRateLimits = 0;
    this.lastAdjustmentTime = Date.now();
    this.totalRequests = 0;
    this.rateLimitedRequests = 0;
  }
}