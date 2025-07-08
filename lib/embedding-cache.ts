/**
 * Embedding cache service to store generated embeddings temporarily
 * Prevents re-processing if Pinecone upload fails
 */

import fs from 'fs/promises';
import path from 'path';

interface CachedEmbedding {
  videoId: string;
  thumbnailUrl: string;
  embedding: number[];
  timestamp: number;
  cost: number;
}

interface CacheMetadata {
  totalCost: number;
  totalEmbeddings: number;
  lastUpdated: number;
}

const CACHE_DIR = path.join(process.cwd(), '.cache', 'thumbnails');
const CACHE_FILE = path.join(CACHE_DIR, 'embeddings.json');
const METADATA_FILE = path.join(CACHE_DIR, 'metadata.json');
const CACHE_EXPIRY_HOURS = 24; // Cache expires after 24 hours

export class EmbeddingCache {
  private cache: Map<string, CachedEmbedding> = new Map();
  private metadata: CacheMetadata = {
    totalCost: 0,
    totalEmbeddings: 0,
    lastUpdated: 0
  };
  private initialized = false;

  /**
   * Initialize cache by loading from disk
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    try {
      // Ensure cache directory exists
      await fs.mkdir(CACHE_DIR, { recursive: true });

      // Load existing cache
      try {
        const cacheData = await fs.readFile(CACHE_FILE, 'utf-8');
        const cachedEmbeddings: CachedEmbedding[] = JSON.parse(cacheData);
        
        // Filter out expired entries
        const now = Date.now();
        const validEmbeddings = cachedEmbeddings.filter(entry => 
          (now - entry.timestamp) < (CACHE_EXPIRY_HOURS * 60 * 60 * 1000)
        );

        // Load into memory
        for (const entry of validEmbeddings) {
          this.cache.set(entry.videoId, entry);
        }

        console.log(`📦 Loaded ${validEmbeddings.length} cached embeddings (${cachedEmbeddings.length - validEmbeddings.length} expired)`);
      } catch (error) {
        // Cache file doesn't exist or is invalid, start fresh
        console.log('📦 Starting with empty embedding cache');
      }

      // Load metadata
      try {
        const metadataData = await fs.readFile(METADATA_FILE, 'utf-8');
        this.metadata = JSON.parse(metadataData);
      } catch (error) {
        // Metadata file doesn't exist, start fresh
        console.log('📦 Starting with fresh metadata');
      }

      this.initialized = true;
    } catch (error) {
      console.error('❌ Failed to initialize embedding cache:', error);
      this.initialized = true; // Continue without cache
    }
  }

  /**
   * Get cached embedding for a video
   */
  async getCachedEmbedding(videoId: string): Promise<number[] | null> {
    await this.initialize();

    const cached = this.cache.get(videoId);
    if (!cached) return null;

    // Check if expired
    const now = Date.now();
    if ((now - cached.timestamp) > (CACHE_EXPIRY_HOURS * 60 * 60 * 1000)) {
      this.cache.delete(videoId);
      return null;
    }

    console.log(`💾 Using cached embedding for ${videoId}`);
    return cached.embedding;
  }

  /**
   * Cache a new embedding
   */
  async cacheEmbedding(
    videoId: string, 
    thumbnailUrl: string, 
    embedding: number[], 
    cost: number = 0.00098
  ): Promise<void> {
    await this.initialize();

    const cached: CachedEmbedding = {
      videoId,
      thumbnailUrl,
      embedding,
      timestamp: Date.now(),
      cost
    };

    this.cache.set(videoId, cached);
    
    // Update metadata
    this.metadata.totalCost += cost;
    this.metadata.totalEmbeddings += 1;
    this.metadata.lastUpdated = Date.now();

    console.log(`💾 Cached embedding for ${videoId} (cost: $${cost.toFixed(5)})`);
  }

  /**
   * Get multiple cached embeddings
   */
  async getCachedEmbeddings(videoIds: string[]): Promise<{
    cached: Array<{ videoId: string; embedding: number[] }>;
    missing: string[];
  }> {
    await this.initialize();

    const cached: Array<{ videoId: string; embedding: number[] }> = [];
    const missing: string[] = [];

    for (const videoId of videoIds) {
      const embedding = await this.getCachedEmbedding(videoId);
      if (embedding) {
        cached.push({ videoId, embedding });
      } else {
        missing.push(videoId);
      }
    }

    return { cached, missing };
  }

  /**
   * Save cache to disk
   */
  async persist(): Promise<void> {
    if (!this.initialized) return;

    try {
      // Convert map to array
      const cacheArray = Array.from(this.cache.values());
      
      // Save cache data
      await fs.writeFile(CACHE_FILE, JSON.stringify(cacheArray, null, 2));
      
      // Save metadata
      await fs.writeFile(METADATA_FILE, JSON.stringify(this.metadata, null, 2));
      
      console.log(`💾 Persisted ${cacheArray.length} embeddings to cache (total cost: $${this.metadata.totalCost.toFixed(2)})`);
    } catch (error) {
      console.error('❌ Failed to persist embedding cache:', error);
    }
  }

  /**
   * Clear expired entries and save
   */
  async cleanup(): Promise<void> {
    await this.initialize();

    const now = Date.now();
    const before = this.cache.size;
    
    for (const [videoId, cached] of this.cache.entries()) {
      if ((now - cached.timestamp) > (CACHE_EXPIRY_HOURS * 60 * 60 * 1000)) {
        this.cache.delete(videoId);
      }
    }

    const after = this.cache.size;
    const removed = before - after;

    if (removed > 0) {
      console.log(`🧹 Cleaned up ${removed} expired embeddings`);
      await this.persist();
    }
  }

  /**
   * Get cache statistics
   */
  async getStats(): Promise<{
    cachedCount: number;
    totalCost: number;
    totalEmbeddings: number;
    lastUpdated: Date | null;
    oldestEntry: Date | null;
    newestEntry: Date | null;
  }> {
    await this.initialize();

    let oldestTimestamp = Infinity;
    let newestTimestamp = 0;

    for (const cached of this.cache.values()) {
      oldestTimestamp = Math.min(oldestTimestamp, cached.timestamp);
      newestTimestamp = Math.max(newestTimestamp, cached.timestamp);
    }

    return {
      cachedCount: this.cache.size,
      totalCost: this.metadata.totalCost,
      totalEmbeddings: this.metadata.totalEmbeddings,
      lastUpdated: this.metadata.lastUpdated ? new Date(this.metadata.lastUpdated) : null,
      oldestEntry: oldestTimestamp < Infinity ? new Date(oldestTimestamp) : null,
      newestEntry: newestTimestamp > 0 ? new Date(newestTimestamp) : null,
    };
  }

  /**
   * Clear all cache data
   */
  async clear(): Promise<void> {
    await this.initialize();
    
    this.cache.clear();
    this.metadata = {
      totalCost: 0,
      totalEmbeddings: 0,
      lastUpdated: 0
    };

    try {
      await fs.unlink(CACHE_FILE);
      await fs.unlink(METADATA_FILE);
      console.log('🧹 Cleared embedding cache');
    } catch (error) {
      // Files might not exist, that's fine
    }
  }
}

// Export singleton instance
export const embeddingCache = new EmbeddingCache();