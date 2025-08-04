import { createClient } from '@supabase/supabase-js';
import topicData from '../data/bertopic/better_topic_names_v2.json';
import hierarchyData from '../data/bertopic/bertopic_smart_hierarchy_20250801_131446.json';

interface TopicAssignment {
  clusterId: number;
  domain: string;
  niche: string;
  microTopic: string;
  confidence: number;
}

export class BERTopicMappingService {
  private supabase: any;
  private initialized: boolean = false;
  private topicMappings: Map<number, any> = new Map();

  constructor() {
    this.supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );
  }

  async initialize() {
    if (this.initialized) return;
    
    console.log('🏷️ Initializing BERTopic Mapping Service');
    
    // Load mappings from August 1st data
    const topics = topicData.topics;
    const hierarchy = hierarchyData.metadata.mappings;
    
    // Build mappings for each cluster ID
    Object.entries(topics).forEach(([clusterId, topicInfo]) => {
      const id = parseInt(clusterId);
      const l2 = hierarchy.topic_to_l2[clusterId];
      const l1 = hierarchy.l2_to_l1?.[l2?.toString()];
      
      this.topicMappings.set(id, {
        clusterId: id,
        name: topicInfo.name,
        category: topicInfo.category,
        subcategory: topicInfo.subcategory,
        l1: l1,
        l2: l2
      });
    });
    
    console.log(`   - Loaded ${this.topicMappings.size} topic mappings`);
    this.initialized = true;
  }

  /**
   * Get topic assignment for a given cluster ID
   */
  getTopicAssignment(clusterId: number, confidence: number = 0.95): TopicAssignment {
    const mapping = this.topicMappings.get(clusterId);
    
    if (!mapping) {
      // Handle outliers or unknown clusters
      return {
        clusterId: clusterId,
        domain: 'Uncategorized',
        niche: 'Other',
        microTopic: `Cluster ${clusterId}`,
        confidence: confidence
      };
    }
    
    return {
      clusterId: mapping.clusterId,
      domain: mapping.category,
      niche: mapping.subcategory,
      microTopic: mapping.name,
      confidence: confidence
    };
  }

  /**
   * Map old cluster IDs to new BERTopic assignments
   * This is used when videos already have cluster IDs from the old system
   */
  async mapOldClustersToNew(videos: Array<{ id: string; topic_cluster?: number }>): Promise<Array<{ id: string; assignment: TopicAssignment }>> {
    await this.initialize();
    
    const assignments: Array<{ id: string; assignment: TopicAssignment }> = [];
    
    for (const video of videos) {
      if (video.topic_cluster === undefined || video.topic_cluster === null) {
        continue;
      }
      
      // For now, we'll use a simple mapping approach
      // In the future, this could be enhanced with a proper mapping table
      const assignment = this.getTopicAssignment(video.topic_cluster);
      assignments.push({
        id: video.id,
        assignment
      });
    }
    
    return assignments;
  }
}