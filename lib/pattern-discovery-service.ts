/**
 * Pattern Discovery Service
 * Core service for discovering patterns in video performance data
 */

import { supabase } from './supabase.ts';
import { openai } from './openai-client.ts';
import { Pinecone } from '@pinecone-database/pinecone';

// Initialize Pinecone
const pinecone = new Pinecone({
  apiKey: process.env.PINECONE_API_KEY!,
});

export interface DiscoveredPattern {
  pattern_type: 'title' | 'format' | 'timing' | 'duration' | 'compound' | 'title_structure' | 'topic_cluster' | 'thumbnail' | 'script';
  pattern_data: any;
  performance_stats: any;
  videos_analyzed: string[];
  confidence: number;
  evidence_count: number;
}

export interface PatternAnalysisContext {
  cluster_id?: string;
  topic_cluster_id?: number;
  semantic_region?: number[];
  min_performance: number;
  min_confidence: number;
  min_videos: number;
}

/**
 * Main pattern discovery orchestrator
 */
export class PatternDiscoveryService {
  public analyzers: PatternAnalyzer[] = [];

  constructor() {
    this.initializeAnalyzers();
  }

  private initializeAnalyzers() {
    this.analyzers = [
      new TitlePatternAnalyzer(),
      new TitleStructureAnalyzer(),
      new FormatOutlierAnalyzer(),
      new DurationPatternAnalyzer(),
      new TimingPatternAnalyzer(),
      new TopicClusterAnalyzer(),
      // Future analyzers can be added here
    ];
  }

  /**
   * Discover patterns in a semantic cluster
   */
  async discoverPatternsInCluster(context: PatternAnalysisContext): Promise<DiscoveredPattern[]> {
    console.log('🔍 Starting pattern discovery for context:', context);

    // 1. Get high-performing videos with confidence
    const highPerformers = await this.getHighPerformingVideos(context);
    console.log(`📊 Found ${highPerformers.length} high-performing videos`);

    if (highPerformers.length < context.min_videos) {
      console.log(`⚠️ Not enough videos (${highPerformers.length}) for pattern discovery`);
      return [];
    }

    // 2. Run all pattern analyzers
    const allPatterns: DiscoveredPattern[] = [];
    
    for (const analyzer of this.analyzers) {
      try {
        console.log(`🔬 Running ${analyzer.constructor.name}...`);
        const patterns = await analyzer.discover(highPerformers, context);
        console.log(`✅ ${analyzer.constructor.name} found ${patterns.length} patterns`);
        allPatterns.push(...patterns);
      } catch (error) {
        console.error(`❌ Error in ${analyzer.constructor.name}:`, error);
      }
    }

    // 3. Validate patterns
    const validPatterns = await this.validatePatterns(allPatterns);
    console.log(`✅ ${validPatterns.length} patterns passed validation`);

    return validPatterns;
  }

  /**
   * Get high-performing videos with confidence scoring
   */
  private async getHighPerformingVideos(context: PatternAnalysisContext) {
    let query = supabase
      .from('videos')
      .select(`
        id,
        title,
        channel_name,
        view_count,
        published_at,
        format_type,
        duration,
        rolling_baseline_views,
        channel_avg_views,
        topic_cluster_id
      `)
      .not('duration', 'is', null)
      .not('rolling_baseline_views', 'is', null);

    // Apply context filters
    if (context.topic_cluster_id) {
      query = query.eq('topic_cluster_id', context.topic_cluster_id);
    }

    const { data: videos, error } = await query;

    if (error) {
      console.error('Error fetching videos:', error);
      return [];
    }

    if (!videos) return [];

    // Filter by performance and confidence
    const filteredVideos = videos.filter(video => {
      // Calculate performance ratio
      const baselineViews = video.rolling_baseline_views || video.channel_avg_views || 1;
      const performanceRatio = video.view_count / baselineViews;

      // Calculate age confidence
      const publishedDate = new Date(video.published_at);
      const daysSincePublished = (Date.now() - publishedDate.getTime()) / (1000 * 60 * 60 * 24);
      const ageConfidence = Math.min(daysSincePublished / 30, 1.0);

      // Filter out shorts
      const isShort = /^PT[0-9]+S$/.test(video.duration) || /^PT[1-5][0-9]S$/.test(video.duration);

      return performanceRatio >= context.min_performance && 
             ageConfidence >= context.min_confidence && 
             !isShort;
    });

    return filteredVideos;
  }

  /**
   * Validate discovered patterns
   */
  private async validatePatterns(patterns: DiscoveredPattern[]): Promise<DiscoveredPattern[]> {
    const validPatterns: DiscoveredPattern[] = [];

    for (const pattern of patterns) {
      if (await this.validatePattern(pattern)) {
        validPatterns.push(pattern);
      }
    }

    return validPatterns;
  }

  /**
   * Validate a single pattern
   */
  public async validatePattern(pattern: DiscoveredPattern): Promise<boolean> {
    // Minimum sample size
    if (pattern.evidence_count < 30) {
      return false;
    }

    // Confidence threshold
    if (pattern.confidence < 0.8) {
      return false;
    }

    // Performance consistency check
    const performance = pattern.performance_stats;
    if (performance.variance > 2.0 && performance.median < 1.0) {
      return false;
    }

    return true;
  }

  /**
   * Store discovered patterns in database
   */
  async storePatterns(patterns: DiscoveredPattern[]): Promise<void> {
    for (const pattern of patterns) {
      await this.storePattern(pattern);
    }
  }

  /**
   * Store a single pattern
   */
  private async storePattern(pattern: DiscoveredPattern): Promise<void> {
    try {
      // Store pattern
      const { data: patternData, error: patternError } = await supabase
        .from('patterns')
        .insert({
          pattern_type: pattern.pattern_type,
          pattern_data: pattern.pattern_data,
          performance_stats: pattern.performance_stats
        })
        .select()
        .single();

      if (patternError) {
        console.error('Error storing pattern:', patternError);
        return;
      }

      // Store video-pattern associations
      const videoPatternAssociations = pattern.videos_analyzed.map(videoId => ({
        video_id: videoId,
        pattern_id: patternData.id,
        match_score: pattern.confidence,
        discovered_at: new Date().toISOString()
      }));

      const { error: associationError } = await supabase
        .from('video_patterns')
        .insert(videoPatternAssociations);

      if (associationError) {
        console.error('Error storing video-pattern associations:', associationError);
      }

    } catch (error) {
      console.error('Error in storePattern:', error);
    }
  }
}

/**
 * Base class for pattern analyzers
 */
export abstract class PatternAnalyzer {
  abstract discover(videos: any[], context: PatternAnalysisContext): Promise<DiscoveredPattern[]>;
  
  protected calculatePerformanceStats(videos: any[], metric: string = 'view_count'): any {
    const values = videos.map(v => {
      const baseline = v.rolling_baseline_views || v.channel_avg_views || 1;
      return v[metric] / baseline;
    });

    const sum = values.reduce((a, b) => a + b, 0);
    const avg = sum / values.length;
    const sortedValues = values.sort((a, b) => a - b);
    const median = sortedValues[Math.floor(sortedValues.length / 2)];
    const variance = values.reduce((sum, val) => sum + Math.pow(val - avg, 2), 0) / values.length;

    return {
      avg,
      median,
      count: values.length,
      variance,
      min: Math.min(...values),
      max: Math.max(...values)
    };
  }
}

/**
 * Title Pattern Analyzer - finds recurring title patterns
 */
class TitlePatternAnalyzer extends PatternAnalyzer {
  async discover(videos: any[], context: PatternAnalysisContext): Promise<DiscoveredPattern[]> {
    const patterns: DiscoveredPattern[] = [];

    // Extract N-grams from titles
    const ngrams = this.extractNgrams(videos, 1, 3);
    
    // Find high-performing n-grams
    for (const [ngram, videoGroup] of Object.entries(ngrams)) {
      if (videoGroup.length >= 10) { // Minimum occurrences
        const performanceStats = this.calculatePerformanceStats(videoGroup);
        
        if (performanceStats.avg > 2.0) { // 2x performance threshold
          patterns.push({
            pattern_type: 'title',
            pattern_data: {
              name: `"${ngram}" title pattern`,
              ngram,
              template: this.generateTemplate(ngram, videoGroup),
              examples: videoGroup.slice(0, 5).map(v => v.title),
              discovery_method: 'ngram_analysis',
              evidence_count: videoGroup.length,
              confidence: Math.min(performanceStats.avg / 2.0, 1.0)
            },
            performance_stats: performanceStats,
            videos_analyzed: videoGroup.map(v => v.id),
            confidence: Math.min(performanceStats.avg / 2.0, 1.0),
            evidence_count: videoGroup.length
          });
        }
      }
    }

    return patterns;
  }

  private extractNgrams(videos: any[], minN: number, maxN: number): Record<string, any[]> {
    const ngrams: Record<string, any[]> = {};

    for (const video of videos) {
      const words = video.title.toLowerCase().split(/\s+/);
      
      for (let n = minN; n <= maxN; n++) {
        for (let i = 0; i <= words.length - n; i++) {
          const ngram = words.slice(i, i + n).join(' ');
          
          if (!ngrams[ngram]) {
            ngrams[ngram] = [];
          }
          ngrams[ngram].push(video);
        }
      }
    }

    return ngrams;
  }

  private generateTemplate(ngram: string, videos: any[]): string {
    // Simple template generation - can be enhanced
    return `Contains "${ngram}"`;
  }
}

/**
 * Title Structure Analyzer - analyzes title formatting patterns
 */
class TitleStructureAnalyzer extends PatternAnalyzer {
  async discover(videos: any[], context: PatternAnalysisContext): Promise<DiscoveredPattern[]> {
    const patterns: DiscoveredPattern[] = [];

    // Word count analysis
    const wordCountGroups = this.groupByWordCount(videos);
    for (const [range, videoGroup] of Object.entries(wordCountGroups)) {
      if (videoGroup.length >= 20) {
        const performanceStats = this.calculatePerformanceStats(videoGroup);
        
        if (performanceStats.avg > 1.5) {
          patterns.push({
            pattern_type: 'title_structure',
            pattern_data: {
              name: `${range} word titles`,
              word_count_range: range,
              discovery_method: 'word_count_analysis',
              evidence_count: videoGroup.length,
              confidence: Math.min(performanceStats.avg / 2.0, 1.0)
            },
            performance_stats: performanceStats,
            videos_analyzed: videoGroup.map(v => v.id),
            confidence: Math.min(performanceStats.avg / 2.0, 1.0),
            evidence_count: videoGroup.length
          });
        }
      }
    }

    // Punctuation analysis
    const punctuationPatterns = this.analyzePunctuation(videos);
    patterns.push(...punctuationPatterns);

    return patterns;
  }

  private groupByWordCount(videos: any[]): Record<string, any[]> {
    const groups: Record<string, any[]> = {
      '1-3': [],
      '4-6': [],
      '7-9': [],
      '10-12': [],
      '13+': []
    };

    for (const video of videos) {
      const wordCount = video.title.split(/\s+/).length;
      
      if (wordCount <= 3) groups['1-3'].push(video);
      else if (wordCount <= 6) groups['4-6'].push(video);
      else if (wordCount <= 9) groups['7-9'].push(video);
      else if (wordCount <= 12) groups['10-12'].push(video);
      else groups['13+'].push(video);
    }

    return groups;
  }

  private analyzePunctuation(videos: any[]): DiscoveredPattern[] {
    const patterns: DiscoveredPattern[] = [];
    
    const punctuationTypes = [
      { name: 'Question marks', regex: /\?/, type: 'questions' },
      { name: 'Exclamation marks', regex: /!/, type: 'exclamations' },
      { name: 'Colons', regex: /:/, type: 'colons' },
      { name: 'Numbers', regex: /\d+/, type: 'numbers' }
    ];

    for (const punct of punctuationTypes) {
      const withPunct = videos.filter(v => punct.regex.test(v.title));
      const withoutPunct = videos.filter(v => !punct.regex.test(v.title));

      if (withPunct.length >= 20 && withoutPunct.length >= 20) {
        const withStats = this.calculatePerformanceStats(withPunct);
        const withoutStats = this.calculatePerformanceStats(withoutPunct);
        
        if (withStats.avg > withoutStats.avg * 1.3) {
          patterns.push({
            pattern_type: 'title_structure',
            pattern_data: {
              name: `${punct.name} boost performance`,
              punctuation_type: punct.type,
              performance_lift: withStats.avg / withoutStats.avg,
              discovery_method: 'punctuation_analysis',
              evidence_count: withPunct.length,
              confidence: Math.min(withStats.avg / 2.0, 1.0)
            },
            performance_stats: withStats,
            videos_analyzed: withPunct.map(v => v.id),
            confidence: Math.min(withStats.avg / 2.0, 1.0),
            evidence_count: withPunct.length
          });
        }
      }
    }

    return patterns;
  }
}

/**
 * Format Outlier Analyzer - finds formats that overperform in specific contexts
 */
class FormatOutlierAnalyzer extends PatternAnalyzer {
  async discover(videos: any[], context: PatternAnalysisContext): Promise<DiscoveredPattern[]> {
    const patterns: DiscoveredPattern[] = [];

    // Group videos by format
    const formatGroups = this.groupByFormat(videos);
    
    // Calculate overall format baseline
    const overallBaseline = this.calculateOverallBaseline(videos);

    for (const [format, videoGroup] of Object.entries(formatGroups)) {
      if (videoGroup.length >= 15) {
        const formatStats = this.calculatePerformanceStats(videoGroup);
        const lift = formatStats.avg / overallBaseline.avg;

        if (lift > 1.5) { // 50% better than average
          patterns.push({
            pattern_type: 'format',
            pattern_data: {
              name: `${format} format dominance`,
              format,
              context: context.topic_cluster || 'general',
              performance_lift: lift,
              discovery_method: 'format_outlier',
              evidence_count: videoGroup.length,
              confidence: Math.min(lift / 2.0, 1.0)
            },
            performance_stats: formatStats,
            videos_analyzed: videoGroup.map(v => v.id),
            confidence: Math.min(lift / 2.0, 1.0),
            evidence_count: videoGroup.length
          });
        }
      }
    }

    return patterns;
  }

  private groupByFormat(videos: any[]): Record<string, any[]> {
    const groups: Record<string, any[]> = {};

    for (const video of videos) {
      const format = video.format_type || 'unknown';
      if (!groups[format]) {
        groups[format] = [];
      }
      groups[format].push(video);
    }

    return groups;
  }

  private calculateOverallBaseline(videos: any[]): any {
    return this.calculatePerformanceStats(videos);
  }
}

/**
 * Duration Pattern Analyzer - finds optimal video lengths
 */
class DurationPatternAnalyzer extends PatternAnalyzer {
  async discover(videos: any[], context: PatternAnalysisContext): Promise<DiscoveredPattern[]> {
    const patterns: DiscoveredPattern[] = [];

    // Group videos by duration buckets
    const durationGroups = this.groupByDuration(videos);

    for (const [range, videoGroup] of Object.entries(durationGroups)) {
      if (videoGroup.length >= 20) {
        const performanceStats = this.calculatePerformanceStats(videoGroup);
        
        if (performanceStats.avg > 1.8) {
          patterns.push({
            pattern_type: 'duration',
            pattern_data: {
              name: `${range} optimal duration`,
              duration_range: range,
              context: context.topic_cluster || 'general',
              discovery_method: 'duration_analysis',
              evidence_count: videoGroup.length,
              confidence: Math.min(performanceStats.avg / 2.0, 1.0)
            },
            performance_stats: performanceStats,
            videos_analyzed: videoGroup.map(v => v.id),
            confidence: Math.min(performanceStats.avg / 2.0, 1.0),
            evidence_count: videoGroup.length
          });
        }
      }
    }

    return patterns;
  }

  private groupByDuration(videos: any[]): Record<string, any[]> {
    const groups: Record<string, any[]> = {
      '1-5min': [],
      '5-10min': [],
      '10-15min': [],
      '15-25min': [],
      '25min+': []
    };

    for (const video of videos) {
      const minutes = this.parseDurationToMinutes(video.duration);
      
      if (minutes <= 5) groups['1-5min'].push(video);
      else if (minutes <= 10) groups['5-10min'].push(video);
      else if (minutes <= 15) groups['10-15min'].push(video);
      else if (minutes <= 25) groups['15-25min'].push(video);
      else groups['25min+'].push(video);
    }

    return groups;
  }

  private parseDurationToMinutes(duration: string): number {
    // Parse ISO 8601 duration format (PT1H2M3S)
    const match = duration.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
    if (!match) return 0;

    const hours = parseInt(match[1] || '0');
    const minutes = parseInt(match[2] || '0');
    const seconds = parseInt(match[3] || '0');

    return hours * 60 + minutes + seconds / 60;
  }
}

/**
 * Timing Pattern Analyzer - finds optimal publishing times
 */
class TimingPatternAnalyzer extends PatternAnalyzer {
  async discover(videos: any[], context: PatternAnalysisContext): Promise<DiscoveredPattern[]> {
    const patterns: DiscoveredPattern[] = [];

    // Day of week analysis
    const dayGroups = this.groupByDayOfWeek(videos);
    
    for (const [day, videoGroup] of Object.entries(dayGroups)) {
      if (videoGroup.length >= 15) {
        const performanceStats = this.calculatePerformanceStats(videoGroup);
        
        if (performanceStats.avg > 1.5) {
          patterns.push({
            pattern_type: 'timing',
            pattern_data: {
              name: `${day} publishing advantage`,
              day_of_week: day,
              context: context.topic_cluster || 'general',
              discovery_method: 'timing_analysis',
              evidence_count: videoGroup.length,
              confidence: Math.min(performanceStats.avg / 2.0, 1.0)
            },
            performance_stats: performanceStats,
            videos_analyzed: videoGroup.map(v => v.id),
            confidence: Math.min(performanceStats.avg / 2.0, 1.0),
            evidence_count: videoGroup.length
          });
        }
      }
    }

    return patterns;
  }

  private groupByDayOfWeek(videos: any[]): Record<string, any[]> {
    const groups: Record<string, any[]> = {
      'Monday': [],
      'Tuesday': [],
      'Wednesday': [],
      'Thursday': [],
      'Friday': [],
      'Saturday': [],
      'Sunday': []
    };

    const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

    for (const video of videos) {
      const date = new Date(video.published_at);
      const dayName = dayNames[date.getDay()];
      groups[dayName].push(video);
    }

    return groups;
  }
}

/**
 * Topic Cluster Analyzer - analyzes patterns within topic clusters
 */
class TopicClusterAnalyzer extends PatternAnalyzer {
  async discover(videos: any[], context: PatternAnalysisContext): Promise<DiscoveredPattern[]> {
    const patterns: DiscoveredPattern[] = [];

    // Group videos by topic cluster
    const topicGroups = this.groupByTopicCluster(videos);

    for (const [topic, videoGroup] of Object.entries(topicGroups)) {
      if (videoGroup.length >= 30) {
        const performanceStats = this.calculatePerformanceStats(videoGroup);
        
        // Find dominant formats in this topic
        const formatDistribution = this.getFormatDistribution(videoGroup);
        
        patterns.push({
          pattern_type: 'topic_cluster',
          pattern_data: {
            name: `${topic} topic insights`,
            topic_cluster_id: topic,
            dominant_formats: formatDistribution.slice(0, 3),
            avg_performance: performanceStats.avg,
            discovery_method: 'topic_cluster_analysis',
            evidence_count: videoGroup.length,
            confidence: Math.min(performanceStats.avg / 2.0, 1.0)
          },
          performance_stats: performanceStats,
          videos_analyzed: videoGroup.map(v => v.id),
          confidence: Math.min(performanceStats.avg / 2.0, 1.0),
          evidence_count: videoGroup.length
        });
      }
    }

    return patterns;
  }

  private groupByTopicCluster(videos: any[]): Record<string, any[]> {
    const groups: Record<string, any[]> = {};

    for (const video of videos) {
      const topic = video.topic_cluster || 'uncategorized';
      if (!groups[topic]) {
        groups[topic] = [];
      }
      groups[topic].push(video);
    }

    return groups;
  }

  private getFormatDistribution(videos: any[]): Array<{format: string, count: number, avg_performance: number}> {
    const formatStats: Record<string, {count: number, totalPerformance: number}> = {};

    for (const video of videos) {
      const format = video.format_type || 'unknown';
      const baseline = video.rolling_baseline_views || video.channel_avg_views || 1;
      const performance = video.view_count / baseline;

      if (!formatStats[format]) {
        formatStats[format] = {count: 0, totalPerformance: 0};
      }

      formatStats[format].count++;
      formatStats[format].totalPerformance += performance;
    }

    return Object.entries(formatStats)
      .map(([format, stats]) => ({
        format,
        count: stats.count,
        avg_performance: stats.totalPerformance / stats.count
      }))
      .sort((a, b) => b.avg_performance - a.avg_performance);
  }
}