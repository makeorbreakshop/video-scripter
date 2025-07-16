import { Pinecone } from '@pinecone-database/pinecone';
import { createClient } from '@/lib/supabase-client';
import { Database } from '@/types/database';

interface SemanticCluster {
  id: string;
  level: 'macro' | 'meso' | 'micro';
  centroid: number[];
  radius: number;
  videoCount: number;
  videos?: string[]; // Video IDs
  performanceStats?: {
    avg: number;
    median: number;
    stdDev: number;
  };
}

interface SemanticPattern {
  id?: string;
  pattern_type: string;
  centroid_embedding: number[];
  semantic_radius: number;
  cluster_hierarchy: {
    macro?: string;
    meso?: string;
    micro?: string;
  };
  pattern_data: {
    name: string;
    description?: string;
    template?: string;
    format_distribution?: Record<string, number>;
    avg_performance: number;
    confidence: number;
    sample_size: number;
  };
  performance_stats: {
    within_radius: { avg: number; count: number; median: number };
    outside_radius: { avg: number; count: number; median: number };
    lift_ratio: number;
  };
}

export class SemanticPatternDiscovery {
  private pinecone: Pinecone;
  private supabase: ReturnType<typeof createClient>;
  private titleIndex: any;

  constructor() {
    this.pinecone = new Pinecone({
      apiKey: process.env.PINECONE_API_KEY!,
    });
    this.supabase = createClient();
  }

  async initialize() {
    this.titleIndex = await this.pinecone.index(process.env.PINECONE_INDEX_NAME!);
  }

  /**
   * Main entry point for semantic pattern discovery
   */
  async discoverSemanticPatterns(options: {
    minClusterSize?: number;
    maxClusterSize?: number;
    similarityThreshold?: number;
    performanceThreshold?: number;
  } = {}) {
    const {
      minClusterSize = 30,
      maxClusterSize = 500,
      similarityThreshold = 0.8,
      performanceThreshold = 2.0
    } = options;

    console.log('Starting semantic pattern discovery...');

    // Step 1: Find semantic neighborhoods
    const neighborhoods = await this.findSemanticNeighborhoods({
      minClusterSize,
      maxClusterSize,
      similarityThreshold
    });

    console.log(`Found ${neighborhoods.length} semantic neighborhoods`);

    // Step 2: Analyze each neighborhood for patterns
    const allPatterns: SemanticPattern[] = [];
    
    for (const neighborhood of neighborhoods) {
      const patterns = await this.analyzeSemanticNeighborhood(neighborhood, {
        performanceThreshold
      });
      allPatterns.push(...patterns);
    }

    console.log(`Discovered ${allPatterns.length} semantic patterns`);

    // Step 3: Store patterns in database
    await this.storeSemanticPatterns(allPatterns);

    return allPatterns;
  }

  /**
   * Find clusters of semantically similar videos
   */
  private async findSemanticNeighborhoods(options: {
    minClusterSize: number;
    maxClusterSize: number;
    similarityThreshold: number;
  }): Promise<SemanticCluster[]> {
    // Get sample of high-performing videos to use as seeds
    const { data: seedVideos } = await this.supabase
      .from('videos')
      .select('id, title, view_count, channel_average_views')
      .gt('view_count', 0)
      .not('channel_average_views', 'is', null)
      .gte('age_days', 30) // Only well-aged videos
      .order('view_count', { ascending: false })
      .limit(1000);

    if (!seedVideos || seedVideos.length === 0) {
      console.warn('No seed videos found');
      return [];
    }

    // Calculate performance ratios
    const highPerformers = seedVideos
      .map(v => ({
        ...v,
        performance_ratio: v.view_count / (v.channel_average_views || 1)
      }))
      .filter(v => v.performance_ratio > 2.0)
      .slice(0, 100); // Top 100 high performers as seeds

    const clusters: SemanticCluster[] = [];
    const processedVideos = new Set<string>();

    // Build clusters around each high performer
    for (const seed of highPerformers) {
      if (processedVideos.has(seed.id)) continue;

      // Query similar videos from Pinecone
      const similarVideos = await this.findSimilarVideos(seed.id, {
        topK: options.maxClusterSize,
        minSimilarity: options.similarityThreshold
      });

      if (similarVideos.length < options.minClusterSize) continue;

      // Calculate cluster centroid
      const centroid = await this.calculateCentroid(similarVideos.map(v => v.id));
      
      // Create cluster
      const cluster: SemanticCluster = {
        id: `cluster_${Date.now()}_${seed.id}`,
        level: this.determineClusterLevel(similarVideos.length),
        centroid,
        radius: 1 - options.similarityThreshold, // Convert similarity to distance
        videoCount: similarVideos.length,
        videos: similarVideos.map(v => v.id)
      };

      // Calculate performance stats
      const performanceStats = await this.calculateClusterPerformance(cluster.videos!);
      cluster.performanceStats = performanceStats;

      clusters.push(cluster);

      // Mark videos as processed
      similarVideos.forEach(v => processedVideos.add(v.id));
    }

    return clusters;
  }

  /**
   * Find videos similar to a given video using Pinecone
   */
  private async findSimilarVideos(videoId: string, options: {
    topK: number;
    minSimilarity: number;
  }) {
    // Get the video's embedding from Pinecone
    const queryResponse = await this.titleIndex.fetch([videoId]);
    const videoData = queryResponse.records?.[videoId];
    
    if (!videoData?.values) {
      console.warn(`No embedding found for video ${videoId}`);
      return [];
    }

    // Search for similar videos
    const searchResponse = await this.titleIndex.query({
      vector: videoData.values,
      topK: options.topK,
      includeMetadata: true,
      filter: {
        // Exclude the query video itself
        video_id: { $ne: videoId }
      }
    });

    // Filter by minimum similarity
    return searchResponse.matches
      .filter(match => (match.score || 0) >= options.minSimilarity)
      .map(match => ({
        id: match.metadata?.video_id as string || match.id,
        similarity: match.score || 0
      }));
  }

  /**
   * Calculate centroid embedding for a cluster
   */
  private async calculateCentroid(videoIds: string[]): Promise<number[]> {
    // Fetch embeddings in batches
    const batchSize = 100;
    const embeddings: number[][] = [];

    for (let i = 0; i < videoIds.length; i += batchSize) {
      const batch = videoIds.slice(i, i + batchSize);
      const response = await this.titleIndex.fetch(batch);
      
      for (const record of Object.values(response.records || {})) {
        if (record.values) {
          embeddings.push(record.values);
        }
      }
    }

    if (embeddings.length === 0) return new Array(512).fill(0);

    // Calculate mean of all embeddings
    const centroid = new Array(embeddings[0].length).fill(0);
    for (const embedding of embeddings) {
      for (let i = 0; i < embedding.length; i++) {
        centroid[i] += embedding[i];
      }
    }
    
    // Normalize
    const magnitude = Math.sqrt(centroid.reduce((sum, val) => sum + val * val, 0));
    return centroid.map(val => val / magnitude);
  }

  /**
   * Analyze a semantic neighborhood for patterns
   */
  private async analyzeSemanticNeighborhood(
    cluster: SemanticCluster,
    options: { performanceThreshold: number }
  ): Promise<SemanticPattern[]> {
    if (!cluster.videos || cluster.videos.length === 0) return [];

    // Get video details from database
    const { data: videos } = await this.supabase
      .from('videos')
      .select(`
        id,
        title,
        view_count,
        channel_average_views,
        published_at,
        duration_seconds,
        format,
        topic_cluster_3
      `)
      .in('id', cluster.videos);

    if (!videos || videos.length === 0) return [];

    // Calculate performance ratios
    const videosWithPerformance = videos.map(v => ({
      ...v,
      performance_ratio: v.view_count / (v.channel_average_views || 1),
      age_days: Math.floor((Date.now() - new Date(v.published_at).getTime()) / (1000 * 60 * 60 * 24))
    }));

    // Filter high performers with good age confidence
    const highPerformers = videosWithPerformance.filter(v => 
      v.performance_ratio >= options.performanceThreshold &&
      v.age_days >= 30
    );

    if (highPerformers.length < 10) return []; // Not enough data

    const patterns: SemanticPattern[] = [];

    // Pattern 1: Format distribution analysis
    const formatPattern = await this.analyzeFormatPattern(cluster, highPerformers, videosWithPerformance);
    if (formatPattern) patterns.push(formatPattern);

    // Pattern 2: Title structure patterns
    const titlePatterns = await this.analyzeTitlePatterns(cluster, highPerformers, videosWithPerformance);
    patterns.push(...titlePatterns);

    // Pattern 3: Duration patterns
    const durationPattern = await this.analyzeDurationPattern(cluster, highPerformers, videosWithPerformance);
    if (durationPattern) patterns.push(durationPattern);

    // Pattern 4: Combined patterns (format + other features)
    const combinedPatterns = await this.analyzeCombinedPatterns(cluster, highPerformers, videosWithPerformance);
    patterns.push(...combinedPatterns);

    return patterns;
  }

  /**
   * Analyze format distribution patterns
   */
  private async analyzeFormatPattern(
    cluster: SemanticCluster,
    highPerformers: any[],
    allVideos: any[]
  ): Promise<SemanticPattern | null> {
    // Count formats in high performers vs all videos
    const highPerformerFormats = this.countByProperty(highPerformers, 'format');
    const allFormats = this.countByProperty(allVideos, 'format');

    // Find formats that are overrepresented in high performers
    const significantFormats: Array<{ format: string; lift: number }> = [];
    
    for (const [format, count] of Object.entries(highPerformerFormats)) {
      const highPerformerRate = count / highPerformers.length;
      const overallRate = (allFormats[format] || 0) / allVideos.length;
      
      if (overallRate > 0) {
        const lift = highPerformerRate / overallRate;
        if (lift > 1.5 && count >= 5) {
          significantFormats.push({ format, lift });
        }
      }
    }

    if (significantFormats.length === 0) return null;

    // Sort by lift
    significantFormats.sort((a, b) => b.lift - a.lift);
    const topFormat = significantFormats[0];

    // Calculate performance stats
    const formatVideos = highPerformers.filter(v => v.format === topFormat.format);
    const nonFormatVideos = allVideos.filter(v => v.format !== topFormat.format);

    const pattern: SemanticPattern = {
      pattern_type: 'format_semantic',
      centroid_embedding: cluster.centroid,
      semantic_radius: cluster.radius,
      cluster_hierarchy: { [cluster.level]: cluster.id },
      pattern_data: {
        name: `${topFormat.format} format in semantic cluster`,
        description: `Videos using ${topFormat.format} format perform ${topFormat.lift.toFixed(1)}x better in this semantic neighborhood`,
        format_distribution: highPerformerFormats,
        avg_performance: this.calculateAverage(formatVideos, 'performance_ratio'),
        confidence: this.calculateConfidence(formatVideos.length, topFormat.lift),
        sample_size: formatVideos.length
      },
      performance_stats: {
        within_radius: {
          avg: this.calculateAverage(formatVideos, 'performance_ratio'),
          count: formatVideos.length,
          median: this.calculateMedian(formatVideos, 'performance_ratio')
        },
        outside_radius: {
          avg: this.calculateAverage(nonFormatVideos, 'performance_ratio'),
          count: nonFormatVideos.length,
          median: this.calculateMedian(nonFormatVideos, 'performance_ratio')
        },
        lift_ratio: topFormat.lift
      }
    };

    return pattern;
  }

  /**
   * Analyze title patterns using n-grams and structure
   */
  private async analyzeTitlePatterns(
    cluster: SemanticCluster,
    highPerformers: any[],
    allVideos: any[]
  ): Promise<SemanticPattern[]> {
    const patterns: SemanticPattern[] = [];

    // Extract n-grams from high performer titles
    const highPerformerNgrams = this.extractNgrams(highPerformers.map(v => v.title), 2, 4);
    const allNgrams = this.extractNgrams(allVideos.map(v => v.title), 2, 4);

    // Find significant n-grams
    for (const [ngram, count] of Object.entries(highPerformerNgrams)) {
      if (count < 5) continue; // Minimum support

      const highRate = count / highPerformers.length;
      const overallRate = (allNgrams[ngram] || 0) / allVideos.length;
      
      if (overallRate > 0) {
        const lift = highRate / overallRate;
        
        if (lift > 2.0) {
          // Create pattern for this n-gram
          const ngramVideos = highPerformers.filter(v => 
            v.title.toLowerCase().includes(ngram.toLowerCase())
          );

          const pattern: SemanticPattern = {
            pattern_type: 'title_ngram_semantic',
            centroid_embedding: cluster.centroid,
            semantic_radius: cluster.radius,
            cluster_hierarchy: { [cluster.level]: cluster.id },
            pattern_data: {
              name: `"${ngram}" in titles`,
              description: `Titles containing "${ngram}" perform ${lift.toFixed(1)}x better in this semantic neighborhood`,
              template: `[...] ${ngram} [...]`,
              avg_performance: this.calculateAverage(ngramVideos, 'performance_ratio'),
              confidence: this.calculateConfidence(ngramVideos.length, lift),
              sample_size: ngramVideos.length
            },
            performance_stats: {
              within_radius: {
                avg: this.calculateAverage(ngramVideos, 'performance_ratio'),
                count: ngramVideos.length,
                median: this.calculateMedian(ngramVideos, 'performance_ratio')
              },
              outside_radius: {
                avg: this.calculateAverage(
                  allVideos.filter(v => !v.title.toLowerCase().includes(ngram.toLowerCase())), 
                  'performance_ratio'
                ),
                count: allVideos.length - ngramVideos.length,
                median: this.calculateMedian(
                  allVideos.filter(v => !v.title.toLowerCase().includes(ngram.toLowerCase())), 
                  'performance_ratio'
                )
              },
              lift_ratio: lift
            }
          };

          patterns.push(pattern);
        }
      }
    }

    // Sort by lift and take top 5
    return patterns
      .sort((a, b) => b.performance_stats.lift_ratio - a.performance_stats.lift_ratio)
      .slice(0, 5);
  }

  /**
   * Analyze duration patterns
   */
  private async analyzeDurationPattern(
    cluster: SemanticCluster,
    highPerformers: any[],
    allVideos: any[]
  ): Promise<SemanticPattern | null> {
    // Define duration buckets
    const durationBuckets = [
      { name: '0-60s', min: 0, max: 60 },
      { name: '1-5min', min: 60, max: 300 },
      { name: '5-10min', min: 300, max: 600 },
      { name: '10-20min', min: 600, max: 1200 },
      { name: '20min+', min: 1200, max: Infinity }
    ];

    // Count videos in each bucket
    const highPerformerBuckets: Record<string, number> = {};
    const allBuckets: Record<string, number> = {};

    for (const bucket of durationBuckets) {
      highPerformerBuckets[bucket.name] = highPerformers.filter(v => 
        v.duration_seconds >= bucket.min && v.duration_seconds < bucket.max
      ).length;
      
      allBuckets[bucket.name] = allVideos.filter(v => 
        v.duration_seconds >= bucket.min && v.duration_seconds < bucket.max
      ).length;
    }

    // Find the best performing bucket
    let bestBucket = null;
    let bestLift = 0;

    for (const bucket of durationBuckets) {
      const highRate = highPerformerBuckets[bucket.name] / highPerformers.length;
      const overallRate = allBuckets[bucket.name] / allVideos.length;
      
      if (overallRate > 0 && highPerformerBuckets[bucket.name] >= 5) {
        const lift = highRate / overallRate;
        if (lift > bestLift && lift > 1.5) {
          bestLift = lift;
          bestBucket = bucket;
        }
      }
    }

    if (!bestBucket) return null;

    // Get videos in best bucket
    const bucketVideos = highPerformers.filter(v => 
      v.duration_seconds >= bestBucket.min && v.duration_seconds < bestBucket.max
    );

    const pattern: SemanticPattern = {
      pattern_type: 'duration_semantic',
      centroid_embedding: cluster.centroid,
      semantic_radius: cluster.radius,
      cluster_hierarchy: { [cluster.level]: cluster.id },
      pattern_data: {
        name: `${bestBucket.name} duration optimal`,
        description: `Videos with ${bestBucket.name} duration perform ${bestLift.toFixed(1)}x better in this semantic neighborhood`,
        avg_performance: this.calculateAverage(bucketVideos, 'performance_ratio'),
        confidence: this.calculateConfidence(bucketVideos.length, bestLift),
        sample_size: bucketVideos.length
      },
      performance_stats: {
        within_radius: {
          avg: this.calculateAverage(bucketVideos, 'performance_ratio'),
          count: bucketVideos.length,
          median: this.calculateMedian(bucketVideos, 'performance_ratio')
        },
        outside_radius: {
          avg: this.calculateAverage(
            allVideos.filter(v => v.duration_seconds < bestBucket.min || v.duration_seconds >= bestBucket.max),
            'performance_ratio'
          ),
          count: allVideos.length - bucketVideos.length,
          median: this.calculateMedian(
            allVideos.filter(v => v.duration_seconds < bestBucket.min || v.duration_seconds >= bestBucket.max),
            'performance_ratio'
          )
        },
        lift_ratio: bestLift
      }
    };

    return pattern;
  }

  /**
   * Analyze combined patterns (e.g., format + duration)
   */
  private async analyzeCombinedPatterns(
    cluster: SemanticCluster,
    highPerformers: any[],
    allVideos: any[]
  ): Promise<SemanticPattern[]> {
    const patterns: SemanticPattern[] = [];

    // Get top formats
    const formatCounts = this.countByProperty(highPerformers, 'format');
    const topFormats = Object.entries(formatCounts)
      .filter(([_, count]) => count >= 5)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([format]) => format);

    // For each top format, check if certain durations work better
    for (const format of topFormats) {
      const formatHighPerformers = highPerformers.filter(v => v.format === format);
      const formatAllVideos = allVideos.filter(v => v.format === format);

      if (formatHighPerformers.length < 10) continue;

      // Check short vs long for this format
      const shortHighPerformers = formatHighPerformers.filter(v => v.duration_seconds < 600);
      const longHighPerformers = formatHighPerformers.filter(v => v.duration_seconds >= 600);

      if (shortHighPerformers.length >= 5 && longHighPerformers.length >= 5) {
        const shortAvg = this.calculateAverage(shortHighPerformers, 'performance_ratio');
        const longAvg = this.calculateAverage(longHighPerformers, 'performance_ratio');

        if (shortAvg / longAvg > 1.5 || longAvg / shortAvg > 1.5) {
          const better = shortAvg > longAvg ? 'short' : 'long';
          const betterVideos = better === 'short' ? shortHighPerformers : longHighPerformers;
          const lift = better === 'short' ? shortAvg / longAvg : longAvg / shortAvg;

          const pattern: SemanticPattern = {
            pattern_type: 'combined_format_duration',
            centroid_embedding: cluster.centroid,
            semantic_radius: cluster.radius,
            cluster_hierarchy: { [cluster.level]: cluster.id },
            pattern_data: {
              name: `${format} + ${better} duration`,
              description: `${format} videos perform ${lift.toFixed(1)}x better when ${better} (<10min) in this semantic neighborhood`,
              avg_performance: this.calculateAverage(betterVideos, 'performance_ratio'),
              confidence: this.calculateConfidence(betterVideos.length, lift),
              sample_size: betterVideos.length
            },
            performance_stats: {
              within_radius: {
                avg: this.calculateAverage(betterVideos, 'performance_ratio'),
                count: betterVideos.length,
                median: this.calculateMedian(betterVideos, 'performance_ratio')
              },
              outside_radius: {
                avg: this.calculateAverage(
                  formatAllVideos.filter(v => better === 'short' ? v.duration_seconds >= 600 : v.duration_seconds < 600),
                  'performance_ratio'
                ),
                count: formatAllVideos.length - betterVideos.length,
                median: this.calculateMedian(
                  formatAllVideos.filter(v => better === 'short' ? v.duration_seconds >= 600 : v.duration_seconds < 600),
                  'performance_ratio'
                )
              },
              lift_ratio: lift
            }
          };

          patterns.push(pattern);
        }
      }
    }

    return patterns;
  }

  /**
   * Store discovered patterns in the database
   */
  private async storeSemanticPatterns(patterns: SemanticPattern[]) {
    for (const pattern of patterns) {
      const { error } = await this.supabase
        .from('patterns')
        .insert({
          pattern_type: pattern.pattern_type,
          pattern_data: pattern.pattern_data,
          centroid_embedding: pattern.centroid_embedding,
          semantic_radius: pattern.semantic_radius,
          performance_stats: pattern.performance_stats
        });

      if (error) {
        console.error('Error storing pattern:', error);
      }
    }
  }

  /**
   * Calculate cluster performance statistics
   */
  private async calculateClusterPerformance(videoIds: string[]): Promise<{
    avg: number;
    median: number;
    stdDev: number;
  }> {
    const { data: videos } = await this.supabase
      .from('videos')
      .select('view_count, channel_average_views')
      .in('id', videoIds)
      .not('channel_average_views', 'is', null);

    if (!videos || videos.length === 0) {
      return { avg: 0, median: 0, stdDev: 0 };
    }

    const performanceRatios = videos.map(v => v.view_count / v.channel_average_views);
    
    return {
      avg: this.calculateAverage(performanceRatios),
      median: this.calculateMedian(performanceRatios),
      stdDev: this.calculateStdDev(performanceRatios)
    };
  }

  /**
   * Determine cluster level based on size
   */
  private determineClusterLevel(size: number): 'macro' | 'meso' | 'micro' {
    if (size >= 1000) return 'macro';
    if (size >= 100) return 'meso';
    return 'micro';
  }

  /**
   * Helper: Count occurrences by property
   */
  private countByProperty(items: any[], property: string): Record<string, number> {
    const counts: Record<string, number> = {};
    for (const item of items) {
      const value = item[property];
      if (value) {
        counts[value] = (counts[value] || 0) + 1;
      }
    }
    return counts;
  }

  /**
   * Helper: Extract n-grams from titles
   */
  private extractNgrams(titles: string[], minN: number, maxN: number): Record<string, number> {
    const ngrams: Record<string, number> = {};
    
    for (const title of titles) {
      const words = title.toLowerCase().split(/\s+/);
      
      for (let n = minN; n <= maxN && n <= words.length; n++) {
        for (let i = 0; i <= words.length - n; i++) {
          const ngram = words.slice(i, i + n).join(' ');
          ngrams[ngram] = (ngrams[ngram] || 0) + 1;
        }
      }
    }
    
    return ngrams;
  }

  /**
   * Helper: Calculate average
   */
  private calculateAverage(items: any[], property?: string): number {
    if (items.length === 0) return 0;
    
    const values = property 
      ? items.map(item => item[property] || 0)
      : items;
    
    return values.reduce((sum, val) => sum + val, 0) / values.length;
  }

  /**
   * Helper: Calculate median
   */
  private calculateMedian(items: any[], property?: string): number {
    if (items.length === 0) return 0;
    
    const values = property 
      ? items.map(item => item[property] || 0)
      : items;
    
    values.sort((a, b) => a - b);
    const mid = Math.floor(values.length / 2);
    
    return values.length % 2 === 0
      ? (values[mid - 1] + values[mid]) / 2
      : values[mid];
  }

  /**
   * Helper: Calculate standard deviation
   */
  private calculateStdDev(values: number[]): number {
    if (values.length === 0) return 0;
    
    const avg = this.calculateAverage(values);
    const squaredDiffs = values.map(val => Math.pow(val - avg, 2));
    const avgSquaredDiff = this.calculateAverage(squaredDiffs);
    
    return Math.sqrt(avgSquaredDiff);
  }

  /**
   * Helper: Calculate confidence score
   */
  private calculateConfidence(sampleSize: number, lift: number): number {
    // Simple confidence calculation based on sample size and effect size
    const sampleFactor = Math.min(sampleSize / 50, 1); // Max confidence at 50+ samples
    const liftFactor = Math.min((lift - 1) / 2, 1); // Max confidence at 3x+ lift
    
    return sampleFactor * liftFactor;
  }

  /**
   * Match a video to existing semantic patterns
   */
  async matchVideoToPatterns(videoId: string): Promise<Array<{
    pattern: SemanticPattern;
    matchScore: number;
    expectedPerformance: number;
  }>> {
    // Get video embedding from Pinecone
    const embedResponse = await this.titleIndex.fetch([videoId]);
    const videoData = embedResponse.records?.[videoId];
    
    if (!videoData?.values) {
      console.warn(`No embedding found for video ${videoId}`);
      return [];
    }

    // Get all patterns from database
    const { data: patterns } = await this.supabase
      .from('patterns')
      .select('*')
      .not('centroid_embedding', 'is', null);

    if (!patterns || patterns.length === 0) return [];

    const matches: Array<{
      pattern: SemanticPattern;
      matchScore: number;
      expectedPerformance: number;
    }> = [];

    // Check each pattern
    for (const pattern of patterns) {
      // Calculate cosine similarity
      const similarity = this.cosineSimilarity(
        videoData.values,
        pattern.centroid_embedding as unknown as number[]
      );

      // Check if within semantic radius
      const distance = 1 - similarity;
      if (distance <= pattern.semantic_radius) {
        matches.push({
          pattern: pattern as unknown as SemanticPattern,
          matchScore: similarity,
          expectedPerformance: pattern.performance_stats.within_radius.avg * similarity
        });
      }
    }

    // Sort by match score
    matches.sort((a, b) => b.matchScore - a.matchScore);

    return matches;
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
    
    normA = Math.sqrt(normA);
    normB = Math.sqrt(normB);
    
    if (normA === 0 || normB === 0) return 0;
    
    return dotProduct / (normA * normB);
  }
}