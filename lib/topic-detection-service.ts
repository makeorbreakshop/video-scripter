import { createClient } from '@supabase/supabase-js';
import type { Database } from '../types/database.ts';
import * as fs from 'fs/promises';
import * as path from 'path';

const supabase = createClient<Database>(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

interface BERTopicCluster {
  cluster_id: number;
  topic_name: string;
  parent_topic: string;
  grandparent_topic: string;
  video_ids: string[];
  centroid_embedding: number[];
}

interface TopicAssignment {
  domain: string;
  niche: string;
  microTopic: string;
  clusterId: number;
  confidence: number;
  neighborDistances: number[];
  reasoning: string;
}

export class TopicDetectionService {
  private clusters: Map<number, BERTopicCluster> = new Map();
  private loaded: boolean = false;
  private k: number = 10; // Number of neighbors to consider

  constructor(k: number = 10) {
    this.k = k;
  }

  async loadClusters(clusterDataPath?: string): Promise<void> {
    if (this.loaded) return;

    try {
      let clusterData: BERTopicCluster[];

      if (clusterDataPath) {
        // Load from file
        const data = await fs.readFile(clusterDataPath, 'utf-8');
        clusterData = JSON.parse(data);
      } else {
        // Load from database with pagination to get all clusters
        clusterData = [];
        let offset = 0;
        const batchSize = 1000;
        
        while (true) {
          const { data, error } = await supabase
            .from('bertopic_clusters')
            .select('*')
            .range(offset, offset + batchSize - 1);

          if (error) throw error;
          if (!data || data.length === 0) break;
          
          clusterData.push(...data);
          
          if (data.length < batchSize) break;
          offset += batchSize;
        }
      }

      // Build cluster map
      clusterData.forEach(cluster => {
        // Parse centroid embedding if it's a string (from pgvector)
        if (typeof cluster.centroid_embedding === 'string') {
          cluster.centroid_embedding = cluster.centroid_embedding
            .slice(1, -1) // Remove [ and ]
            .split(',')
            .map(Number);
        }
        this.clusters.set(cluster.cluster_id, cluster);
      });

      this.loaded = true;
      console.log(`Loaded ${this.clusters.size} BERTopic clusters`);
    } catch (error) {
      console.error('Error loading BERTopic clusters:', error);
      throw error;
    }
  }

  /**
   * Calculate cosine similarity between two embeddings
   */
  private cosineSimilarity(a: number[], b: number[]): number {
    if (a.length !== b.length) {
      throw new Error('Embeddings must have the same dimension');
    }

    let dotProduct = 0;
    let normA = 0;
    let normB = 0;

    for (let i = 0; i < a.length; i++) {
      dotProduct += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }

    return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
  }

  /**
   * Find k-nearest clusters based on embedding similarity
   */
  private findNearestClusters(embedding: number[], k: number): Array<{
    cluster: BERTopicCluster;
    distance: number;
  }> {
    const distances: Array<{ cluster: BERTopicCluster; distance: number }> = [];

    this.clusters.forEach(cluster => {
      const similarity = this.cosineSimilarity(embedding, cluster.centroid_embedding);
      const distance = 1 - similarity; // Convert similarity to distance
      distances.push({ cluster, distance });
    });

    // Sort by distance (ascending) and take top k
    return distances
      .sort((a, b) => a.distance - b.distance)
      .slice(0, k);
  }

  /**
   * Assign topic based on k-nearest neighbors
   */
  async assignTopic(titleEmbedding: number[]): Promise<TopicAssignment> {
    if (!this.loaded) {
      await this.loadClusters();
    }

    // Find k-nearest clusters
    const neighbors = this.findNearestClusters(titleEmbedding, this.k);

    // Count votes for each topic hierarchy
    const domainVotes = new Map<string, number>();
    const nicheVotes = new Map<string, number>();
    const microTopicVotes = new Map<string, number>();
    const clusterVotes = new Map<number, number>();

    // Weight votes by inverse distance
    neighbors.forEach(({ cluster, distance }) => {
      const weight = 1 / (1 + distance); // Closer neighbors have higher weight

      // Count votes for each level
      domainVotes.set(
        cluster.grandparent_topic,
        (domainVotes.get(cluster.grandparent_topic) || 0) + weight
      );
      nicheVotes.set(
        cluster.parent_topic,
        (nicheVotes.get(cluster.parent_topic) || 0) + weight
      );
      microTopicVotes.set(
        cluster.topic_name,
        (microTopicVotes.get(cluster.topic_name) || 0) + weight
      );
      clusterVotes.set(
        cluster.cluster_id,
        (clusterVotes.get(cluster.cluster_id) || 0) + weight
      );
    });

    // Find winning topics at each level
    const domain = this.getMaxVote(domainVotes);
    const niche = this.getMaxVote(nicheVotes);
    const microTopic = this.getMaxVote(microTopicVotes);
    const clusterId = parseInt(this.getMaxVote(clusterVotes));

    // Calculate confidence based on agreement and distances
    const confidence = this.calculateConfidence(
      neighbors,
      domain,
      niche,
      microTopic
    );

    const reasoning = this.generateReasoning(
      neighbors,
      domain,
      niche,
      microTopic,
      confidence
    );

    return {
      domain,
      niche,
      microTopic,
      clusterId,
      confidence,
      neighborDistances: neighbors.map(n => n.distance),
      reasoning
    };
  }

  /**
   * Get the key with maximum value from a map
   */
  private getMaxVote<K>(votes: Map<K, number>): string {
    let maxKey: K | null = null;
    let maxValue = -1;

    votes.forEach((value, key) => {
      if (value > maxValue) {
        maxValue = value;
        maxKey = key;
      }
    });

    return String(maxKey);
  }

  /**
   * Calculate confidence score based on neighbor agreement
   */
  private calculateConfidence(
    neighbors: Array<{ cluster: BERTopicCluster; distance: number }>,
    domain: string,
    niche: string,
    microTopic: string
  ): number {
    let agreementScore = 0;
    let distanceScore = 0;

    neighbors.forEach(({ cluster, distance }, index) => {
      // Agreement scoring
      const weight = 1 / (index + 1); // Earlier neighbors weighted more
      if (cluster.grandparent_topic === domain) agreementScore += weight * 0.33;
      if (cluster.parent_topic === niche) agreementScore += weight * 0.33;
      if (cluster.topic_name === microTopic) agreementScore += weight * 0.34;

      // Distance scoring (closer is better)
      distanceScore += (1 - distance) / neighbors.length;
    });

    // Normalize agreement score
    const maxAgreementScore = neighbors.reduce((sum, _, i) => sum + 1 / (i + 1), 0);
    agreementScore = agreementScore / maxAgreementScore;

    // Combine scores
    const confidence = (agreementScore * 0.7) + (distanceScore * 0.3);

    return Math.round(confidence * 100) / 100;
  }

  /**
   * Generate reasoning for the topic assignment
   */
  private generateReasoning(
    neighbors: Array<{ cluster: BERTopicCluster; distance: number }>,
    domain: string,
    niche: string,
    microTopic: string,
    confidence: number
  ): string {
    const topNeighbors = neighbors.slice(0, 3);
    const avgDistance = neighbors.reduce((sum, n) => sum + n.distance, 0) / neighbors.length;

    let reasoning = `Assigned based on ${this.k} nearest neighbors. `;
    reasoning += `Top 3 neighbors: ${topNeighbors.map(n => 
      `${n.cluster.topic_name} (d=${n.distance.toFixed(3)})`
    ).join(', ')}. `;
    
    if (confidence > 0.8) {
      reasoning += 'High agreement among neighbors. ';
    } else if (confidence > 0.6) {
      reasoning += 'Moderate agreement among neighbors. ';
    } else {
      reasoning += 'Low agreement among neighbors - topic may be ambiguous. ';
    }

    reasoning += `Average distance: ${avgDistance.toFixed(3)}.`;

    return reasoning;
  }

  /**
   * Batch assign topics for multiple videos
   */
  async assignTopicsBatch(
    embeddings: Array<{ videoId: string; embedding: number[] }>
  ): Promise<Map<string, TopicAssignment>> {
    if (!this.loaded) {
      await this.loadClusters();
    }

    const assignments = new Map<string, TopicAssignment>();

    for (const { videoId, embedding } of embeddings) {
      const assignment = await this.assignTopic(embedding);
      assignments.set(videoId, assignment);
    }

    return assignments;
  }

  /**
   * Get cluster details by ID
   */
  getCluster(clusterId: number): BERTopicCluster | undefined {
    return this.clusters.get(clusterId);
  }

  /**
   * Get all clusters for analysis
   */
  getAllClusters(): BERTopicCluster[] {
    return Array.from(this.clusters.values());
  }
}

// Export singleton instance
export const topicDetectionService = new TopicDetectionService();

// Export for CommonJS compatibility (for scripts)
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { TopicDetectionService, topicDetectionService };
}