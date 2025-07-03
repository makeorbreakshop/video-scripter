/**
 * Pinecone service for semantic search on YouTube video titles
 * Handles vector operations for the title embeddings system
 */

import { Pinecone } from '@pinecone-database/pinecone';

interface VideoMetadata {
  title: string;
  channel_id: string;
  channel_name?: string;
  view_count: number;
  published_at: string;
  performance_ratio: number;
  embedding_version: string;
}

interface PineconeVector {
  id: string;
  values: number[];
  metadata: VideoMetadata;
}

interface SearchResult {
  video_id: string;
  title: string;
  channel_id: string;
  channel_name?: string;
  view_count: number;
  published_at: string;
  performance_ratio: number;
  similarity_score: number;
}

export class PineconeService {
  private pinecone: Pinecone;
  private indexName: string;
  private initialized = false;

  constructor() {
    if (!process.env.PINECONE_API_KEY) {
      throw new Error('PINECONE_API_KEY environment variable is required');
    }
    
    if (!process.env.PINECONE_INDEX_NAME) {
      throw new Error('PINECONE_INDEX_NAME environment variable is required');
    }

    this.pinecone = new Pinecone({
      apiKey: process.env.PINECONE_API_KEY,
    });
    
    this.indexName = process.env.PINECONE_INDEX_NAME;
  }

  /**
   * Initialize the Pinecone index connection
   */
  async initializeIndex() {
    if (this.initialized) return;

    try {
      console.log(`🔌 Connecting to Pinecone index: ${this.indexName}`);
      
      // Test the connection by getting index stats
      const index = this.pinecone.index(this.indexName);
      const stats = await index.describeIndexStats();
      
      console.log(`✅ Connected to Pinecone index with ${stats.totalVectorCount} vectors`);
      this.initialized = true;
    } catch (error) {
      console.error('❌ Failed to connect to Pinecone index:', error);
      throw error;
    }
  }

  /**
   * Upsert video title embeddings to Pinecone
   */
  async upsertEmbeddings(vectors: PineconeVector[]): Promise<void> {
    await this.initializeIndex();
    
    if (!vectors || vectors.length === 0) {
      console.log('⚠️ No vectors to upsert');
      return;
    }

    try {
      console.log(`📤 Upserting ${vectors.length} vectors to Pinecone`);
      
      const index = this.pinecone.index(this.indexName);
      
      // Log vector structure for debugging
      console.log('🔍 First vector structure:', JSON.stringify(vectors[0], null, 2));
      
      // Try with minimal test vector first
      const testVector = {
        id: 'test-123',
        values: new Array(512).fill(0.1),
        metadata: { test: 'data' }
      };
      
      console.log('🧪 Testing with minimal vector:', JSON.stringify(testVector, null, 2));
      
      try {
        await index.upsert([testVector]);
        console.log('✅ Test vector worked! Now trying actual vector...');
        await index.upsert(vectors);
      } catch (testError) {
        console.log('❌ Even test vector failed:', testError);
        throw testError;
      }
      
      console.log(`✅ Successfully upserted ${vectors.length} vectors`);
    } catch (error) {
      console.error('❌ Failed to upsert vectors:', error);
      throw error;
    }
  }

  /**
   * Search for similar video titles using semantic search
   */
  async searchSimilar(
    queryEmbedding: number[],
    limit: number = 20,
    minScore: number = 0.7
  ): Promise<SearchResult[]> {
    await this.initializeIndex();

    try {
      console.log(`🔍 Searching for similar videos (limit: ${limit}, minScore: ${minScore})`);
      
      const index = this.pinecone.index(this.indexName);
      const queryResponse = await index.query({
        vector: queryEmbedding,
        topK: limit,
        includeMetadata: true,
      });

      // Transform results and filter by minimum score
      const results: SearchResult[] = queryResponse.matches
        ?.filter(match => (match.score || 0) >= minScore)
        .map(match => ({
          video_id: match.id as string, // Use match.id instead of metadata.id
          title: match.metadata?.title as string,
          channel_id: match.metadata?.channel_id as string,
          channel_name: match.metadata?.channel_name as string,
          view_count: match.metadata?.view_count as number,
          published_at: match.metadata?.published_at as string,
          performance_ratio: match.metadata?.performance_ratio as number,
          similarity_score: match.score || 0,
        })) || [];

      console.log(`✅ Found ${results.length} similar videos`);
      return results;
    } catch (error) {
      console.error('❌ Failed to search similar videos:', error);
      throw error;
    }
  }

  /**
   * Delete embeddings by video IDs
   */
  async deleteEmbeddings(videoIds: string[]): Promise<void> {
    await this.initializeIndex();
    
    if (!videoIds || videoIds.length === 0) {
      console.log('⚠️ No video IDs to delete');
      return;
    }

    try {
      console.log(`🗑️ Deleting ${videoIds.length} vectors from Pinecone`);
      
      const index = this.pinecone.index(this.indexName);
      await index.deleteMany(videoIds);
      
      console.log(`✅ Successfully deleted ${videoIds.length} vectors`);
    } catch (error) {
      console.error('❌ Failed to delete vectors:', error);
      throw error;
    }
  }

  /**
   * Get index statistics
   */
  async getIndexStats() {
    await this.initializeIndex();

    try {
      const index = this.pinecone.index(this.indexName);
      const stats = await index.describeIndexStats();
      
      return {
        totalVectorCount: stats.totalVectorCount,
        dimension: stats.dimension,
        indexFullness: stats.indexFullness,
        namespaces: stats.namespaces,
      };
    } catch (error) {
      console.error('❌ Failed to get index stats:', error);
      throw error;
    }
  }

  /**
   * Check if vectors exist for given video IDs
   */
  async checkVectorsExist(videoIds: string[]): Promise<string[]> {
    await this.initializeIndex();

    try {
      const index = this.pinecone.index(this.indexName);
      const fetchResponse = await index.fetch(videoIds);
      
      return Object.keys(fetchResponse.vectors || {});
    } catch (error) {
      console.error('❌ Failed to check vectors:', error);
      throw error;
    }
  }
}

// Export a singleton instance
export const pineconeService = new PineconeService();