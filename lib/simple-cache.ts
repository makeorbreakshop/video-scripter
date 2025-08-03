/**
 * Simple in-memory cache with TTL
 * Used to cache expensive database queries
 */
export class SimpleCache<T> {
  private cache = new Map<string, { data: T; timestamp: number }>();
  private ttl: number;

  constructor(ttlSeconds: number = 60) {
    this.ttl = ttlSeconds * 1000; // Convert to milliseconds
  }

  get(key: string): T | null {
    const cached = this.cache.get(key);
    if (!cached) return null;

    // Check if cache has expired
    if (Date.now() - cached.timestamp > this.ttl) {
      this.cache.delete(key);
      return null;
    }

    return cached.data;
  }

  set(key: string, data: T): void {
    this.cache.set(key, {
      data,
      timestamp: Date.now()
    });
  }

  clear(): void {
    this.cache.clear();
  }
}

// Global cache instances for different endpoints
export const viewTrackingStatsCache = new SimpleCache(30); // 30 second cache
export const updateAllStatsCache = new SimpleCache(300); // 5 minute cache for expensive queries
export const vectorizationProgressCache = new SimpleCache(60); // 1 minute cache
export const queueStatsCache = new SimpleCache(30); // 30 second cache