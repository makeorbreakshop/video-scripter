import { createClient } from '@supabase/supabase-js';
import { Pinecone } from '@pinecone-database/pinecone';
import topicData from '../data/bertopic/better_topic_names_v2.json' with { type: 'json' };
import hierarchyData from '../data/bertopic/bertopic_smart_hierarchy_20250801_131446.json' with { type: 'json' };

interface TopicAssignment {
  clusterId: number;
  domain: string;
  niche: string;
  microTopic: string;
  confidence: number;
  method: 'centroid' | 'outlier';
}

interface BERTopicInfo {
  name: string;
  category: string;
  subcategory: string;
}

interface TopicCentroid {
  cluster_id: number;
  topic_name: string;
  parent_topic: string | null;
  grandparent_topic: string | null;
  centroid_embedding: number[];
  video_count: number;
}

export class BERTopicCentroidClassificationService {
  private supabase: any;
  private pinecone: any;
  private topicNames: Record<string, BERTopicInfo>;
  private hierarchyMappings: any;
  private centroids: Map<number, TopicCentroid> = new Map();
  private initialized: boolean = false;

  constructor() {
    this.supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );
    
    this.pinecone = new Pinecone({
      apiKey: process.env.PINECONE_API_KEY!
    });
    
    // Load topic names and hierarchy from the August 1st model
    this.topicNames = topicData.topics;
    this.hierarchyMappings = hierarchyData.metadata.mappings;
  }

  async initialize() {
    if (this.initialized) return;
    
    console.log('🎯 Initializing BERTopic Centroid Classification Service');
    
    // Load centroids from database
    const { data: centroidData, error } = await this.supabase
      .from('bertopic_clusters')
      .select('*')
      .gte('cluster_id', 0)
      .lte('cluster_id', 215);
      
    if (error) {
      throw new Error(`Failed to load centroids: ${error.message}`);
    }
    
    // Parse and store centroids
    centroidData.forEach((row: any) => {
      this.centroids.set(row.cluster_id, {
        ...row,
        centroid_embedding: JSON.parse(row.centroid_embedding)
      });
    });
    
    console.log(`   ✅ Loaded ${this.centroids.size} topic centroids`);
    console.log(`   - Total topics in names: ${Object.keys(this.topicNames).length}`);
    console.log(`   - Hierarchy levels: L1=${hierarchyData.metadata.hierarchy_sizes.level_1}, L2=${hierarchyData.metadata.hierarchy_sizes.level_2}, L3=${hierarchyData.metadata.hierarchy_sizes.level_3}`);
    
    this.initialized = true;
  }

  /**
   * Classify videos based on their embeddings using centroid similarity
   * Supports both single embeddings and blended embeddings
   */
  async classifyVideos(
    videos: Array<{ 
      id: string; 
      titleEmbedding?: number[];
      summaryEmbedding?: number[];
      blendWeights?: { title: number; summary: number };
    }>
  ): Promise<Array<{ id: string; assignment: TopicAssignment }>> {
    await this.initialize();
    
    const assignments: Array<{ id: string; assignment: TopicAssignment }> = [];
    
    for (const video of videos) {
      // Create blended embedding if both are available
      let embedding: number[] | null = null;
      
      if (video.titleEmbedding && video.summaryEmbedding) {
        // Use provided weights or default to 30/70
        const weights = video.blendWeights || { title: 0.3, summary: 0.7 };
        embedding = this.blendEmbeddings(
          video.titleEmbedding,
          video.summaryEmbedding,
          weights.title,
          weights.summary
        );
      } else if (video.titleEmbedding) {
        embedding = video.titleEmbedding;
      } else if (video.summaryEmbedding) {
        embedding = video.summaryEmbedding;
      }
      
      if (!embedding || embedding.length === 0) {
        console.warn(`⚠️ No embedding for video ${video.id}, skipping classification`);
        continue;
      }
      
      // Find nearest centroid
      const assignment = this.findNearestCentroid(embedding);
      
      assignments.push({
        id: video.id,
        assignment
      });
    }
    
    return assignments;
  }

  /**
   * Classify a single video with title and/or summary embeddings
   */
  async classifyVideo(
    videoId: string,
    titleEmbedding?: number[],
    summaryEmbedding?: number[],
    blendWeights?: { title: number; summary: number }
  ): Promise<TopicAssignment> {
    await this.initialize();
    
    let embedding: number[] | null = null;
    
    if (titleEmbedding && summaryEmbedding) {
      const weights = blendWeights || { title: 0.3, summary: 0.7 };
      embedding = this.blendEmbeddings(
        titleEmbedding,
        summaryEmbedding,
        weights.title,
        weights.summary
      );
    } else if (titleEmbedding) {
      embedding = titleEmbedding;
    } else if (summaryEmbedding) {
      embedding = summaryEmbedding;
    }
    
    if (!embedding || embedding.length === 0) {
      return this.getDefaultAssignment(-1, 0);
    }
    
    return this.findNearestCentroid(embedding);
  }

  /**
   * Find the nearest BERTopic centroid for a given embedding
   */
  private findNearestCentroid(embedding: number[]): TopicAssignment {
    let bestClusterId = -1;
    let bestSimilarity = -1;
    let bestCentroid: TopicCentroid | null = null;
    
    // Calculate similarity to all centroids
    for (const [clusterId, centroid] of this.centroids) {
      const similarity = this.cosineSimilarity(embedding, centroid.centroid_embedding);
      
      if (similarity > bestSimilarity) {
        bestSimilarity = similarity;
        bestClusterId = clusterId;
        bestCentroid = centroid;
      }
    }
    
    // Check if this is an outlier (low similarity to all centroids)
    const OUTLIER_THRESHOLD = 0.3; // Adjust based on empirical testing
    if (bestSimilarity < OUTLIER_THRESHOLD) {
      return this.getDefaultAssignment(-1, bestSimilarity);
    }
    
    // Get topic information
    const topicInfo = this.topicNames[bestClusterId.toString()];
    const l2Mapping = this.hierarchyMappings.topic_to_l2?.[bestClusterId.toString()];
    const l1Mapping = this.hierarchyMappings.l2_to_l1?.[l2Mapping?.toString()];
    
    // Extract hierarchy levels from centroid data
    const level1 = bestCentroid?.grandparent_topic?.replace('domain_', '') || l1Mapping;
    const level2 = bestCentroid?.parent_topic?.replace('niche_', '') || l2Mapping;
    
    return {
      clusterId: bestClusterId,
      domain: hierarchyData.metadata.mappings.l1_names?.[level1] || topicInfo?.category || 'Unknown Domain',
      niche: hierarchyData.metadata.mappings.l2_names?.[level2] || topicInfo?.subcategory || 'Unknown Niche',
      microTopic: bestCentroid?.topic_name || topicInfo?.name || `Topic ${bestClusterId}`,
      confidence: bestSimilarity,
      method: 'centroid'
    };
  }
  
  /**
   * Get default assignment for outliers or unknown clusters
   */
  private getDefaultAssignment(clusterId: number, confidence: number): TopicAssignment {
    return {
      clusterId: clusterId,
      domain: 'Uncategorized',
      niche: 'Other',
      microTopic: 'Outlier',
      confidence: confidence,
      method: 'outlier'
    };
  }

  /**
   * Blend two embeddings with specified weights
   */
  private blendEmbeddings(
    embedding1: number[],
    embedding2: number[],
    weight1: number,
    weight2: number
  ): number[] {
    if (embedding1.length !== embedding2.length) {
      throw new Error('Embeddings must have the same dimension');
    }
    
    return embedding1.map((val, idx) => 
      weight1 * val + weight2 * embedding2[idx]
    );
  }

  /**
   * Calculate cosine similarity between two vectors
   */
  private cosineSimilarity(a: number[], b: number[]): number {
    if (a.length !== b.length) return 0;
    
    let dotProduct = 0;
    let normA = 0;
    let normB = 0;
    
    for (let i = 0; i < a.length; i++) {
      dotProduct += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }
    
    const denominator = Math.sqrt(normA) * Math.sqrt(normB);
    return denominator === 0 ? 0 : dotProduct / denominator;
  }

  /**
   * Get topic information by cluster ID
   */
  getTopicInfo(clusterId: number): BERTopicInfo | null {
    return this.topicNames[clusterId.toString()] || null;
  }

  /**
   * Get centroid information by cluster ID
   */
  getCentroidInfo(clusterId: number): TopicCentroid | null {
    return this.centroids.get(clusterId) || null;
  }

  /**
   * Get all topics with their hierarchy and centroids
   */
  getAllTopics(): {
    topics: Record<string, BERTopicInfo>;
    hierarchy: any;
    centroids: Map<number, TopicCentroid>;
  } {
    return {
      topics: this.topicNames,
      hierarchy: this.hierarchyMappings,
      centroids: this.centroids
    };
  }

  /**
   * Get classification statistics
   */
  getStats(): {
    totalCentroids: number;
    totalVideos: number;
    topTopics: Array<{ clusterId: number; name: string; videoCount: number }>;
  } {
    const topTopics = Array.from(this.centroids.values())
      .sort((a, b) => b.video_count - a.video_count)
      .slice(0, 10)
      .map(c => ({
        clusterId: c.cluster_id,
        name: c.topic_name,
        videoCount: c.video_count
      }));
    
    const totalVideos = Array.from(this.centroids.values())
      .reduce((sum, c) => sum + c.video_count, 0);
    
    return {
      totalCentroids: this.centroids.size,
      totalVideos,
      topTopics
    };
  }
}