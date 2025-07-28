/**
 * Cluster-Aware Discovery Query Generator
 * Enhances search query generation with cluster insights and gap analysis
 */

import { DiscoveryQueryGenerator } from './discovery-query-generator';
import { clusterAnalysis, ClusterGap, TrendingCluster, ClusterSearchTerms } from './cluster-analysis-service';

export interface ClusterAwareQuery {
  query: string;
  category: string;
  queryType: string;
  clusterId?: number;
  clusterName?: string;
  priority: 'high' | 'medium' | 'low';
  rationale: string;
}

export interface DiscoveryStrategy {
  totalQueries: number;
  gapFillingQueries: number;
  trendingQueries: number;
  explorationQueries: number;
  crossClusterQueries: number;
}

export class ClusterAwareDiscoveryGenerator extends DiscoveryQueryGenerator {
  /**
   * Generate queries based on cluster analysis insights
   */
  async generateStrategicQueries(
    strategy: DiscoveryStrategy = {
      totalQueries: 100,
      gapFillingQueries: 40,
      trendingQueries: 30,
      explorationQueries: 20,
      crossClusterQueries: 10
    }
  ): Promise<ClusterAwareQuery[]> {
    const queries: ClusterAwareQuery[] = [];

    // 1. Gap-filling queries for under-represented clusters
    const gapQueries = await this.generateGapFillingQueries(strategy.gapFillingQueries);
    queries.push(...gapQueries);

    // 2. Trending cluster queries
    const trendingQueries = await this.generateTrendingClusterQueries(strategy.trendingQueries);
    queries.push(...trendingQueries);

    // 3. Cross-cluster exploration queries
    const crossQueries = await this.generateCrossClusterQueries(strategy.crossClusterQueries);
    queries.push(...crossQueries);

    // 4. General exploration queries
    const explorationQueries = await this.generateExplorationQueries(strategy.explorationQueries);
    queries.push(...explorationQueries);

    return queries;
  }

  /**
   * Generate queries specifically for filling cluster gaps
   */
  private async generateGapFillingQueries(count: number): Promise<ClusterAwareQuery[]> {
    const gaps = await clusterAnalysis.identifyClusterGaps();
    const queries: ClusterAwareQuery[] = [];

    // Focus on high-priority gaps
    const highPriorityGaps = gaps.filter(g => g.priority === 'high').slice(0, Math.ceil(count * 0.6));
    const mediumPriorityGaps = gaps.filter(g => g.priority === 'medium').slice(0, Math.ceil(count * 0.4));

    // Generate queries for each gap
    for (const gap of [...highPriorityGaps, ...mediumPriorityGaps]) {
      const clusterQueries = await this.generateQueriesForGap(gap);
      queries.push(...clusterQueries.slice(0, Math.ceil(count / (highPriorityGaps.length + mediumPriorityGaps.length))));
    }

    return queries.slice(0, count);
  }

  /**
   * Generate queries for a specific cluster gap
   */
  private async generateQueriesForGap(gap: ClusterGap): Promise<ClusterAwareQuery[]> {
    const searchTerms = await clusterAnalysis.generateClusterSearchTerms(gap.clusterId);
    if (!searchTerms) return [];

    const queries: ClusterAwareQuery[] = [];
    const templates = this.getEducationalTemplates();

    // Combine cluster-specific terms with educational templates
    searchTerms.coreTerms.forEach(term => {
      templates.forEach(template => {
        queries.push({
          query: template.replace('{topic}', term),
          category: gap.topicDomain,
          queryType: 'gap_filling',
          clusterId: gap.clusterId,
          clusterName: gap.topicName,
          priority: gap.priority,
          rationale: `Filling gap: ${gap.rationale} (need ${gap.gapSize} more videos)`
        });
      });
    });

    // Add format-specific queries
    searchTerms.formatTerms.forEach(format => {
      searchTerms.coreTerms.slice(0, 2).forEach(term => {
        queries.push({
          query: `${term} ${format} ${new Date().getFullYear()}`,
          category: gap.topicDomain,
          queryType: 'gap_filling',
          clusterId: gap.clusterId,
          clusterName: gap.topicName,
          priority: gap.priority,
          rationale: `Format-specific gap filling for ${gap.topicName}`
        });
      });
    });

    return queries;
  }

  /**
   * Generate queries for trending clusters
   */
  private async generateTrendingClusterQueries(count: number): Promise<ClusterAwareQuery[]> {
    const trending = await clusterAnalysis.identifyTrendingClusters(30);
    const queries: ClusterAwareQuery[] = [];

    // Focus on hottest trends
    const hotTrends = trending
      .filter(t => t.trendStrength === 'viral' || t.trendStrength === 'hot')
      .slice(0, Math.ceil(count * 0.7));

    for (const trend of hotTrends) {
      const trendQueries = await this.generateQueriesForTrend(trend);
      queries.push(...trendQueries.slice(0, Math.ceil(count / hotTrends.length)));
    }

    return queries.slice(0, count);
  }

  /**
   * Generate queries for a trending cluster
   */
  private async generateQueriesForTrend(trend: TrendingCluster): Promise<ClusterAwareQuery[]> {
    const searchTerms = await clusterAnalysis.generateClusterSearchTerms(trend.clusterId);
    if (!searchTerms) return [];

    const queries: ClusterAwareQuery[] = [];
    const trendingTemplates = [
      '{topic} 2025 latest',
      'new {topic} techniques',
      '{topic} trends 2025',
      '{topic} viral content',
      'best {topic} channels 2025',
      '{topic} breaking news'
    ];

    searchTerms.coreTerms.forEach(term => {
      trendingTemplates.forEach(template => {
        queries.push({
          query: template.replace('{topic}', term),
          category: trend.topicDomain,
          queryType: 'trending',
          clusterId: trend.clusterId,
          clusterName: trend.topicName,
          priority: trend.trendStrength === 'viral' ? 'high' : 'medium',
          rationale: `${trend.trendStrength} trend: ${trend.growthRate.toFixed(1)}x growth, ${trend.viewsGrowthRate.toFixed(1)}x views growth`
        });
      });
    });

    // Add cross-topic trending queries
    searchTerms.crossTopicTerms.forEach(cross => {
      queries.push({
        query: `${searchTerms.coreTerms[0]} ${cross.combination[0]} trending`,
        category: trend.topicDomain,
        queryType: 'trending_cross',
        clusterId: trend.clusterId,
        clusterName: trend.topicName,
        priority: 'medium',
        rationale: `Cross-topic trend exploration for ${trend.topicName}`
      });
    });

    return queries;
  }

  /**
   * Generate cross-cluster exploration queries
   */
  private async generateCrossClusterQueries(count: number): Promise<ClusterAwareQuery[]> {
    const queries: ClusterAwareQuery[] = [];
    
    // Get diverse clusters from different domains
    const stats = await clusterAnalysis.getClusterStats();
    const domainClusters = new Map<string, typeof stats>();
    
    stats.forEach(stat => {
      if (!domainClusters.has(stat.topicDomain)) {
        domainClusters.set(stat.topicDomain, []);
      }
      domainClusters.get(stat.topicDomain)!.push(stat);
    });

    // Create cross-domain combinations
    const domains = Array.from(domainClusters.keys());
    for (let i = 0; i < domains.length - 1; i++) {
      for (let j = i + 1; j < domains.length; j++) {
        const domain1Clusters = domainClusters.get(domains[i])!;
        const domain2Clusters = domainClusters.get(domains[j])!;
        
        // Pick top performing cluster from each domain
        const cluster1 = domain1Clusters.sort((a, b) => b.avgPerformance - a.avgPerformance)[0];
        const cluster2 = domain2Clusters.sort((a, b) => b.avgPerformance - a.avgPerformance)[0];
        
        if (cluster1 && cluster2) {
          queries.push({
            query: `${cluster1.topicName} for ${cluster2.topicName} professionals`,
            category: 'cross_domain',
            queryType: 'cross_cluster',
            priority: 'low',
            rationale: `Exploring intersection of ${cluster1.topicDomain} and ${cluster2.topicDomain}`
          });
          
          queries.push({
            query: `${cluster2.topicName} meets ${cluster1.topicName}`,
            category: 'cross_domain',
            queryType: 'cross_cluster',
            priority: 'low',
            rationale: `Finding hybrid content between domains`
          });
        }
      }
    }

    return queries.slice(0, count);
  }

  /**
   * Generate general exploration queries for new clusters
   */
  private async generateExplorationQueries(count: number): Promise<ClusterAwareQuery[]> {
    // Use parent class method for general exploration
    const baseQueries = await super.generateQueries(count, {
      includeCurrentTopics: true
    });

    return baseQueries.map(q => ({
      ...q,
      priority: 'low' as const,
      rationale: 'General exploration for new topics and channels'
    }));
  }

  /**
   * Get educational query templates
   */
  private getEducationalTemplates(): string[] {
    return [
      '{topic} complete course',
      '{topic} tutorial series',
      '{topic} masterclass',
      '{topic} for beginners',
      'learn {topic} from scratch',
      '{topic} certification prep',
      '{topic} bootcamp',
      '{topic} workshop'
    ];
  }

  /**
   * Generate a discovery report with cluster insights
   */
  async generateDiscoveryReport(): Promise<{
    summary: {
      totalClusters: number;
      underRepresented: number;
      trending: number;
      wellCovered: number;
    };
    recommendations: string[];
    priorityQueries: ClusterAwareQuery[];
  }> {
    const stats = await clusterAnalysis.getClusterStats();
    const gaps = await clusterAnalysis.identifyClusterGaps();
    const trending = await clusterAnalysis.identifyTrendingClusters();

    const underRepresented = gaps.length;
    const trendingCount = trending.filter(t => t.trendStrength !== 'emerging').length;
    const wellCovered = stats.filter(s => s.videoCount >= 100).length;

    const recommendations = [
      `Focus on ${gaps.filter(g => g.priority === 'high').length} high-priority cluster gaps`,
      `Capitalize on ${trending.filter(t => t.trendStrength === 'viral').length} viral trends`,
      `${Math.round((underRepresented / stats.length) * 100)}% of clusters need more content`,
      `Average cluster has ${Math.round(stats.reduce((sum, s) => sum + s.videoCount, 0) / stats.length)} videos`
    ];

    // Generate priority queries
    const priorityQueries = await this.generateStrategicQueries({
      totalQueries: 20,
      gapFillingQueries: 10,
      trendingQueries: 8,
      explorationQueries: 2,
      crossClusterQueries: 0
    });

    return {
      summary: {
        totalClusters: stats.length,
        underRepresented,
        trending: trendingCount,
        wellCovered
      },
      recommendations,
      priorityQueries
    };
  }
}

// Export singleton instance
export const clusterAwareQueryGenerator = new ClusterAwareDiscoveryGenerator();