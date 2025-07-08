/**
 * Pinecone thumbnail service for YouTube video visual similarity search
 * Handles vector operations for the thumbnail embeddings system using CLIP
 */

import { Pinecone } from '@pinecone-database/pinecone';
import { createClient } from '@supabase/supabase-js';

interface ThumbnailMetadata {
  title: string;
  channel_id: string;
  channel_name?: string;
  view_count: number;
  published_at: string;
  performance_ratio: number;
  thumbnail_url: string;
  embedding_version: string;
}

interface ThumbnailVector {
  id: string;
  values: number[];
  metadata: ThumbnailMetadata;
}

interface ThumbnailSearchResult {
  video_id: string;
  title: string;
  channel_id: string;
  channel_name?: string;
  view_count: number;
  published_at: string;
  performance_ratio: number;
  similarity_score: number;
  thumbnail_url: string;
}

export class PineconeThumbnailService {
  private pinecone: Pinecone;
  private indexName: string;
  private initialized = false;

  constructor() {
    if (!process.env.PINECONE_API_KEY) {
      throw new Error('PINECONE_API_KEY environment variable is required');
    }
    
    if (!process.env.PINECONE_THUMBNAIL_INDEX_NAME) {
      throw new Error('PINECONE_THUMBNAIL_INDEX_NAME environment variable is required');
    }

    this.pinecone = new Pinecone({
      apiKey: process.env.PINECONE_API_KEY,
    });
    
    this.indexName = process.env.PINECONE_THUMBNAIL_INDEX_NAME;
  }

  /**
   * Initialize the Pinecone thumbnail index connection
   */
  async initializeIndex() {
    if (this.initialized) return;

    try {
      console.log(`🖼️ Connecting to Pinecone thumbnail index: ${this.indexName}`);
      
      // Test the connection by getting index stats
      const index = this.pinecone.index(this.indexName);
      const stats = await index.describeIndexStats();
      
      console.log(`✅ Connected to thumbnail index with ${stats.totalVectorCount} vectors (${stats.dimension}D)`);
      this.initialized = true;
    } catch (error) {
      console.error('❌ Failed to connect to Pinecone thumbnail index:', error);
      throw error;
    }
  }

  /**
   * Upsert thumbnail embeddings to Pinecone
   */
  async upsertThumbnailEmbeddings(vectors: ThumbnailVector[]): Promise<void> {
    await this.initializeIndex();
    
    if (!vectors || vectors.length === 0) {
      console.log('⚠️ No thumbnail vectors to upsert');
      return;
    }

    // Pinecone has a 4MB request limit - chunk large batches to stay under limit
    const PINECONE_BATCH_SIZE = 100; // Safe size (~300KB per batch with 768-dim vectors)
    
    try {
      const index = this.pinecone.index(this.indexName);
      
      // Upload in chunks if batch is large
      if (vectors.length > PINECONE_BATCH_SIZE) {
        const totalChunks = Math.ceil(vectors.length / PINECONE_BATCH_SIZE);
        console.log(`\n📦 Pinecone Upload: ${vectors.length} vectors in ${totalChunks} chunks`);
        
        for (let i = 0; i < vectors.length; i += PINECONE_BATCH_SIZE) {
          const chunk = vectors.slice(i, i + PINECONE_BATCH_SIZE);
          const chunkNum = Math.floor(i / PINECONE_BATCH_SIZE) + 1;
          
          const percent = Math.round((chunkNum / totalChunks) * 100);
          const progressWidth = 20;
          const filledWidth = Math.round((percent / 100) * progressWidth);
          const progressBar = '█'.repeat(filledWidth) + '░'.repeat(progressWidth - filledWidth);
          
          console.log(`🔄 Chunk ${chunkNum}/${totalChunks}: [${progressBar}] ${percent}% (${chunk.length} vectors)`);
          await index.upsert(chunk);
          
          // Small delay between chunks to be gentle on API
          if (i + PINECONE_BATCH_SIZE < vectors.length) {
            await new Promise(resolve => setTimeout(resolve, 100));
          }
        }
      } else {
        await index.upsert(vectors);
      }
      
      console.log(`✅ Upserted ${vectors.length} thumbnail vectors to Pinecone`);
    } catch (error) {
      console.error('❌ Failed to upsert thumbnail vectors:', error);
      throw error;
    }
  }

  /**
   * Search for visually similar thumbnails using CLIP embeddings
   */
  async searchSimilarThumbnails(
    queryEmbedding: number[],
    limit: number = 20,
    minScore: number = 0.7,
    offset: number = 0
  ): Promise<{ results: ThumbnailSearchResult[], hasMore: boolean, totalAvailable: number }> {
    await this.initializeIndex();

    try {
      const index = this.pinecone.index(this.indexName);
      
      // Request more results than needed for pagination
      const maxResults = Math.max(100, offset + limit + 20);
      
      const queryResponse = await index.query({
        vector: queryEmbedding,
        topK: maxResults,
        includeMetadata: true,
      });

      // Get video IDs and scores from Pinecone, filter by score
      const allMatches = queryResponse.matches
        ?.filter(match => (match.score || 0) >= minScore)
        .map(match => ({
          video_id: match.id as string,
          similarity_score: match.score || 0,
          metadata: match.metadata as ThumbnailMetadata
        })) || [];

      if (allMatches.length === 0) {
        console.log(`✅ Found 0 similar thumbnails`);
        return { results: [], hasMore: false, totalAvailable: 0 };
      }

      // Apply pagination to the filtered results
      const paginatedMatches = allMatches.slice(offset, offset + limit);
      const hasMore = offset + limit < allMatches.length;
      
      if (paginatedMatches.length === 0) {
        console.log(`✅ No more thumbnail results for offset ${offset}`);
        return { results: [], hasMore: false, totalAvailable: allMatches.length };
      }

      // Enrich with current video data from Supabase for real-time performance ratios
      const supabase = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
      );

      const videoIds = paginatedMatches.map(match => match.video_id);
      
      const { data: currentVideos, error: videosError } = await supabase
        .from('videos')
        .select('id, title, view_count, published_at, thumbnail_url, channel_id, channel_name, performance_ratio')
        .in('id', videoIds);

      if (videosError) {
        console.error('❌ Failed to fetch current video data:', videosError);
        // Fall back to metadata from Pinecone
        const results: ThumbnailSearchResult[] = paginatedMatches.map(match => ({
          video_id: match.video_id,
          title: match.metadata.title,
          channel_id: match.metadata.channel_id,
          channel_name: match.metadata.channel_name,
          view_count: match.metadata.view_count,
          published_at: match.metadata.published_at,
          performance_ratio: match.metadata.performance_ratio,
          similarity_score: match.similarity_score,
          thumbnail_url: match.metadata.thumbnail_url,
        }));

        return { results, hasMore, totalAvailable: allMatches.length };
      }

      // Merge current data with similarity scores
      const results: ThumbnailSearchResult[] = paginatedMatches
        .map(match => {
          const currentVideo = currentVideos?.find(v => v.id === match.video_id);
          if (!currentVideo) {
            // Fall back to Pinecone metadata
            return {
              video_id: match.video_id,
              title: match.metadata.title,
              channel_id: match.metadata.channel_id,
              channel_name: match.metadata.channel_name,
              view_count: match.metadata.view_count,
              published_at: match.metadata.published_at,
              performance_ratio: match.metadata.performance_ratio,
              similarity_score: match.similarity_score,
              thumbnail_url: match.metadata.thumbnail_url,
            };
          }

          return {
            video_id: currentVideo.id,
            title: currentVideo.title,
            channel_id: currentVideo.channel_id,
            channel_name: currentVideo.channel_name,
            view_count: currentVideo.view_count,
            published_at: currentVideo.published_at,
            performance_ratio: currentVideo.performance_ratio,
            similarity_score: match.similarity_score,
            thumbnail_url: currentVideo.thumbnail_url,
          };
        })
        .filter(Boolean) as ThumbnailSearchResult[];

      console.log(`✅ Found ${results.length} similar thumbnails (page ${Math.floor(offset/limit) + 1}, hasMore: ${hasMore})`);
      return { 
        results, 
        hasMore, 
        totalAvailable: allMatches.length 
      };
    } catch (error) {
      console.error('❌ Failed to search similar thumbnails:', error);
      throw error;
    }
  }

  /**
   * Find similar thumbnails by video ID
   */
  async findSimilarByVideoId(
    videoId: string,
    limit: number = 20,
    minScore: number = 0.7
  ): Promise<ThumbnailSearchResult[]> {
    await this.initializeIndex();

    try {
      // First, get the thumbnail embedding for the query video
      const index = this.pinecone.index(this.indexName);
      const fetchResponse = await index.fetch([videoId]);
      
      if (!fetchResponse.vectors || !fetchResponse.vectors[videoId]) {
        console.log(`⚠️ No thumbnail embedding found for video ${videoId}`);
        return [];
      }

      const queryVector = fetchResponse.vectors[videoId];
      if (!queryVector.values) {
        console.log(`⚠️ No embedding values found for video ${videoId}`);
        return [];
      }

      // Search for similar thumbnails, excluding the query video itself
      const searchResponse = await this.searchSimilarThumbnails(
        queryVector.values,
        limit + 1, // Get one extra to exclude the query video
        minScore
      );

      // Filter out the query video from results
      const results = searchResponse.results.filter(result => result.video_id !== videoId);
      
      // Return only the requested number of results
      return results.slice(0, limit);
    } catch (error) {
      console.error(`❌ Failed to find similar thumbnails for video ${videoId}:`, error);
      throw error;
    }
  }

  /**
   * Get thumbnail clusters using k-means-style grouping
   */
  async getThumbnailClusters(k: number = 4): Promise<{
    clusters: Array<{
      center: number[];
      videos: ThumbnailSearchResult[];
      averagePerformance: number;
      count: number;
    }>;
    totalVideos: number;
  }> {
    await this.initializeIndex();

    try {
      console.log(`🔍 Generating ${k} thumbnail clusters...`);
      
      // For now, implement a simple approach: get random sample and group by similarity
      // In production, you'd want proper k-means clustering
      const index = this.pinecone.index(this.indexName);
      const stats = await index.describeIndexStats();
      
      if (!stats.totalVectorCount || stats.totalVectorCount === 0) {
        return { clusters: [], totalVideos: 0 };
      }

      // Sample approach: get a representative set of vectors
      // This is a simplified version - proper clustering would require more sophisticated algorithms
      const sampleSize = Math.min(100, stats.totalVectorCount);
      
      // For now, return a placeholder structure
      // TODO: Implement proper k-means clustering algorithm
      return {
        clusters: [],
        totalVideos: stats.totalVectorCount
      };
    } catch (error) {
      console.error('❌ Failed to generate thumbnail clusters:', error);
      throw error;
    }
  }

  /**
   * Delete thumbnail embeddings by video IDs
   */
  async deleteThumbnailEmbeddings(videoIds: string[]): Promise<void> {
    await this.initializeIndex();
    
    if (!videoIds || videoIds.length === 0) {
      console.log('⚠️ No video IDs to delete from thumbnails');
      return;
    }

    try {
      console.log(`🗑️ Deleting ${videoIds.length} thumbnail vectors from Pinecone`);
      
      const index = this.pinecone.index(this.indexName);
      await index.deleteMany(videoIds);
      
      console.log(`✅ Successfully deleted ${videoIds.length} thumbnail vectors`);
    } catch (error) {
      console.error('❌ Failed to delete thumbnail vectors:', error);
      throw error;
    }
  }

  /**
   * Get thumbnail index statistics
   */
  async getThumbnailIndexStats() {
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
      console.error('❌ Failed to get thumbnail index stats:', error);
      throw error;
    }
  }

  /**
   * Check if thumbnail vectors exist for given video IDs
   */
  async checkThumbnailVectorsExist(videoIds: string[]): Promise<string[]> {
    await this.initializeIndex();

    try {
      const index = this.pinecone.index(this.indexName);
      const fetchResponse = await index.fetch(videoIds);
      
      return Object.keys(fetchResponse.vectors || {});
    } catch (error) {
      console.error('❌ Failed to check thumbnail vectors:', error);
      throw error;
    }
  }

  /**
   * Batch sync video thumbnails to Pinecone with CLIP embeddings
   */
  async syncVideoThumbnailsToPinecone(
    videoData: Array<{
      id: string;
      title: string;
      thumbnail_url: string;
      channel_id: string;
      channel_name?: string;
      view_count: number;
      published_at: string;
      performance_ratio: number;
    }>,
    embeddings: number[][]
  ): Promise<{ success: number; failed: number }> {
    if (videoData.length !== embeddings.length) {
      throw new Error(`Video data length (${videoData.length}) doesn't match embeddings length (${embeddings.length})`);
    }

    const vectors: ThumbnailVector[] = videoData.map((video, index) => ({
      id: video.id,
      values: embeddings[index],
      metadata: {
        title: String(video.title || ''),
        channel_id: String(video.channel_id || ''),
        channel_name: String(video.channel_name || ''),
        view_count: Number(video.view_count || 0),
        published_at: String(video.published_at || ''),
        performance_ratio: Number(video.performance_ratio || 1.0),
        thumbnail_url: String(video.thumbnail_url || ''),
        embedding_version: 'clip-vit-large-patch14',
      },
    }));

    try {
      await this.upsertThumbnailEmbeddings(vectors);
      return { success: vectors.length, failed: 0 };
    } catch (error) {
      console.error('❌ Failed to sync thumbnails to Pinecone:', error);
      return { success: 0, failed: vectors.length };
    }
  }
}

// Export a singleton instance
export const pineconeThumbnailService = new PineconeThumbnailService();