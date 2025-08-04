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

export class BERTopicClassificationService {
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
    
    console.log('🏷️ Initializing BERTopic Classification Service (Centroid-based)');
    
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
    console.log(`   - Total topics: ${Object.keys(this.topicNames).length}`);
    console.log(`   - Hierarchy levels: L1=${hierarchyData.metadata.hierarchy_sizes.level_1}, L2=${hierarchyData.metadata.hierarchy_sizes.level_2}, L3=${hierarchyData.metadata.hierarchy_sizes.level_3}`);
    
    this.initialized = true;
  }

  /**
   * Classify videos based on their embeddings using centroid similarity
   * Supports both single embeddings and blended embeddings
   */
  async classifyVideos(videos: Array<{ 
    id: string; 
    embedding?: number[];
    titleEmbedding?: number[];
    summaryEmbedding?: number[];
    blendWeights?: { title: number; summary: number };
  }>): Promise<Array<{ id: string; assignment: TopicAssignment }>> {
    await this.initialize();
    
    const assignments: Array<{ id: string; assignment: TopicAssignment }> = [];
    
    // For videos with embeddings, find nearest topic
    for (const video of videos) {
      let embedding: number[] | null = null;
      
      // Support blended embeddings or single embedding
      if (video.embedding) {
        embedding = video.embedding;
      } else if (video.titleEmbedding && video.summaryEmbedding) {
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
      
      // Find nearest topic using centroid similarity
      const assignment = await this.findNearestTopic(embedding);
      
      if (assignment) {
        assignments.push({
          id: video.id,
          assignment
        });
      }
    }
    
    return assignments;
  }

  /**
   * Find the nearest BERTopic cluster for a given embedding using centroid similarity
   */
  private async findNearestTopic(embedding: number[]): Promise<TopicAssignment | null> {
    try {
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
      
      // Get the assignment for this cluster
      return this.getAssignmentForCluster(bestClusterId, bestSimilarity);
      
    } catch (error) {
      console.error('Error finding nearest topic:', error);
      return this.getDefaultAssignment(-1, 0);
    }
  }
  
  /**
   * Get assignment for a specific cluster ID
   */
  private getAssignmentForCluster(clusterId: number, confidence: number): TopicAssignment {
    const topicInfo = this.topicNames[clusterId.toString()];
    const l2Mapping = this.hierarchyMappings.topic_to_l2?.[clusterId.toString()];
    const l1Mapping = this.hierarchyMappings.l2_to_l1?.[l2Mapping?.toString()];
    
    if (!topicInfo) {
      return this.getDefaultAssignment(clusterId, confidence);
    }
    
    return {
      clusterId: clusterId,
      domain: topicInfo.category,
      niche: topicInfo.subcategory,
      microTopic: topicInfo.name,
      confidence: confidence
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
      microTopic: clusterId === -1 ? 'Outlier' : `Cluster ${clusterId}`,
      confidence: confidence
    };
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
   * Get all topics with their hierarchy
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
}