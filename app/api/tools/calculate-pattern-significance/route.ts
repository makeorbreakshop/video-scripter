/**
 * API endpoint for calculate_pattern_significance tool
 * Groups videos by semantic clusters and validates if patterns are statistically significant
 * Uses Pinecone embeddings to identify semantic patterns
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { Pinecone } from '@pinecone-database/pinecone';
import { ToolResponse } from '@/types/tools';
import { wrapTool, createToolContext } from '@/lib/tools/base-wrapper';

// Initialize clients
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const pinecone = new Pinecone({
  apiKey: process.env.PINECONE_API_KEY!
});

interface PatternSignificanceParams {
  video_ids: string[];
  similarity_threshold?: number;
  min_cluster_size?: number;
  control_sample_size?: number;
  confidence_level?: number;
}

interface SemanticCluster {
  cluster_id: number;
  centroid_video_id: string;
  video_ids: string[];
  avg_similarity: number;
  avg_tps: number;
  std_tps: number;
  size: number;
}

interface PatternSignificanceResponse {
  total_videos: number;
  semantic_clusters: SemanticCluster[];
  statistical_analysis: {
    within_cluster_variance: number;
    between_cluster_variance: number;
    f_statistic: number;
    p_value: number;
    is_significant: boolean;
    confidence_level: number;
  };
  performance_patterns: {
    high_performing_clusters: SemanticCluster[];
    low_performing_clusters: SemanticCluster[];
    consistent_clusters: SemanticCluster[]; // Low variance
    volatile_clusters: SemanticCluster[];   // High variance
  };
  control_comparison: {
    pattern_avg_tps: number;
    control_avg_tps: number;
    effect_size: number;
    cohen_d: number;
  } | null;
  insights: string[];
}

/**
 * Fetch embeddings from Pinecone for video IDs
 */
async function fetchEmbeddings(videoIds: string[]): Promise<Map<string, number[]>> {
  const index = pinecone.index(process.env.PINECONE_INDEX_NAME!);
  const embeddings = new Map<string, number[]>();
  
  // Batch fetch in chunks of 100
  const chunks = [];
  for (let i = 0; i < videoIds.length; i += 100) {
    chunks.push(videoIds.slice(i, i + 100));
  }
  
  for (const chunk of chunks) {
    try {
      const response = await index.fetch(chunk);
      
      for (const [id, data] of Object.entries(response.records)) {
        if (data?.values) {
          embeddings.set(id, data.values);
        }
      }
    } catch (error) {
      console.error('Error fetching embeddings for chunk:', error);
    }
  }
  
  return embeddings;
}

/**
 * Calculate cosine similarity between two vectors
 */
function cosineSimilarity(vec1: number[], vec2: number[]): number {
  let dotProduct = 0;
  let norm1 = 0;
  let norm2 = 0;
  
  for (let i = 0; i < vec1.length; i++) {
    dotProduct += vec1[i] * vec2[i];
    norm1 += vec1[i] * vec1[i];
    norm2 += vec2[i] * vec2[i];
  }
  
  return dotProduct / (Math.sqrt(norm1) * Math.sqrt(norm2));
}

/**
 * Cluster videos by semantic similarity
 */
function clusterBySimilarity(
  embeddings: Map<string, number[]>,
  threshold: number
): Map<number, Set<string>> {
  const clusters = new Map<number, Set<string>>();
  const assigned = new Set<string>();
  let clusterId = 0;
  
  const videoIds = Array.from(embeddings.keys());
  
  for (const videoId of videoIds) {
    if (assigned.has(videoId)) continue;
    
    const cluster = new Set<string>([videoId]);
    assigned.add(videoId);
    
    const embedding = embeddings.get(videoId)!;
    
    // Find all similar videos
    for (const otherId of videoIds) {
      if (assigned.has(otherId)) continue;
      
      const otherEmbedding = embeddings.get(otherId);
      if (!otherEmbedding) continue;
      
      const similarity = cosineSimilarity(embedding, otherEmbedding);
      if (similarity >= threshold) {
        cluster.add(otherId);
        assigned.add(otherId);
      }
    }
    
    clusters.set(clusterId++, cluster);
  }
  
  return clusters;
}

/**
 * Calculate F-statistic for ANOVA
 */
function calculateFStatistic(clusters: SemanticCluster[]): {
  withinVariance: number;
  betweenVariance: number;
  fStatistic: number;
  pValue: number;
} {
  // Calculate overall mean
  let totalSum = 0;
  let totalCount = 0;
  for (const cluster of clusters) {
    totalSum += cluster.avg_tps * cluster.size;
    totalCount += cluster.size;
  }
  const grandMean = totalSum / totalCount;
  
  // Calculate between-group variance (MSB)
  let ssb = 0;
  for (const cluster of clusters) {
    ssb += cluster.size * Math.pow(cluster.avg_tps - grandMean, 2);
  }
  const dfb = clusters.length - 1;
  const msb = ssb / dfb;
  
  // Calculate within-group variance (MSW)
  let ssw = 0;
  for (const cluster of clusters) {
    ssw += (cluster.size - 1) * Math.pow(cluster.std_tps, 2);
  }
  const dfw = totalCount - clusters.length;
  const msw = ssw / dfw;
  
  // Calculate F-statistic
  const fStatistic = msb / msw;
  
  // Approximate p-value using F-distribution
  // Simplified calculation - in production use a proper stats library
  const pValue = Math.exp(-fStatistic / 2);
  
  return {
    withinVariance: msw,
    betweenVariance: msb,
    fStatistic,
    pValue: Math.min(pValue, 1)
  };
}

/**
 * Calculate Cohen's d effect size
 */
function calculateCohenD(mean1: number, mean2: number, std1: number, std2: number, n1: number, n2: number): number {
  const pooledStd = Math.sqrt(((n1 - 1) * std1 * std1 + (n2 - 1) * std2 * std2) / (n1 + n2 - 2));
  return Math.abs(mean1 - mean2) / pooledStd;
}

/**
 * Calculate pattern significance
 */
async function calculatePatternSignificanceHandler(
  params: PatternSignificanceParams,
  context?: any
): Promise<ToolResponse<PatternSignificanceResponse>> {
  const {
    video_ids,
    similarity_threshold = 0.7,
    min_cluster_size = 3,
    control_sample_size = 100,
    confidence_level = 0.95
  } = params;
  
  // Validate inputs
  if (!video_ids || video_ids.length === 0) {
    return {
      success: false,
      error: {
        code: 'INVALID_PARAMS',
        message: 'video_ids array is required and cannot be empty'
      }
    };
  }
  
  try {
    // Fetch video performance data
    const { data: videos, error: videoError } = await supabase
      .from('videos')
      .select('id, temporal_performance_score, title, channel_id')
      .in('id', video_ids);
    
    if (videoError || !videos) {
      throw new Error(`Failed to fetch videos: ${videoError?.message}`);
    }
    
    // Fetch embeddings from Pinecone
    const embeddings = await fetchEmbeddings(video_ids);
    
    if (embeddings.size === 0) {
      return {
        success: false,
        error: {
          code: 'NO_EMBEDDINGS',
          message: 'No embeddings found for provided video IDs'
        }
      };
    }
    
    // Cluster videos by semantic similarity
    const clusterMap = clusterBySimilarity(embeddings, similarity_threshold);
    
    // Build semantic clusters with performance metrics
    const semanticClusters: SemanticCluster[] = [];
    
    for (const [clusterId, videoSet] of clusterMap.entries()) {
      if (videoSet.size < min_cluster_size) continue;
      
      const clusterVideos = videos.filter(v => videoSet.has(v.id) && v.temporal_performance_score !== null);
      if (clusterVideos.length === 0) continue;
      
      const tpsValues = clusterVideos.map(v => v.temporal_performance_score!);
      const avgTps = tpsValues.reduce((sum, v) => sum + v, 0) / tpsValues.length;
      
      // Calculate standard deviation
      const variance = tpsValues.reduce((sum, v) => sum + Math.pow(v - avgTps, 2), 0) / tpsValues.length;
      const stdTps = Math.sqrt(variance);
      
      // Calculate average similarity within cluster
      const clusterEmbeddings = Array.from(videoSet)
        .map(id => embeddings.get(id))
        .filter((e): e is number[] => e !== undefined);
      
      let totalSimilarity = 0;
      let comparisons = 0;
      for (let i = 0; i < clusterEmbeddings.length; i++) {
        for (let j = i + 1; j < clusterEmbeddings.length; j++) {
          totalSimilarity += cosineSimilarity(clusterEmbeddings[i], clusterEmbeddings[j]);
          comparisons++;
        }
      }
      
      semanticClusters.push({
        cluster_id: clusterId,
        centroid_video_id: Array.from(videoSet)[0], // First video as representative
        video_ids: Array.from(videoSet),
        avg_similarity: comparisons > 0 ? totalSimilarity / comparisons : 1,
        avg_tps: avgTps,
        std_tps: stdTps,
        size: videoSet.size
      });
    }
    
    // Sort clusters by average TPS
    semanticClusters.sort((a, b) => b.avg_tps - a.avg_tps);
    
    // Calculate statistical significance
    const stats = semanticClusters.length > 1 
      ? calculateFStatistic(semanticClusters)
      : { withinVariance: 0, betweenVariance: 0, fStatistic: 0, pValue: 1 };
    
    // Determine significance based on p-value
    const alpha = 1 - confidence_level;
    const isSignificant = stats.pValue < alpha;
    
    // Categorize clusters by performance
    const avgOverallTps = semanticClusters.reduce((sum, c) => sum + c.avg_tps * c.size, 0) / 
                          semanticClusters.reduce((sum, c) => sum + c.size, 0);
    
    const performancePatterns = {
      high_performing_clusters: semanticClusters.filter(c => c.avg_tps > avgOverallTps * 1.5),
      low_performing_clusters: semanticClusters.filter(c => c.avg_tps < avgOverallTps * 0.5),
      consistent_clusters: semanticClusters.filter(c => c.std_tps < 0.5),
      volatile_clusters: semanticClusters.filter(c => c.std_tps > 1.5)
    };
    
    // Fetch control sample if requested
    let controlComparison = null;
    if (control_sample_size > 0) {
      const { data: controlVideos, error: controlError } = await supabase
        .from('videos')
        .select('temporal_performance_score')
        .not('id', 'in', `(${video_ids.join(',')})`)
        .not('temporal_performance_score', 'is', null)
        .eq('is_short', false)
        .limit(control_sample_size);
      
      if (!controlError && controlVideos && controlVideos.length > 0) {
        const controlTps = controlVideos.map(v => v.temporal_performance_score!);
        const controlAvg = controlTps.reduce((sum, v) => sum + v, 0) / controlTps.length;
        const controlStd = Math.sqrt(
          controlTps.reduce((sum, v) => sum + Math.pow(v - controlAvg, 2), 0) / controlTps.length
        );
        
        const patternAvg = avgOverallTps;
        const patternStd = Math.sqrt(
          semanticClusters.reduce((sum, c) => sum + c.std_tps * c.std_tps * c.size, 0) /
          semanticClusters.reduce((sum, c) => sum + c.size, 0)
        );
        
        controlComparison = {
          pattern_avg_tps: patternAvg,
          control_avg_tps: controlAvg,
          effect_size: patternAvg - controlAvg,
          cohen_d: calculateCohenD(
            patternAvg, controlAvg,
            patternStd, controlStd,
            video_ids.length, controlTps.length
          )
        };
      }
    }
    
    // Generate insights
    const insights: string[] = [];
    
    if (isSignificant) {
      insights.push(`Semantic patterns show statistically significant performance differences (p=${stats.pValue.toFixed(4)})`);
    } else {
      insights.push(`No statistically significant pattern found (p=${stats.pValue.toFixed(4)})`);
    }
    
    if (performancePatterns.high_performing_clusters.length > 0) {
      insights.push(`Found ${performancePatterns.high_performing_clusters.length} high-performing semantic clusters`);
    }
    
    if (performancePatterns.consistent_clusters.length > 0) {
      insights.push(`${performancePatterns.consistent_clusters.length} clusters show consistent performance (low variance)`);
    }
    
    if (controlComparison && Math.abs(controlComparison.cohen_d) > 0.8) {
      insights.push(`Large effect size detected vs control (Cohen's d=${controlComparison.cohen_d.toFixed(2)})`);
    }
    
    const response: PatternSignificanceResponse = {
      total_videos: video_ids.length,
      semantic_clusters: semanticClusters,
      statistical_analysis: {
        within_cluster_variance: stats.withinVariance,
        between_cluster_variance: stats.betweenVariance,
        f_statistic: stats.fStatistic,
        p_value: stats.pValue,
        is_significant: isSignificant,
        confidence_level
      },
      performance_patterns: performancePatterns,
      control_comparison: controlComparison,
      insights
    };
    
    return {
      success: true,
      data: response
    };
    
  } catch (error: any) {
    console.error('Error calculating pattern significance:', error);
    return {
      success: false,
      error: {
        code: 'CALCULATION_ERROR',
        message: 'Failed to calculate pattern significance',
        details: error.message,
        retryable: true
      }
    };
  }
}

// Wrap handler with caching and retry logic
const wrappedHandler = wrapTool({
  name: 'calculate_pattern_significance',
  description: 'Validate if semantic patterns have statistically significant performance',
  parameters: {
    type: 'object',
    properties: {
      video_ids: {
        type: 'array',
        items: { type: 'string' },
        description: 'Array of video IDs to analyze for patterns'
      },
      similarity_threshold: {
        type: 'number',
        description: 'Cosine similarity threshold for clustering (0-1)',
        default: 0.7
      },
      min_cluster_size: {
        type: 'number',
        description: 'Minimum videos per cluster',
        default: 3
      },
      control_sample_size: {
        type: 'number',
        description: 'Size of control sample for comparison',
        default: 100
      },
      confidence_level: {
        type: 'number',
        description: 'Statistical confidence level (e.g., 0.95)',
        default: 0.95
      }
    },
    required: ['video_ids']
  },
  handler: calculatePatternSignificanceHandler,
  parallelSafe: false, // Don't run in parallel due to Pinecone rate limits
  cacheTTL: 600, // Cache for 10 minutes
  timeout: 15000, // Longer timeout for complex calculations
  retryConfig: {
    maxRetries: 2,
    backoffMs: 2000
  }
});

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const context = createToolContext({
      requestId: request.headers.get('x-request-id') || undefined,
      mode: request.headers.get('x-analysis-mode') as 'classic' | 'agentic' || 'agentic'
    });

    const result = await wrappedHandler(body, context);
    
    return NextResponse.json(result, {
      status: result.success ? 200 : 400,
      headers: {
        'x-request-id': context.requestId || '',
        'x-cache-status': result.metadata?.cached ? 'hit' : 'miss',
        'x-execution-time': String(result.metadata?.executionTime || 0)
      }
    });
  } catch (error: any) {
    console.error('API error:', error);
    return NextResponse.json(
      {
        success: false,
        error: {
          code: 'API_ERROR',
          message: error.message || 'Internal server error'
        }
      },
      { status: 500 }
    );
  }
}

// Export for testing
export { calculatePatternSignificanceHandler, cosineSimilarity, calculateFStatistic };