/**
 * Pinecone service for semantic search on YouTube video titles
 * Handles vector operations for the title embeddings system
 */

import { Pinecone } from '@pinecone-database/pinecone';
import { createClient } from '@supabase/supabase-js';

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
  thumbnail_url: string;
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
      const index = this.pinecone.index(this.indexName);
      await index.upsert(vectors);
      
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
    minScore: number = 0.7,
    offset: number = 0
  ): Promise<{ results: SearchResult[], hasMore: boolean, totalAvailable: number }> {
    await this.initializeIndex();

    try {
      
      const index = this.pinecone.index(this.indexName);
      
      // Request more results than needed to handle pagination efficiently
      // We'll fetch up to 100 results initially and paginate client-side
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
        })) || [];

      if (allMatches.length === 0) {
        console.log(`✅ Found 0 similar videos`);
        return { results: [], hasMore: false, totalAvailable: 0 };
      }

      // Apply pagination to the filtered results
      const paginatedMatches = allMatches.slice(offset, offset + limit);
      const hasMore = offset + limit < allMatches.length;
      
      if (paginatedMatches.length === 0) {
        console.log(`✅ No more results for offset ${offset}`);
        return { results: [], hasMore: false, totalAvailable: allMatches.length };
      }

      // Enrich with full video data from Supabase
      const supabase = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
      );

      const videoIds = paginatedMatches.map(match => match.video_id);
      
      // Use optimized approach: get basic video data, then calculate performance for only these videos
      // Filter out shorts (videos <= 1 minute or with #shorts hashtag)
      const { data: basicVideos, error: basicError } = await supabase
        .from('videos')
        .select('id, title, view_count, published_at, thumbnail_url, is_competitor, channel_id, channel_name, duration')
        .in('id', videoIds)
        .not('title', 'ilike', '%#shorts%')
        .not('description', 'ilike', '%#shorts%')
        .not('duration', 'in', '("PT1M","PT59S","PT58S","PT57S","PT56S","PT55S","PT54S","PT53S","PT52S","PT51S","PT50S","PT49S","PT48S","PT47S","PT46S","PT45S","PT44S","PT43S","PT42S","PT41S","PT40S","PT39S","PT38S","PT37S","PT36S","PT35S","PT34S","PT33S","PT32S","PT31S","PT30S","PT29S","PT28S","PT27S","PT26S","PT25S","PT24S","PT23S","PT22S","PT21S","PT20S","PT19S","PT18S","PT17S","PT16S","PT15S","PT14S","PT13S","PT12S","PT11S","PT10S","PT9S","PT8S","PT7S","PT6S","PT5S","PT4S","PT3S","PT2S","PT1S")');

      if (basicError) {
        console.error('❌ Failed to fetch basic video data:', basicError);
        throw basicError;
      }

      // Now calculate performance ratios for only the channels we need
      const channelIds = [...new Set(basicVideos?.map(v => v.channel_id) || [])];
      
      const { data: channelBaselines, error: baselineError } = await supabase
        .from('videos')
        .select('channel_id, view_count')
        .in('channel_id', channelIds)
        .gte('published_at', new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toISOString())
        .not('view_count', 'is', null)
        .gt('view_count', 0)
        .not('title', 'ilike', '%#shorts%')
        .not('description', 'ilike', '%#shorts%');

      if (baselineError) {
        console.error('❌ Failed to fetch channel baselines:', baselineError);
        throw baselineError;
      }

      // Calculate channel averages
      const channelViewCounts: { [key: string]: number[] } = {};
      channelBaselines?.forEach(video => {
        if (!channelViewCounts[video.channel_id]) {
          channelViewCounts[video.channel_id] = [];
        }
        channelViewCounts[video.channel_id].push(video.view_count);
      });

      // Convert to actual averages
      const channelAverages: { [key: string]: number } = {};
      Object.keys(channelViewCounts).forEach(channelId => {
        const views = channelViewCounts[channelId];
        channelAverages[channelId] = views.reduce((sum, count) => sum + count, 0) / views.length;
      });

      // Merge with performance ratios
      const videos = basicVideos?.map(video => ({
        ...video,
        performance_ratio: channelAverages[video.channel_id] 
          ? video.view_count / channelAverages[video.channel_id]
          : 1.0,
        channel_avg_views: Math.round(channelAverages[video.channel_id] || 0)
      })) || [];

      // Videos are already filtered to our search results
      const filteredVideos = videos;

      // Merge Pinecone similarity scores with Supabase video data
      const results: SearchResult[] = paginatedMatches
        .map(match => {
          const video = filteredVideos.find(v => v.id === match.video_id);
          if (!video) return null;

          const result = {
            video_id: video.id,
            title: video.title,
            channel_id: video.channel_id,
            channel_name: video.channel_name,
            view_count: video.view_count,
            published_at: video.published_at,
            performance_ratio: video.performance_ratio,
            similarity_score: match.similarity_score,
            thumbnail_url: video.thumbnail_url,
          };
          
          return result;
        })
        .filter(Boolean) as SearchResult[];

      console.log(`✅ Found ${results.length} similar videos with enriched data (page ${Math.floor(offset/limit) + 1}, hasMore: ${hasMore})`);
      return { 
        results, 
        hasMore, 
        totalAvailable: allMatches.length 
      };
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