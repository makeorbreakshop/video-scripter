import { createClient } from '@supabase/supabase-js';
import { DiscoveryQueryGenerator } from './discovery-query-generator';

interface ClusterMetadata {
  cluster_id: number;
  name: string;
  keywords: string[];
  search_terms: string[];
  subtopics: string[];
  video_count: number;
  avg_views: number;
  is_growing?: boolean;
  is_underrepresented?: boolean;
}

interface ClusterQuery {
  query: string;
  category: string;
  queryType: string;
  cluster_id?: number;
  priority_score?: number;
  metadata?: {
    cluster_name: string;
    is_growing: boolean;
    is_underrepresented: boolean;
  };
}

export class ClusterAwareQueryGenerator extends DiscoveryQueryGenerator {
  private supabase: any;
  private clusterCache: Map<number, ClusterMetadata> = new Map();
  private coverageData: any = null;

  constructor() {
    super();
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
    this.supabase = createClient(supabaseUrl, supabaseKey);
  }

  /**
   * Load cluster metadata and coverage data
   */
  async loadClusterData(): Promise<void> {
    // Load cluster metadata
    const { data: clusters, error } = await this.supabase
      .from('cluster_metadata')
      .select('*')
      .order('cluster_id');

    if (error) throw error;

    // Cache cluster data
    clusters.forEach((cluster: any) => {
      this.clusterCache.set(cluster.cluster_id, {
        cluster_id: cluster.cluster_id,
        name: cluster.name || `Cluster ${cluster.cluster_id}`,
        keywords: cluster.keywords || [],
        search_terms: cluster.search_terms || [],
        subtopics: cluster.subtopics || [],
        video_count: cluster.video_count || 0,
        avg_views: cluster.avg_views || 0
      });
    });

    // Load coverage analysis if available
    try {
      const { data: coverageReport } = await this.supabase
        .from('cluster_coverage_reports')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(1)
        .single();

      if (coverageReport) {
        this.coverageData = coverageReport.data;
      }
    } catch (e) {
      // Coverage report might not exist yet
      console.log('No coverage report found, using basic cluster data');
    }
  }

  /**
   * Generate queries based on cluster insights
   */
  async generateClusterAwareQueries(
    count: number = 100,
    options?: {
      prioritizeGrowth?: boolean;
      prioritizeGaps?: boolean;
      clusterIds?: number[];
    }
  ): Promise<ClusterQuery[]> {
    await this.loadClusterData();

    const queries: ClusterQuery[] = [];
    const targetClusters = this.selectTargetClusters(options);

    // Generate queries for high-priority clusters
    for (const cluster of targetClusters) {
      if (queries.length >= count) break;

      const clusterQueries = this.generateQueriesForCluster(cluster);
      queries.push(...clusterQueries);
    }

    // Fill remaining with general queries
    if (queries.length < count) {
      const generalQueries = await this.generateQueries(count - queries.length);
      queries.push(...generalQueries.map(q => ({
        ...q,
        cluster_id: undefined,
        priority_score: 0
      })));
    }

    return queries.slice(0, count);
  }

  /**
   * Generate queries specifically for underrepresented clusters
   */
  async generateGapFillingClusterQueries(count: number = 40): Promise<ClusterQuery[]> {
    await this.loadClusterData();

    const underrepresentedClusters = this.getUnderrepresentedClusters();
    const queries: ClusterQuery[] = [];

    for (const cluster of underrepresentedClusters) {
      if (queries.length >= count) break;

      const clusterQueries = this.generateQueriesForCluster(cluster, {
        focusOnEducational: true,
        includeVariations: true
      });
      queries.push(...clusterQueries);
    }

    return queries.slice(0, count);
  }

  /**
   * Generate queries for fast-growing clusters
   */
  async generateTrendingClusterQueries(count: number = 30): Promise<ClusterQuery[]> {
    await this.loadClusterData();

    const growingClusters = this.getGrowingClusters();
    const queries: ClusterQuery[] = [];

    for (const cluster of growingClusters) {
      if (queries.length >= count) break;

      const clusterQueries = this.generateQueriesForCluster(cluster, {
        focusOnTrending: true,
        includeCurrentYear: true
      });
      queries.push(...clusterQueries);
    }

    return queries.slice(0, count);
  }

  /**
   * Generate cross-cluster queries to find hybrid content
   */
  async generateCrossClusterQueries(count: number = 20): Promise<ClusterQuery[]> {
    await this.loadClusterData();

    const queries: ClusterQuery[] = [];
    const clusters = Array.from(this.clusterCache.values());

    // Find complementary cluster pairs
    const clusterPairs = this.findComplementaryClusterPairs(clusters);

    for (const [cluster1, cluster2] of clusterPairs) {
      if (queries.length >= count) break;

      const crossQuery = this.generateCrossClusterQuery(cluster1, cluster2);
      queries.push(crossQuery);
    }

    return queries;
  }

  private selectTargetClusters(options?: any): ClusterMetadata[] {
    let clusters = Array.from(this.clusterCache.values());

    // Filter by specific cluster IDs if provided
    if (options?.clusterIds?.length > 0) {
      clusters = clusters.filter(c => options.clusterIds.includes(c.cluster_id));
    }

    // Add metadata about growth and representation
    clusters = clusters.map(cluster => {
      const isGrowing = this.isGrowingCluster(cluster.cluster_id);
      const isUnderrepresented = this.isUnderrepresentedCluster(cluster.cluster_id);
      
      return {
        ...cluster,
        is_growing: isGrowing,
        is_underrepresented: isUnderrepresented,
        priority_score: this.calculateClusterPriority(cluster, isGrowing, isUnderrepresented)
      };
    });

    // Sort by priority
    clusters.sort((a, b) => (b.priority_score || 0) - (a.priority_score || 0));

    // Return top clusters based on options
    if (options?.prioritizeGrowth) {
      return clusters.filter(c => c.is_growing).slice(0, 30);
    } else if (options?.prioritizeGaps) {
      return clusters.filter(c => c.is_underrepresented).slice(0, 30);
    }

    return clusters.slice(0, 50);
  }

  private generateQueriesForCluster(
    cluster: ClusterMetadata,
    options?: {
      focusOnEducational?: boolean;
      focusOnTrending?: boolean;
      includeVariations?: boolean;
      includeCurrentYear?: boolean;
    }
  ): ClusterQuery[] {
    const queries: ClusterQuery[] = [];
    
    // Use cluster keywords and search terms
    const terms = [
      cluster.name,
      ...cluster.keywords.slice(0, 3),
      ...cluster.search_terms.slice(0, 2)
    ].filter(Boolean);

    // Select appropriate templates based on options
    let templates = this.queryTemplates;
    if (options?.focusOnEducational) {
      templates = templates.filter(t => 
        ['educational', 'course', 'tutorial'].includes(t.category)
      );
    } else if (options?.focusOnTrending) {
      templates = templates.filter(t => t.category === 'trending');
    }

    // Generate queries
    for (const term of terms.slice(0, 3)) {
      for (const template of templates.slice(0, 3)) {
        let query = template.template.replace('{topic}', term);
        
        if (options?.includeCurrentYear && !query.includes('2025')) {
          query = query.replace(/202\d/g, '2025');
          if (!query.includes('2025')) {
            query += ' 2025';
          }
        }

        queries.push({
          query,
          category: this.getTopicCategory(term),
          queryType: template.category,
          cluster_id: cluster.cluster_id,
          priority_score: cluster.priority_score,
          metadata: {
            cluster_name: cluster.name,
            is_growing: cluster.is_growing || false,
            is_underrepresented: cluster.is_underrepresented || false
          }
        });
      }
    }

    // Add variations if requested
    if (options?.includeVariations && cluster.subtopics.length > 0) {
      for (const subtopic of cluster.subtopics.slice(0, 2)) {
        queries.push({
          query: `${cluster.name} ${subtopic} tutorial`,
          category: this.getTopicCategory(cluster.name),
          queryType: 'tutorial',
          cluster_id: cluster.cluster_id,
          priority_score: cluster.priority_score
        });
      }
    }

    return queries;
  }

  private generateCrossClusterQuery(
    cluster1: ClusterMetadata,
    cluster2: ClusterMetadata
  ): ClusterQuery {
    const templates = [
      '{topic1} for {topic2} professionals',
      '{topic1} and {topic2} integration',
      'combining {topic1} with {topic2}',
      '{topic1} techniques in {topic2}'
    ];

    const template = templates[Math.floor(Math.random() * templates.length)];
    const query = template
      .replace('{topic1}', cluster1.name)
      .replace('{topic2}', cluster2.name);

    return {
      query,
      category: 'cross_topic',
      queryType: 'cross_topic',
      metadata: {
        cluster_name: `${cluster1.name} × ${cluster2.name}`,
        is_growing: false,
        is_underrepresented: false
      }
    };
  }

  private findComplementaryClusterPairs(clusters: ClusterMetadata[]): [ClusterMetadata, ClusterMetadata][] {
    const pairs: [ClusterMetadata, ClusterMetadata][] = [];
    
    // Find clusters that might have synergy
    const categories = {
      technical: ['programming', 'development', 'coding', 'software', 'tech'],
      business: ['business', 'marketing', 'sales', 'entrepreneur', 'startup'],
      creative: ['design', 'video', 'art', 'music', 'creative'],
      educational: ['teaching', 'education', 'learning', 'course', 'tutorial']
    };

    for (let i = 0; i < clusters.length - 1; i++) {
      for (let j = i + 1; j < clusters.length; j++) {
        const cluster1 = clusters[i];
        const cluster2 = clusters[j];
        
        // Check if they're from different but complementary categories
        const cat1 = this.getClusterCategory(cluster1, categories);
        const cat2 = this.getClusterCategory(cluster2, categories);
        
        if (cat1 !== cat2 && this.areCategoriesComplementary(cat1, cat2)) {
          pairs.push([cluster1, cluster2]);
        }
        
        if (pairs.length >= 20) return pairs;
      }
    }

    return pairs;
  }

  private getClusterCategory(cluster: ClusterMetadata, categories: any): string {
    const clusterText = `${cluster.name} ${cluster.keywords.join(' ')}`.toLowerCase();
    
    for (const [category, keywords] of Object.entries(categories)) {
      if (keywords.some((keyword: string) => clusterText.includes(keyword))) {
        return category;
      }
    }
    
    return 'general';
  }

  private areCategoriesComplementary(cat1: string, cat2: string): boolean {
    const complementary = {
      technical: ['business', 'creative'],
      business: ['technical', 'creative', 'educational'],
      creative: ['technical', 'business'],
      educational: ['business']
    };

    return complementary[cat1]?.includes(cat2) || false;
  }

  private calculateClusterPriority(
    cluster: ClusterMetadata,
    isGrowing: boolean,
    isUnderrepresented: boolean
  ): number {
    let priority = 0;

    // Size factor (smaller clusters get higher priority)
    if (cluster.video_count < 100) priority += 30;
    else if (cluster.video_count < 500) priority += 20;
    else if (cluster.video_count < 1000) priority += 10;

    // Growth factor
    if (isGrowing) priority += 25;

    // Representation factor
    if (isUnderrepresented) priority += 20;

    // Performance factor
    if (cluster.avg_views > 50000) priority += 15;
    else if (cluster.avg_views > 10000) priority += 10;
    else if (cluster.avg_views > 5000) priority += 5;

    return priority;
  }

  private isGrowingCluster(clusterId: number): boolean {
    if (!this.coverageData) return false;
    return this.coverageData.fastest_growing_clusters?.some(
      (c: any) => c.cluster_id === clusterId
    ) || false;
  }

  private isUnderrepresentedCluster(clusterId: number): boolean {
    if (!this.coverageData) return false;
    return this.coverageData.underrepresented_clusters?.some(
      (c: any) => c.cluster_id === clusterId
    ) || false;
  }

  private getUnderrepresentedClusters(): ClusterMetadata[] {
    if (!this.coverageData) return [];
    
    const underrepresentedIds = this.coverageData.underrepresented_clusters
      ?.map((c: any) => c.cluster_id) || [];
    
    return underrepresentedIds
      .map((id: number) => this.clusterCache.get(id))
      .filter(Boolean) as ClusterMetadata[];
  }

  private getGrowingClusters(): ClusterMetadata[] {
    if (!this.coverageData) return [];
    
    const growingIds = this.coverageData.fastest_growing_clusters
      ?.map((c: any) => c.cluster_id) || [];
    
    return growingIds
      .map((id: number) => this.clusterCache.get(id))
      .filter(Boolean) as ClusterMetadata[];
  }
}

// Export singleton instance
export const clusterAwareQueryGenerator = new ClusterAwareQueryGenerator();