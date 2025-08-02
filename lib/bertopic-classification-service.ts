import { createClient } from '@supabase/supabase-js';
import { Pinecone } from '@pinecone-database/pinecone';
import topicData from '../better_topic_names_v2.json' with { type: 'json' };
import hierarchyData from '../bertopic_smart_hierarchy_20250801_131446.json' with { type: 'json' };

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

export class BERTopicClassificationService {
  private supabase: any;
  private pinecone: any;
  private topicNames: Record<string, BERTopicInfo>;
  private hierarchyMappings: any;
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
    
    console.log('🏷️ Initializing BERTopic Classification Service');
    console.log(`   - Total topics: ${Object.keys(this.topicNames).length}`);
    console.log(`   - Hierarchy levels: L1=${hierarchyData.metadata.hierarchy_sizes.level_1}, L2=${hierarchyData.metadata.hierarchy_sizes.level_2}, L3=${hierarchyData.metadata.hierarchy_sizes.level_3}`);
    
    this.initialized = true;
  }

  /**
   * Classify videos based on their embeddings using the August 1st BERTopic model
   */
  async classifyVideos(videos: Array<{ id: string; embedding?: number[] }>): Promise<Array<{ id: string; assignment: TopicAssignment }>> {
    await this.initialize();
    
    const assignments: Array<{ id: string; assignment: TopicAssignment }> = [];
    
    // For videos with embeddings, find nearest topic
    for (const video of videos) {
      if (!video.embedding || video.embedding.length === 0) {
        console.warn(`⚠️ No embedding for video ${video.id}, skipping classification`);
        continue;
      }
      
      // Find nearest topic using similarity search
      const assignment = await this.findNearestTopic(video.embedding);
      
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
   * Find the nearest BERTopic cluster for a given embedding
   */
  private async findNearestTopic(embedding: number[]): Promise<TopicAssignment | null> {
    try {
      // For the August 1st model, we'll use Pinecone to find similar videos
      // and then use their topic assignments
      const pineconeIndex = this.pinecone.index(process.env.PINECONE_INDEX_NAME!);
      
      // Query Pinecone for similar videos
      const queryResponse = await pineconeIndex.query({
        vector: embedding,
        topK: 10,
        includeMetadata: false
      });
      
      if (!queryResponse.matches || queryResponse.matches.length === 0) {
        return this.getDefaultAssignment(-1, 0);
      }
      
      // Get the video IDs from matches
      const videoIds = queryResponse.matches.map(match => match.id);
      
      // Look up their topic assignments in the database
      const { data: videos, error } = await this.supabase
        .from('videos')
        .select('topic_cluster_id, topic_confidence')
        .in('id', videoIds)
        .not('topic_cluster_id', 'is', null)
        .eq('bertopic_version', 'v1_2025-08-01');
      
      if (error || !videos || videos.length === 0) {
        // Fallback: use the highest similarity match
        const topMatch = queryResponse.matches[0];
        return this.getDefaultAssignment(-1, topMatch.score || 0);
      }
      
      // Use the most common topic among similar videos
      const topicCounts = new Map<number, number>();
      videos.forEach(v => {
        const count = topicCounts.get(v.topic_cluster_id) || 0;
        topicCounts.set(v.topic_cluster_id, count + 1);
      });
      
      // Find the most frequent topic
      let bestTopic = -1;
      let maxCount = 0;
      topicCounts.forEach((count, topicId) => {
        if (count > maxCount) {
          maxCount = count;
          bestTopic = topicId;
        }
      });
      
      // Get the assignment for this topic
      const confidence = queryResponse.matches[0].score || 0.5;
      return this.getAssignmentForCluster(bestTopic, confidence);
      
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
   * Get all topics with their hierarchy
   */
  getAllTopics(): {
    topics: Record<string, BERTopicInfo>;
    hierarchy: any;
  } {
    return {
      topics: this.topicNames,
      hierarchy: this.hierarchyMappings
    };
  }
}