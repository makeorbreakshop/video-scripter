/**
 * Cluster Discovery Integration
 * Integrates categorization insights with search expansion for intelligent discovery
 */

import { createClient } from '@supabase/supabase-js';
import { DiscoveryQueryGenerator } from './discovery-query-generator';

interface ClusterStats {
  cluster_id: number;
  topic_name: string;
  parent_topic: string;
  grandparent_topic: string;
  video_count: number;
  avg_views: number;
  avg_performance_ratio: number;
  growth_rate: number; // Videos added in last 30 days
  last_updated: Date;
}

interface ClusterGap {
  cluster_id: number;
  topic_name: string;
  gap_score: number; // 0-100, higher = more urgent
  reason: string;
  suggested_queries: string[];
}

interface DiscoveryPriority {
  cluster_id: number;
  priority_score: number;
  factors: {
    coverage_gap: number;
    growth_rate: number;
    performance_potential: number;
    business_value: number;
  };
}

export class ClusterDiscoveryIntegration {
  private supabase;
  private queryGenerator: DiscoveryQueryGenerator;
  
  constructor() {
    this.supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );
    this.queryGenerator = new DiscoveryQueryGenerator();
  }

  /**
   * Analyze cluster coverage and identify gaps
   */
  async analyzeClusterCoverage(): Promise<{
    stats: ClusterStats[];
    gaps: ClusterGap[];
    priorities: DiscoveryPriority[];
  }> {
    // Get cluster statistics
    const stats = await this.getClusterStats();
    
    // Identify gaps
    const gaps = await this.identifyClusterGaps(stats);
    
    // Calculate discovery priorities
    const priorities = await this.calculateDiscoveryPriorities(stats, gaps);
    
    return { stats, gaps, priorities };
  }

  /**
   * Get comprehensive statistics for all clusters
   */
  private async getClusterStats(): Promise<ClusterStats[]> {
    const { data, error } = await this.supabase.rpc('get_cluster_stats', {
      days_back: 30
    });

    if (error) {
      console.error('Error fetching cluster stats:', error);
      // Fallback to basic query
      const { data: fallbackData } = await this.supabase
        .from('videos')
        .select(`
          topic_cluster,
          topic_name,
          parent_topic,
          grandparent_topic,
          view_count,
          performance_ratio,
          created_at
        `)
        .not('topic_cluster', 'is', null);

      return this.processRawStats(fallbackData || []);
    }

    return data || [];
  }

  /**
   * Process raw video data into cluster statistics
   */
  private processRawStats(videos: any[]): ClusterStats[] {
    const clusterMap = new Map<number, any>();
    
    videos.forEach(video => {
      const clusterId = video.topic_cluster;
      if (!clusterMap.has(clusterId)) {
        clusterMap.set(clusterId, {
          cluster_id: clusterId,
          topic_name: video.topic_name || `Cluster ${clusterId}`,
          parent_topic: video.parent_topic || 'Unknown',
          grandparent_topic: video.grandparent_topic || 'General',
          videos: [],
          recent_videos: []
        });
      }
      
      const cluster = clusterMap.get(clusterId);
      cluster.videos.push(video);
      
      // Track recent videos for growth rate
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
      if (new Date(video.created_at) > thirtyDaysAgo) {
        cluster.recent_videos.push(video);
      }
    });

    // Calculate statistics
    const stats: ClusterStats[] = [];
    clusterMap.forEach((cluster, clusterId) => {
      const avgViews = cluster.videos.reduce((sum: number, v: any) => 
        sum + (v.view_count || 0), 0) / cluster.videos.length;
      
      const avgPerfRatio = cluster.videos.reduce((sum: number, v: any) => 
        sum + (v.performance_ratio || 0), 0) / cluster.videos.length;

      stats.push({
        cluster_id: clusterId,
        topic_name: cluster.topic_name,
        parent_topic: cluster.parent_topic,
        grandparent_topic: cluster.grandparent_topic,
        video_count: cluster.videos.length,
        avg_views: avgViews,
        avg_performance_ratio: avgPerfRatio,
        growth_rate: cluster.recent_videos.length,
        last_updated: new Date()
      });
    });

    return stats;
  }

  /**
   * Identify clusters with coverage gaps
   */
  private async identifyClusterGaps(stats: ClusterStats[]): Promise<ClusterGap[]> {
    const gaps: ClusterGap[] = [];
    
    // Calculate median coverage
    const coverageCounts = stats.map(s => s.video_count).sort((a, b) => a - b);
    const medianCoverage = coverageCounts[Math.floor(coverageCounts.length / 2)];
    
    // Identify different types of gaps
    for (const cluster of stats) {
      let gapScore = 0;
      const reasons: string[] = [];
      
      // 1. Low absolute coverage
      if (cluster.video_count < 50) {
        gapScore += 40;
        reasons.push('Low video count');
      }
      
      // 2. Below median coverage
      if (cluster.video_count < medianCoverage * 0.5) {
        gapScore += 30;
        reasons.push('Below median coverage');
      }
      
      // 3. High performance but low coverage
      if (cluster.avg_performance_ratio > 1.5 && cluster.video_count < 100) {
        gapScore += 30;
        reasons.push('High performance potential');
      }
      
      // 4. No recent growth
      if (cluster.growth_rate === 0) {
        gapScore += 20;
        reasons.push('No recent additions');
      }
      
      // 5. Business-critical topics (customize based on your needs)
      const criticalTopics = ['AI', 'Machine Learning', 'Web Development', 'Business', 'Finance'];
      if (criticalTopics.some(topic => 
        cluster.grandparent_topic.toLowerCase().includes(topic.toLowerCase()))) {
        gapScore += 10;
        reasons.push('Business-critical topic');
      }
      
      if (gapScore > 0) {
        // Generate targeted queries for this cluster
        const queries = await this.generateClusterQueries(cluster);
        
        gaps.push({
          cluster_id: cluster.cluster_id,
          topic_name: cluster.topic_name,
          gap_score: Math.min(gapScore, 100),
          reason: reasons.join(', '),
          suggested_queries: queries
        });
      }
    }
    
    // Sort by gap score
    return gaps.sort((a, b) => b.gap_score - a.gap_score);
  }

  /**
   * Generate search queries specific to a cluster
   */
  private async generateClusterQueries(cluster: ClusterStats): Promise<string[]> {
    const queries: string[] = [];
    
    // Extract key terms from topic hierarchy
    const topicTerms = [
      cluster.topic_name,
      cluster.parent_topic,
      cluster.grandparent_topic
    ].filter(t => t && t !== 'Unknown' && t !== 'General');
    
    // Generate variations
    const templates = [
      `{topic} tutorial 2025`,
      `{topic} course complete`,
      `learn {topic} beginner`,
      `{topic} masterclass`,
      `{topic} workshop`,
      `advanced {topic} techniques`,
      `{topic} best practices 2025`,
      `{topic} project tutorial`
    ];
    
    // Create queries for each topic level
    topicTerms.forEach(topic => {
      // Clean up topic name
      const cleanTopic = topic.toLowerCase()
        .replace(/[^\w\s]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
      
      // Apply templates
      templates.slice(0, 3).forEach(template => {
        queries.push(template.replace('{topic}', cleanTopic));
      });
    });
    
    // Add cross-topic queries if applicable
    if (topicTerms.length > 1) {
      queries.push(`${topicTerms[0]} for ${topicTerms[1]}`);
    }
    
    // Remove duplicates and limit
    return [...new Set(queries)].slice(0, 8);
  }

  /**
   * Calculate discovery priorities based on multiple factors
   */
  private async calculateDiscoveryPriorities(
    stats: ClusterStats[], 
    gaps: ClusterGap[]
  ): Promise<DiscoveryPriority[]> {
    const priorities: DiscoveryPriority[] = [];
    
    // Create gap lookup
    const gapMap = new Map(gaps.map(g => [g.cluster_id, g]));
    
    for (const cluster of stats) {
      const gap = gapMap.get(cluster.cluster_id);
      
      // Calculate individual factors (0-1 scale)
      const coverageGap = gap ? gap.gap_score / 100 : 0;
      
      // Growth rate factor (normalized)
      const maxGrowth = Math.max(...stats.map(s => s.growth_rate));
      const growthRate = maxGrowth > 0 ? cluster.growth_rate / maxGrowth : 0;
      
      // Performance potential (higher avg performance = higher priority)
      const performancePotential = Math.min(cluster.avg_performance_ratio / 3, 1);
      
      // Business value (customize based on your priorities)
      const businessValue = this.calculateBusinessValue(cluster);
      
      // Calculate weighted priority score
      const priorityScore = 
        coverageGap * 0.4 +
        growthRate * 0.2 +
        performancePotential * 0.2 +
        businessValue * 0.2;
      
      priorities.push({
        cluster_id: cluster.cluster_id,
        priority_score: priorityScore,
        factors: {
          coverage_gap: coverageGap,
          growth_rate: growthRate,
          performance_potential: performancePotential,
          business_value: businessValue
        }
      });
    }
    
    // Sort by priority score
    return priorities.sort((a, b) => b.priority_score - a.priority_score);
  }

  /**
   * Calculate business value for a cluster (customize this)
   */
  private calculateBusinessValue(cluster: ClusterStats): number {
    // Define your business priorities
    const highValueTopics = {
      'AI & Machine Learning': 1.0,
      'Web Development': 0.9,
      'Business & Entrepreneurship': 0.9,
      'Data Science': 0.8,
      'Finance & Investing': 0.8,
      'Marketing': 0.7,
      'Design': 0.6,
      'Productivity': 0.5
    };
    
    // Check grandparent topic
    for (const [topic, value] of Object.entries(highValueTopics)) {
      if (cluster.grandparent_topic.toLowerCase().includes(topic.toLowerCase())) {
        return value;
      }
    }
    
    // Check parent topic
    for (const [topic, value] of Object.entries(highValueTopics)) {
      if (cluster.parent_topic.toLowerCase().includes(topic.toLowerCase())) {
        return value * 0.8;
      }
    }
    
    // Default value
    return 0.3;
  }

  /**
   * Generate discovery queries based on cluster insights
   */
  async generatePrioritizedQueries(
    limit: number = 100
  ): Promise<Array<{
    query: string;
    cluster_id: number;
    priority_score: number;
    reason: string;
  }>> {
    const { gaps, priorities } = await this.analyzeClusterCoverage();
    
    const queries: Array<{
      query: string;
      cluster_id: number;
      priority_score: number;
      reason: string;
    }> = [];
    
    // Get top priority clusters
    const topPriorities = priorities.slice(0, Math.ceil(limit / 5));
    
    for (const priority of topPriorities) {
      const gap = gaps.find(g => g.cluster_id === priority.cluster_id);
      if (gap && gap.suggested_queries) {
        gap.suggested_queries.forEach(query => {
          queries.push({
            query,
            cluster_id: priority.cluster_id,
            priority_score: priority.priority_score,
            reason: gap.reason
          });
        });
      }
    }
    
    // Add some trending/cross-topic queries
    const trendingQueries = await this.queryGenerator.generateTrendingQueries(20);
    trendingQueries.forEach(q => {
      queries.push({
        query: q.query,
        cluster_id: -1, // Special ID for trending
        priority_score: 0.5,
        reason: 'Trending topic'
      });
    });
    
    return queries.slice(0, limit);
  }

  /**
   * Track discovery effectiveness by cluster
   */
  async trackDiscoveryEffectiveness(
    discoveredChannels: Array<{
      channel_id: string;
      discovered_via_query: string;
      cluster_assignments: number[];
    }>
  ): Promise<{
    effectiveness_by_cluster: Map<number, number>;
    successful_queries: string[];
  }> {
    const effectivenessMap = new Map<number, number>();
    const successfulQueries = new Set<string>();
    
    for (const channel of discoveredChannels) {
      // Track which clusters benefited
      channel.cluster_assignments.forEach(clusterId => {
        effectivenessMap.set(
          clusterId, 
          (effectivenessMap.get(clusterId) || 0) + 1
        );
      });
      
      // Track successful queries
      if (channel.discovered_via_query) {
        successfulQueries.add(channel.discovered_via_query);
      }
    }
    
    return {
      effectiveness_by_cluster: effectivenessMap,
      successful_queries: Array.from(successfulQueries)
    };
  }

  /**
   * Update cluster growth metrics based on new discoveries
   */
  async updateClusterMetrics(
    videoImports: Array<{
      video_id: string;
      topic_cluster: number;
      import_source: string;
    }>
  ): Promise<void> {
    // Group by cluster
    const clusterUpdates = new Map<number, number>();
    
    videoImports.forEach(video => {
      if (video.topic_cluster && video.topic_cluster !== -1) {
        clusterUpdates.set(
          video.topic_cluster,
          (clusterUpdates.get(video.topic_cluster) || 0) + 1
        );
      }
    });
    
    // Update cluster statistics
    for (const [clusterId, count] of clusterUpdates) {
      await this.supabase.rpc('update_cluster_growth_metrics', {
        cluster_id: clusterId,
        videos_added: count,
        source: 'discovery'
      });
    }
  }
}

// Export singleton instance
export const clusterDiscovery = new ClusterDiscoveryIntegration();