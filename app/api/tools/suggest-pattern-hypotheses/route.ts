/**
 * API endpoint for suggest_pattern_hypotheses tool
 * Discovers patterns using embeddings across channels, topics, and formats
 * Generates testable hypotheses based on semantic clustering
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

interface PatternHypothesesParams {
  seed_video_ids?: string[];
  channel_id?: string;
  min_tps_threshold?: number;
  search_across_channels?: boolean;
  max_hypotheses?: number;
  include_visual_patterns?: boolean;
  include_temporal_patterns?: boolean;
}

interface PatternHypothesis {
  hypothesis_id: string;
  hypothesis_statement: string;
  pattern_type: 'semantic' | 'visual' | 'temporal' | 'composite';
  confidence_score: number; // 0-100
  evidence: {
    supporting_videos: Array<{
      video_id: string;
      title: string;
      tps: number;
      channel_name: string;
      similarity_to_pattern: number;
    }>;
    avg_tps_in_pattern: number;
    std_dev_tps: number;
    cross_channel_validation: boolean;
    cross_topic_validation: boolean;
  };
  semantic_signature: {
    key_dimensions: number[];
    centroid_stability: number;
    dispersion: number;
  };
  testable_predictions: string[];
  recommended_experiments: string[];
}

interface SemanticPattern {
  centroid: number[];
  member_videos: string[];
  avg_tps: number;
  variance: number;
  cross_channel: boolean;
  cross_topic: boolean;
}

interface PatternHypothesesResponse {
  analysis_scope: {
    total_videos_analyzed: number;
    channels_covered: number;
    topics_covered: number;
    tps_range: [number, number];
  };
  discovered_hypotheses: PatternHypothesis[];
  meta_patterns: {
    strongest_pattern_type: string;
    cross_boundary_patterns: number;
    novel_patterns: number;
  };
  validation_metrics: {
    avg_confidence: number;
    statistical_significance: boolean;
    replication_potential: 'low' | 'medium' | 'high';
  };
}

/**
 * Calculate cosine similarity
 */
function cosineSimilarity(a: number[], b: number[]): number {
  if (!a || !b || a.length !== b.length) return 0;
  
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;
  
  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  
  if (normA === 0 || normB === 0) return 0;
  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}

/**
 * Cluster videos by embedding similarity
 */
function clusterByEmbeddings(
  embeddings: Map<string, number[]>,
  minClusterSize: number = 3,
  similarityThreshold: number = 0.65
): SemanticPattern[] {
  const patterns: SemanticPattern[] = [];
  const processed = new Set<string>();
  
  for (const [videoId, embedding] of embeddings) {
    if (processed.has(videoId)) continue;
    
    const cluster: string[] = [videoId];
    processed.add(videoId);
    
    // Find all similar videos
    for (const [otherId, otherEmbedding] of embeddings) {
      if (processed.has(otherId)) continue;
      
      const similarity = cosineSimilarity(embedding, otherEmbedding);
      if (similarity >= similarityThreshold) {
        cluster.push(otherId);
        processed.add(otherId);
      }
    }
    
    if (cluster.length >= minClusterSize) {
      // Calculate centroid
      const centroid = new Array(embedding.length).fill(0);
      cluster.forEach(id => {
        const emb = embeddings.get(id)!;
        emb.forEach((val, i) => {
          centroid[i] += val / cluster.length;
        });
      });
      
      patterns.push({
        centroid,
        member_videos: cluster,
        avg_tps: 0, // Will be filled later
        variance: 0, // Will be filled later
        cross_channel: false, // Will be determined later
        cross_topic: false // Will be determined later
      });
    }
  }
  
  return patterns;
}

/**
 * Identify key dimensions that differentiate high performers
 */
function identifyKeyDimensions(
  embeddings: Map<string, number[]>,
  tpsMap: Map<string, number>
): number[] {
  const dimensionCount = embeddings.values().next().value?.length || 512;
  const dimensionScores: Array<{ index: number; correlation: number }> = [];
  
  for (let dim = 0; dim < Math.min(dimensionCount, 50); dim++) {
    const dimValues: number[] = [];
    const tpsValues: number[] = [];
    
    for (const [videoId, embedding] of embeddings) {
      const tps = tpsMap.get(videoId);
      if (tps !== undefined) {
        dimValues.push(embedding[dim]);
        tpsValues.push(tps);
      }
    }
    
    if (dimValues.length < 10) continue;
    
    // Calculate correlation
    const meanDim = dimValues.reduce((a, b) => a + b, 0) / dimValues.length;
    const meanTps = tpsValues.reduce((a, b) => a + b, 0) / tpsValues.length;
    
    let numerator = 0;
    let denomDim = 0;
    let denomTps = 0;
    
    for (let i = 0; i < dimValues.length; i++) {
      const diffDim = dimValues[i] - meanDim;
      const diffTps = tpsValues[i] - meanTps;
      numerator += diffDim * diffTps;
      denomDim += diffDim * diffDim;
      denomTps += diffTps * diffTps;
    }
    
    const correlation = denomDim > 0 && denomTps > 0 ? 
      numerator / (Math.sqrt(denomDim) * Math.sqrt(denomTps)) : 0;
    
    if (Math.abs(correlation) > 0.1) {
      dimensionScores.push({ index: dim, correlation: Math.abs(correlation) });
    }
  }
  
  // Return top 10 most correlated dimensions
  return dimensionScores
    .sort((a, b) => b.correlation - a.correlation)
    .slice(0, 10)
    .map(d => d.index);
}

/**
 * Generate hypothesis statement based on pattern characteristics
 */
function generateHypothesisStatement(
  pattern: SemanticPattern,
  videoData: Map<string, any>,
  keyDimensions: number[]
): string {
  const videos = pattern.member_videos.map(id => videoData.get(id)).filter(v => v);
  
  // Analyze common characteristics
  const formats = new Map<string, number>();
  const topics = new Map<string, number>();
  
  videos.forEach(v => {
    if (v.format_type) {
      formats.set(v.format_type, (formats.get(v.format_type) || 0) + 1);
    }
    if (v.topic_niche) {
      topics.set(v.topic_niche, (topics.get(v.topic_niche) || 0) + 1);
    }
  });
  
  const dominantFormat = Array.from(formats.entries()).sort((a, b) => b[1] - a[1])[0];
  const dominantTopic = Array.from(topics.entries()).sort((a, b) => b[1] - a[1])[0];
  
  if (pattern.cross_channel && pattern.cross_topic) {
    return `Cross-channel semantic pattern with ${pattern.avg_tps.toFixed(1)}x baseline performance spans multiple topics, suggesting universal engagement trigger in embedding dimensions [${keyDimensions.slice(0, 3).join(', ')}]`;
  } else if (pattern.cross_channel && dominantFormat) {
    return `"${dominantFormat[0]}" format achieves ${pattern.avg_tps.toFixed(1)}x performance across channels when following semantic pattern in dimensions [${keyDimensions.slice(0, 3).join(', ')}]`;
  } else if (pattern.cross_topic && videos.length > 5) {
    return `Semantic cluster with ${videos.length} videos averaging ${pattern.avg_tps.toFixed(1)} TPS transcends topic boundaries, indicating content structure pattern`;
  } else if (dominantTopic && dominantFormat) {
    return `"${dominantTopic[0]}" content in "${dominantFormat[0]}" format shows ${pattern.avg_tps.toFixed(1)}x performance when matching semantic signature`;
  } else {
    return `Discovered semantic pattern with ${videos.length} videos achieving ${pattern.avg_tps.toFixed(1)} avg TPS through embedding similarity`;
  }
}

/**
 * Suggest pattern hypotheses
 */
async function suggestPatternHypothesesHandler(
  params: PatternHypothesesParams,
  context?: any
): Promise<ToolResponse<PatternHypothesesResponse>> {
  const {
    seed_video_ids = [],
    channel_id,
    min_tps_threshold = 2.0,
    search_across_channels = true,
    max_hypotheses = 5,
    include_visual_patterns = true,
    include_temporal_patterns = true
  } = params;
  
  try {
    // Build initial video set
    let videoQuery = supabase
      .from('videos')
      .select('*')
      .gte('temporal_performance_score', min_tps_threshold)
      .not('temporal_performance_score', 'is', null)
      .eq('is_short', false);
    
    if (seed_video_ids.length > 0) {
      // Start with seed videos and find similar ones
      videoQuery = videoQuery.or(`id.in.(${seed_video_ids.join(',')})`);
    } else if (channel_id && !search_across_channels) {
      videoQuery = videoQuery.eq('channel_id', channel_id);
    }
    
    // Limit to recent high performers if no specific seeds
    if (seed_video_ids.length === 0) {
      videoQuery = videoQuery
        .order('temporal_performance_score', { ascending: false })
        .limit(200);
    }
    
    const { data: videos, error: videoError } = await videoQuery;
    
    if (videoError || !videos || videos.length < 10) {
      return {
        success: false,
        error: {
          code: 'INSUFFICIENT_DATA',
          message: 'Not enough videos to generate pattern hypotheses'
        }
      };
    }
    
    // Create maps for quick lookup
    const videoDataMap = new Map(videos.map(v => [v.id, v]));
    const tpsMap = new Map(videos.map(v => [v.id, v.temporal_performance_score!]));
    
    // Fetch embeddings from Pinecone
    const titleIndex = pinecone.index(process.env.PINECONE_INDEX_NAME!);
    const videoIds = videos.map(v => v.id);
    
    // Batch fetch embeddings
    const embeddings = new Map<string, number[]>();
    for (let i = 0; i < videoIds.length; i += 100) {
      const batch = videoIds.slice(i, i + 100);
      const response = await titleIndex.fetch(batch);
      
      Object.entries(response.records).forEach(([id, record]) => {
        if (record.values) {
          embeddings.set(id, record.values);
        }
      });
    }
    
    if (embeddings.size < 10) {
      return {
        success: false,
        error: {
          code: 'INSUFFICIENT_EMBEDDINGS',
          message: 'Not enough embeddings found for pattern discovery'
        }
      };
    }
    
    // Discover semantic patterns
    const semanticPatterns = clusterByEmbeddings(embeddings, 3, 0.65);
    
    // Enrich patterns with performance data
    semanticPatterns.forEach(pattern => {
      const tpsValues = pattern.member_videos
        .map(id => tpsMap.get(id))
        .filter((tps): tps is number => tps !== undefined);
      
      pattern.avg_tps = tpsValues.reduce((a, b) => a + b, 0) / tpsValues.length;
      pattern.variance = tpsValues.reduce((sum, tps) => sum + Math.pow(tps - pattern.avg_tps, 2), 0) / tpsValues.length;
      
      // Check if cross-channel
      const channels = new Set(pattern.member_videos.map(id => videoDataMap.get(id)?.channel_id).filter(c => c));
      pattern.cross_channel = channels.size > 1;
      
      // Check if cross-topic
      const topics = new Set(pattern.member_videos.map(id => videoDataMap.get(id)?.topic_niche).filter(t => t));
      pattern.cross_topic = topics.size > 2;
    });
    
    // Sort patterns by average TPS
    semanticPatterns.sort((a, b) => b.avg_tps - a.avg_tps);
    
    // Identify key dimensions
    const keyDimensions = identifyKeyDimensions(embeddings, tpsMap);
    
    // Generate hypotheses
    const hypotheses: PatternHypothesis[] = [];
    
    for (const pattern of semanticPatterns.slice(0, max_hypotheses)) {
      // Calculate centroid stability (how tight the cluster is)
      let totalDistance = 0;
      let distanceCount = 0;
      
      pattern.member_videos.forEach(id => {
        const embedding = embeddings.get(id);
        if (embedding) {
          const distance = 1 - cosineSimilarity(embedding, pattern.centroid);
          totalDistance += distance;
          distanceCount++;
        }
      });
      
      const dispersion = distanceCount > 0 ? totalDistance / distanceCount : 1;
      const centroidStability = 1 - dispersion;
      
      // Build evidence
      const supportingVideos = pattern.member_videos
        .slice(0, 10)
        .map(id => {
          const video = videoDataMap.get(id);
          const embedding = embeddings.get(id);
          return video && embedding ? {
            video_id: id,
            title: video.title,
            tps: video.temporal_performance_score!,
            channel_name: video.channel_name,
            similarity_to_pattern: cosineSimilarity(embedding, pattern.centroid)
          } : null;
        })
        .filter((v): v is any => v !== null)
        .sort((a, b) => b.tps - a.tps);
      
      // Generate hypothesis
      const hypothesis: PatternHypothesis = {
        hypothesis_id: `hyp_${hypotheses.length + 1}`,
        hypothesis_statement: generateHypothesisStatement(pattern, videoDataMap, keyDimensions),
        pattern_type: 'semantic',
        confidence_score: Math.min(100, 
          30 * (pattern.avg_tps / 2) + // Performance factor
          20 * centroidStability + // Cluster tightness
          15 * (pattern.cross_channel ? 1 : 0.5) + // Cross-channel validation
          15 * (pattern.cross_topic ? 1 : 0.5) + // Cross-topic validation
          20 * Math.min(1, pattern.member_videos.length / 10) // Sample size
        ),
        evidence: {
          supporting_videos: supportingVideos,
          avg_tps_in_pattern: pattern.avg_tps,
          std_dev_tps: Math.sqrt(pattern.variance),
          cross_channel_validation: pattern.cross_channel,
          cross_topic_validation: pattern.cross_topic
        },
        semantic_signature: {
          key_dimensions: keyDimensions.slice(0, 5),
          centroid_stability: centroidStability,
          dispersion: dispersion
        },
        testable_predictions: [
          `New videos matching this semantic pattern should achieve ${(pattern.avg_tps * 0.8).toFixed(1)}-${(pattern.avg_tps * 1.2).toFixed(1)} TPS`,
          `Pattern should remain valid across different publication times`,
          pattern.cross_channel ? 'Pattern should work for new channels in similar niches' : 'Pattern is channel-specific',
          `Deviating from key dimensions [${keyDimensions.slice(0, 3).join(', ')}] should reduce performance`
        ],
        recommended_experiments: [
          'Create content explicitly matching this semantic signature',
          'A/B test titles optimized for key embedding dimensions',
          pattern.cross_topic ? 'Test pattern in unexplored topic areas' : 'Test pattern variations within topic',
          'Analyze temporal stability by tracking pattern performance over time'
        ]
      };
      
      hypotheses.push(hypothesis);
    }
    
    // Add visual pattern hypotheses if requested
    if (include_visual_patterns && hypotheses.length < max_hypotheses) {
      const thumbnailIndex = pinecone.index(process.env.PINECONE_THUMBNAIL_INDEX_NAME!);
      const visualEmbeddings = new Map<string, number[]>();
      
      // Fetch thumbnail embeddings for top performers
      const topPerformers = videos
        .sort((a, b) => b.temporal_performance_score! - a.temporal_performance_score!)
        .slice(0, 50)
        .map(v => v.id);
      
      const visualResponse = await thumbnailIndex.fetch(topPerformers);
      Object.entries(visualResponse.records).forEach(([id, record]) => {
        if (record.values) {
          visualEmbeddings.set(id, record.values);
        }
      });
      
      if (visualEmbeddings.size >= 10) {
        const visualPatterns = clusterByEmbeddings(visualEmbeddings, 3, 0.7);
        
        if (visualPatterns.length > 0) {
          const topVisualPattern = visualPatterns[0];
          
          // Enrich with performance data
          const visualTpsValues = topVisualPattern.member_videos
            .map(id => tpsMap.get(id))
            .filter((tps): tps is number => tps !== undefined);
          
          const avgVisualTps = visualTpsValues.reduce((a, b) => a + b, 0) / visualTpsValues.length;
          
          const visualHypothesis: PatternHypothesis = {
            hypothesis_id: `hyp_visual_1`,
            hypothesis_statement: `Visual pattern with ${topVisualPattern.member_videos.length} similar thumbnails achieves ${avgVisualTps.toFixed(1)} avg TPS, suggesting visual consistency drives engagement`,
            pattern_type: 'visual',
            confidence_score: Math.min(80, 50 + topVisualPattern.member_videos.length * 3),
            evidence: {
              supporting_videos: topVisualPattern.member_videos.slice(0, 5).map(id => {
                const video = videoDataMap.get(id);
                return video ? {
                  video_id: id,
                  title: video.title,
                  tps: video.temporal_performance_score!,
                  channel_name: video.channel_name,
                  similarity_to_pattern: 0.8
                } : null;
              }).filter((v): v is any => v !== null),
              avg_tps_in_pattern: avgVisualTps,
              std_dev_tps: Math.sqrt(visualTpsValues.reduce((sum, tps) => sum + Math.pow(tps - avgVisualTps, 2), 0) / visualTpsValues.length),
              cross_channel_validation: false,
              cross_topic_validation: false
            },
            semantic_signature: {
              key_dimensions: [],
              centroid_stability: 0.7,
              dispersion: 0.3
            },
            testable_predictions: [
              'Thumbnails matching this visual style should improve CTR',
              'Visual consistency matters more than topic variation'
            ],
            recommended_experiments: [
              'Test similar thumbnail compositions',
              'Analyze color palette impact on performance'
            ]
          };
          
          hypotheses.push(visualHypothesis);
        }
      }
    }
    
    // Calculate analysis scope
    const channelSet = new Set(videos.map(v => v.channel_id));
    const topicSet = new Set(videos.map(v => v.topic_niche).filter(t => t));
    const tpsValues = videos.map(v => v.temporal_performance_score!);
    
    // Determine strongest pattern type
    const patternTypeCounts = hypotheses.reduce((acc, h) => {
      acc[h.pattern_type] = (acc[h.pattern_type] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);
    
    const strongestType = Object.entries(patternTypeCounts)
      .sort((a, b) => b[1] - a[1])[0]?.[0] || 'semantic';
    
    // Calculate validation metrics
    const avgConfidence = hypotheses.reduce((sum, h) => sum + h.confidence_score, 0) / (hypotheses.length || 1);
    const crossBoundaryCount = hypotheses.filter(h => 
      h.evidence.cross_channel_validation || h.evidence.cross_topic_validation
    ).length;
    
    const response: PatternHypothesesResponse = {
      analysis_scope: {
        total_videos_analyzed: videos.length,
        channels_covered: channelSet.size,
        topics_covered: topicSet.size,
        tps_range: [Math.min(...tpsValues), Math.max(...tpsValues)]
      },
      discovered_hypotheses: hypotheses,
      meta_patterns: {
        strongest_pattern_type: strongestType,
        cross_boundary_patterns: crossBoundaryCount,
        novel_patterns: hypotheses.filter(h => h.confidence_score > 70).length
      },
      validation_metrics: {
        avg_confidence: avgConfidence,
        statistical_significance: avgConfidence > 60,
        replication_potential: avgConfidence > 70 ? 'high' : avgConfidence > 50 ? 'medium' : 'low'
      }
    };
    
    return {
      success: true,
      data: response
    };
    
  } catch (error: any) {
    console.error('Error suggesting pattern hypotheses:', error);
    return {
      success: false,
      error: {
        code: 'HYPOTHESIS_ERROR',
        message: 'Failed to generate pattern hypotheses',
        details: error.message,
        retryable: true
      }
    };
  }
}

// Wrap handler with caching and retry logic
const wrappedHandler = wrapTool({
  name: 'suggest_pattern_hypotheses',
  description: 'Discover semantic patterns across boundaries and generate testable hypotheses',
  parameters: {
    type: 'object',
    properties: {
      seed_video_ids: {
        type: 'array',
        items: { type: 'string' },
        description: 'Optional seed videos to start pattern discovery'
      },
      channel_id: {
        type: 'string',
        description: 'Channel to focus on (unless search_across_channels is true)'
      },
      min_tps_threshold: {
        type: 'number',
        description: 'Minimum TPS for videos to include',
        default: 2.0
      },
      search_across_channels: {
        type: 'boolean',
        description: 'Search for patterns across all channels',
        default: true
      },
      max_hypotheses: {
        type: 'number',
        description: 'Maximum number of hypotheses to generate',
        default: 5
      },
      include_visual_patterns: {
        type: 'boolean',
        description: 'Include CLIP-based visual patterns',
        default: true
      },
      include_temporal_patterns: {
        type: 'boolean',
        description: 'Include temporal performance patterns',
        default: true
      }
    },
    required: []
  },
  handler: suggestPatternHypothesesHandler,
  parallelSafe: false, // Complex pattern discovery
  cacheTTL: 1200, // Cache for 20 minutes
  timeout: 25000, // Long timeout for pattern discovery
  retryConfig: {
    maxRetries: 2,
    backoffMs: 3000
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
export { suggestPatternHypothesesHandler, clusterByEmbeddings, identifyKeyDimensions };