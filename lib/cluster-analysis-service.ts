/**
 * Cluster Analysis Service
 * Analyzes cluster coverage, gaps, trends, and provides insights for discovery
 */

import { createClient } from '@supabase/supabase-js';
import { Database } from '@/types/database';

const supabase = createClient<Database>(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export interface ClusterStats {
  clusterId: number;
  topicName: string;
  topicNiche: string;
  topicDomain: string;
  videoCount: number;
  avgViews: number;
  avgPerformance: number;
  growthRate: number;
  lastImportDate: Date;
  competitorCount: number;
  ownerCount: number;
}

export interface ClusterGap {
  clusterId: number;
  topicName: string;
  topicNiche: string;
  topicDomain: string;
  currentCount: number;
  targetCount: number;
  gapSize: number;
  priority: 'high' | 'medium' | 'low';
  rationale: string;
}

export interface TrendingCluster {
  clusterId: number;
  topicName: string;
  topicNiche: string;
  topicDomain: string;
  growthRate: number;
  viewsGrowthRate: number;
  recentVideoCount: number;
  trendStrength: 'emerging' | 'growing' | 'hot' | 'viral';
}

export interface ClusterSearchTerms {
  clusterId: number;
  topicName: string;
  coreTerms: string[];
  relatedTerms: string[];
  trendingTerms: string[];
  formatTerms: string[];
  crossTopicTerms: Array<{ topic: string; combination: string[] }>;
}

export class ClusterAnalysisService {
  /**
   * Get comprehensive statistics for all clusters
   */
  async getClusterStats(): Promise<ClusterStats[]> {
    const { data, error } = await supabase
      .rpc('get_cluster_statistics')
      .order('video_count', { ascending: false });

    if (error) {
      console.error('Error fetching cluster stats:', error);
      return [];
    }

    return data || [];
  }

  /**
   * Identify clusters with insufficient coverage
   */
  async identifyClusterGaps(minVideosPerCluster: number = 100): Promise<ClusterGap[]> {
    const stats = await this.getClusterStats();
    const gaps: ClusterGap[] = [];

    // Calculate average videos per cluster by domain
    const domainAverages = new Map<string, number>();
    stats.forEach(stat => {
      const current = domainAverages.get(stat.topicDomain) || { total: 0, count: 0 };
      domainAverages.set(stat.topicDomain, {
        total: current.total + stat.videoCount,
        count: current.count + 1
      });
    });

    // Identify gaps
    stats.forEach(stat => {
      const domainAvg = domainAverages.get(stat.topicDomain);
      const avgForDomain = domainAvg ? domainAvg.total / domainAvg.count : minVideosPerCluster;
      
      let targetCount = Math.max(minVideosPerCluster, Math.floor(avgForDomain * 0.8));
      let priority: 'high' | 'medium' | 'low' = 'low';
      let rationale = '';

      // High-value clusters need more content
      if (stat.avgPerformance > 1.5) {
        targetCount = Math.max(targetCount, 200);
        priority = 'high';
        rationale = 'High-performing cluster needs more content';
      } else if (stat.videoCount < 50) {
        priority = 'high';
        rationale = 'Severely under-represented cluster';
      } else if (stat.videoCount < targetCount * 0.5) {
        priority = 'medium';
        rationale = 'Below domain average coverage';
      } else if (stat.growthRate > 0.2) {
        targetCount = Math.max(targetCount, stat.videoCount * 1.5);
        priority = 'medium';
        rationale = 'Fast-growing cluster needs more content';
      }

      if (stat.videoCount < targetCount) {
        gaps.push({
          clusterId: stat.clusterId,
          topicName: stat.topicName,
          topicNiche: stat.topicNiche,
          topicDomain: stat.topicDomain,
          currentCount: stat.videoCount,
          targetCount,
          gapSize: targetCount - stat.videoCount,
          priority,
          rationale
        });
      }
    });

    // Sort by priority and gap size
    return gaps.sort((a, b) => {
      const priorityOrder = { high: 3, medium: 2, low: 1 };
      if (priorityOrder[a.priority] !== priorityOrder[b.priority]) {
        return priorityOrder[b.priority] - priorityOrder[a.priority];
      }
      return b.gapSize - a.gapSize;
    });
  }

  /**
   * Identify trending clusters based on growth metrics
   */
  async identifyTrendingClusters(daysWindow: number = 30): Promise<TrendingCluster[]> {
    const { data, error } = await supabase
      .rpc('get_trending_clusters', { days_window: daysWindow });

    if (error) {
      console.error('Error fetching trending clusters:', error);
      return [];
    }

    const trending: TrendingCluster[] = [];
    
    data?.forEach(cluster => {
      let trendStrength: 'emerging' | 'growing' | 'hot' | 'viral' = 'emerging';
      
      if (cluster.growth_rate > 1.0 && cluster.views_growth_rate > 2.0) {
        trendStrength = 'viral';
      } else if (cluster.growth_rate > 0.5 && cluster.views_growth_rate > 1.0) {
        trendStrength = 'hot';
      } else if (cluster.growth_rate > 0.2) {
        trendStrength = 'growing';
      }

      trending.push({
        clusterId: cluster.cluster_id,
        topicName: cluster.topic_name,
        topicNiche: cluster.topic_niche,
        topicDomain: cluster.topic_domain,
        growthRate: cluster.growth_rate,
        viewsGrowthRate: cluster.views_growth_rate,
        recentVideoCount: cluster.recent_video_count,
        trendStrength
      });
    });

    return trending.sort((a, b) => b.growthRate - a.growthRate);
  }

  /**
   * Generate search terms for a specific cluster
   */
  async generateClusterSearchTerms(clusterId: number): Promise<ClusterSearchTerms | null> {
    // Get cluster info and sample videos
    const { data: cluster } = await supabase
      .from('bertopic_clusters')
      .select('*')
      .eq('cluster_id', clusterId)
      .single();

    if (!cluster) return null;

    const { data: videos } = await supabase
      .from('videos')
      .select('title, format_type')
      .eq('topic_cluster_id', clusterId)
      .limit(50);

    // Extract common terms from titles
    const titleWords = new Map<string, number>();
    videos?.forEach(video => {
      const words = video.title.toLowerCase()
        .replace(/[^\w\s]/g, ' ')
        .split(/\s+/)
        .filter(word => word.length > 3 && !this.isStopWord(word));
      
      words.forEach(word => {
        titleWords.set(word, (titleWords.get(word) || 0) + 1);
      });
    });

    // Sort by frequency
    const sortedWords = Array.from(titleWords.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([word]) => word);

    // Core terms from topic name
    const coreTerms = cluster.topic_name.toLowerCase().split(/\s+/)
      .filter(word => word.length > 2);

    // Related terms from high-frequency words
    const relatedTerms = sortedWords
      .filter(word => !coreTerms.includes(word))
      .slice(0, 10);

    // Format-specific terms
    const formats = new Set(videos?.map(v => v.format_type).filter(Boolean));
    const formatTerms = Array.from(formats).map(format => {
      const formatMap: Record<string, string[]> = {
        'tutorial': ['tutorial', 'how to', 'guide', 'step by step'],
        'explainer': ['explained', 'explanation', 'understanding', 'what is'],
        'listicle': ['best', 'top 10', 'list', 'compilation'],
        'case_study': ['case study', 'analysis', 'deep dive', 'breakdown'],
        'product_focus': ['review', 'comparison', 'vs', 'best for']
      };
      return formatMap[format!] || [];
    }).flat();

    // Trending terms (simulate with year)
    const currentYear = new Date().getFullYear();
    const trendingTerms = [
      `${currentYear}`,
      'latest',
      'new',
      'updated',
      'trends'
    ];

    // Cross-topic combinations
    const crossTopicTerms = this.generateCrossTopicTerms(cluster.topic_name, cluster.topic_niche);

    return {
      clusterId,
      topicName: cluster.topic_name,
      coreTerms,
      relatedTerms,
      trendingTerms,
      formatTerms: Array.from(new Set(formatTerms)),
      crossTopicTerms
    };
  }

  /**
   * Generate search queries for multiple clusters
   */
  async generateClusterQueries(
    clusterIds: number[],
    queriesPerCluster: number = 10
  ): Promise<Array<{ clusterId: number; queries: string[] }>> {
    const results: Array<{ clusterId: number; queries: string[] }> = [];

    for (const clusterId of clusterIds) {
      const searchTerms = await this.generateClusterSearchTerms(clusterId);
      if (!searchTerms) continue;

      const queries = this.combineTermsIntoQueries(searchTerms, queriesPerCluster);
      results.push({ clusterId, queries });
    }

    return results;
  }

  /**
   * Get cluster evolution metrics
   */
  async getClusterEvolution(clusterId: number, daysBack: number = 90): Promise<{
    clusterId: number;
    dailyMetrics: Array<{
      date: string;
      videoCount: number;
      totalViews: number;
      avgPerformance: number;
    }>;
    growthTrend: 'declining' | 'stable' | 'growing' | 'accelerating';
  }> {
    const { data, error } = await supabase
      .rpc('get_cluster_daily_metrics', { 
        cluster_id: clusterId,
        days_back: daysBack 
      });

    if (error || !data) {
      console.error('Error fetching cluster evolution:', error);
      return { clusterId, dailyMetrics: [], growthTrend: 'stable' };
    }

    // Calculate growth trend
    const recentDays = data.slice(-14);
    const olderDays = data.slice(0, 14);
    
    const recentAvg = recentDays.reduce((sum, d) => sum + d.video_count, 0) / recentDays.length;
    const olderAvg = olderDays.reduce((sum, d) => sum + d.video_count, 0) / olderDays.length;
    
    const growthRate = (recentAvg - olderAvg) / (olderAvg || 1);
    
    let growthTrend: 'declining' | 'stable' | 'growing' | 'accelerating' = 'stable';
    if (growthRate < -0.1) growthTrend = 'declining';
    else if (growthRate > 0.5) growthTrend = 'accelerating';
    else if (growthRate > 0.1) growthTrend = 'growing';

    return {
      clusterId,
      dailyMetrics: data,
      growthTrend
    };
  }

  /**
   * Helper: Check if word is a stop word
   */
  private isStopWord(word: string): boolean {
    const stopWords = new Set([
      'the', 'is', 'at', 'which', 'on', 'and', 'a', 'an', 'as', 'are', 'was',
      'been', 'be', 'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would',
      'should', 'could', 'may', 'might', 'must', 'can', 'this', 'that', 'these',
      'those', 'i', 'you', 'he', 'she', 'it', 'we', 'they', 'what', 'when',
      'where', 'who', 'why', 'how', 'all', 'each', 'every', 'some', 'any',
      'many', 'much', 'more', 'most', 'less', 'least', 'just', 'only', 'very',
      'too', 'also', 'still', 'even', 'ever', 'never', 'always', 'often',
      'sometimes', 'now', 'then', 'here', 'there', 'from', 'with', 'about'
    ]);
    return stopWords.has(word.toLowerCase());
  }

  /**
   * Helper: Generate cross-topic term combinations
   */
  private generateCrossTopicTerms(topicName: string, topicNiche: string): Array<{ topic: string; combination: string[] }> {
    const crossTopics = [
      { topic: 'beginners', combination: ['for beginners', 'beginner guide', 'getting started'] },
      { topic: 'business', combination: ['for business', 'business strategy', 'monetization'] },
      { topic: 'productivity', combination: ['productivity tips', 'efficiency', 'workflow'] },
      { topic: 'automation', combination: ['automation', 'automated', 'no code'] },
      { topic: 'ai', combination: ['with ai', 'using chatgpt', 'ai powered'] }
    ];

    return crossTopics.filter(cross => 
      !topicName.toLowerCase().includes(cross.topic) && 
      !topicNiche.toLowerCase().includes(cross.topic)
    );
  }

  /**
   * Helper: Combine search terms into queries
   */
  private combineTermsIntoQueries(searchTerms: ClusterSearchTerms, count: number): string[] {
    const queries: string[] = [];
    const { coreTerms, relatedTerms, trendingTerms, formatTerms, crossTopicTerms } = searchTerms;

    // Core + format combinations
    coreTerms.forEach(core => {
      formatTerms.slice(0, 3).forEach(format => {
        queries.push(`${core} ${format}`);
      });
    });

    // Core + trending combinations
    coreTerms.forEach(core => {
      trendingTerms.slice(0, 2).forEach(trend => {
        queries.push(`${core} ${trend}`);
      });
    });

    // Related + format combinations
    relatedTerms.slice(0, 3).forEach(related => {
      formatTerms.slice(0, 2).forEach(format => {
        queries.push(`${related} ${format}`);
      });
    });

    // Cross-topic combinations
    crossTopicTerms.forEach(cross => {
      coreTerms.slice(0, 2).forEach(core => {
        cross.combination.slice(0, 2).forEach(combo => {
          queries.push(`${core} ${combo}`);
        });
      });
    });

    // Remove duplicates and limit
    return Array.from(new Set(queries)).slice(0, count);
  }
}

// Export singleton instance
export const clusterAnalysis = new ClusterAnalysisService();