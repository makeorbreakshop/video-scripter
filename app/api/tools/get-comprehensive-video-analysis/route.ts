/**
 * API endpoint for get_comprehensive_video_analysis tool
 * Orchestrates semantic neighbors + performance context + visual similarity + temporal patterns
 * Single endpoint for full semantic and performance intelligence
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

interface ComprehensiveAnalysisParams {
  video_id: string;
  include_semantic_neighbors?: boolean;
  include_visual_analysis?: boolean;
  include_temporal_patterns?: boolean;
  include_channel_context?: boolean;
  semantic_neighbor_count?: number;
  visual_neighbor_count?: number;
}

interface SemanticNeighbor {
  video_id: string;
  title: string;
  channel_name: string;
  similarity_score: number;
  tps: number | null;
  format_type: string | null;
  topic_niche: string | null;
  published_at: string;
  relationship_type: 'title_similar' | 'concept_similar' | 'visual_similar';
}

interface TemporalPattern {
  pattern_type: 'early_spike' | 'slow_burn' | 'delayed_success' | 'steady_growth' | 'volatile';
  day_1_performance: number | null;
  day_7_performance: number | null;
  day_30_performance: number | null;
  peak_day: number | null;
  peak_performance: number | null;
  current_trajectory: 'rising' | 'falling' | 'stable';
}

interface ChannelContext {
  channel_baseline_at_publish: number | null;
  performance_vs_baseline: number | null;
  percentile_in_channel: number;
  recent_channel_trend: 'improving' | 'declining' | 'stable';
  avg_channel_tps_30d: number | null;
  is_channel_outlier: boolean;
}

interface SemanticAnalysis {
  embedding_variance_from_channel: number;
  nearest_viral_distance: number;
  cluster_coherence_score: number;
  cross_niche_appeal_score: number;
  unique_semantic_features: string[];
}

interface VisualAnalysis {
  thumbnail_uniqueness_score: number;
  visual_clustering_group: string | null;
  color_dominance: string | null;
  visual_complexity_score: number;
  similar_thumbnail_performance: number | null;
}

interface ComprehensiveAnalysisResponse {
  video_id: string;
  core_metrics: {
    title: string;
    tps: number | null;
    views: number | null;
    format_type: string | null;
    topic_niche: string | null;
    topic_cluster_id: number | null;
    published_at: string;
    channel_id: string;
    channel_name: string;
  };
  semantic_analysis: SemanticAnalysis;
  semantic_neighbors: {
    title_based: SemanticNeighbor[];
    concept_based: SemanticNeighbor[];
    cross_channel_patterns: {
      pattern: string;
      video_count: number;
      avg_tps: number;
    }[];
  };
  visual_analysis?: VisualAnalysis;
  visual_neighbors?: SemanticNeighbor[];
  temporal_patterns?: TemporalPattern;
  channel_context?: ChannelContext;
  composite_insights: {
    performance_drivers: string[];
    risk_factors: string[];
    opportunities: string[];
    confidence_score: number;
  };
  multidimensional_score: number; // 0-100 combining all signals
}

/**
 * Calculate cosine similarity between vectors
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
 * Analyze temporal performance pattern
 */
async function analyzeTemporalPattern(videoId: string): Promise<TemporalPattern | null> {
  const { data: snapshots, error } = await supabase
    .from('view_snapshots')
    .select('snapshot_date, view_count')
    .eq('video_id', videoId)
    .order('snapshot_date', { ascending: true });
  
  if (error || !snapshots || snapshots.length === 0) return null;
  
  // Calculate days from publish
  const firstSnapshot = snapshots[0];
  const firstDate = new Date(firstSnapshot.snapshot_date);
  
  const performanceByDay = new Map<number, number>();
  let peakDay = 0;
  let peakViews = 0;
  
  snapshots.forEach(snapshot => {
    const date = new Date(snapshot.snapshot_date);
    const daysSinceFirst = Math.floor((date.getTime() - firstDate.getTime()) / (1000 * 60 * 60 * 24));
    performanceByDay.set(daysSinceFirst, snapshot.view_count);
    
    if (snapshot.view_count > peakViews) {
      peakViews = snapshot.view_count;
      peakDay = daysSinceFirst;
    }
  });
  
  // Calculate growth rates
  const day1Views = performanceByDay.get(1) || performanceByDay.get(0) || 0;
  const day7Views = performanceByDay.get(7) || Array.from(performanceByDay.entries()).find(([d]) => d >= 7)?.[1] || 0;
  const day30Views = performanceByDay.get(30) || Array.from(performanceByDay.entries()).find(([d]) => d >= 30)?.[1] || 0;
  
  // Determine pattern type
  let patternType: TemporalPattern['pattern_type'];
  const earlyGrowth = day7Views > 0 ? day7Views / day1Views : 1;
  const lateGrowth = day30Views > 0 ? day30Views / day7Views : 1;
  
  if (earlyGrowth > 5 && peakDay <= 7) {
    patternType = 'early_spike';
  } else if (earlyGrowth < 2 && lateGrowth > 3) {
    patternType = 'slow_burn';
  } else if (peakDay > 30) {
    patternType = 'delayed_success';
  } else if (Math.abs(earlyGrowth - lateGrowth) < 0.5) {
    patternType = 'steady_growth';
  } else {
    patternType = 'volatile';
  }
  
  // Determine current trajectory
  const recentSnapshots = snapshots.slice(-7);
  const recentTrend = recentSnapshots.length > 1 ? 
    (recentSnapshots[recentSnapshots.length - 1].view_count - recentSnapshots[0].view_count) : 0;
  
  let currentTrajectory: TemporalPattern['current_trajectory'];
  if (recentTrend > snapshots[snapshots.length - 1].view_count * 0.1) {
    currentTrajectory = 'rising';
  } else if (recentTrend < -snapshots[snapshots.length - 1].view_count * 0.1) {
    currentTrajectory = 'falling';
  } else {
    currentTrajectory = 'stable';
  }
  
  return {
    pattern_type: patternType,
    day_1_performance: day1Views,
    day_7_performance: day7Views,
    day_30_performance: day30Views,
    peak_day: peakDay,
    peak_performance: peakViews,
    current_trajectory: currentTrajectory
  };
}

/**
 * Get comprehensive video analysis
 */
async function getComprehensiveVideoAnalysisHandler(
  params: ComprehensiveAnalysisParams,
  context?: any
): Promise<ToolResponse<ComprehensiveAnalysisResponse>> {
  const {
    video_id,
    include_semantic_neighbors = true,
    include_visual_analysis = true,
    include_temporal_patterns = true,
    include_channel_context = true,
    semantic_neighbor_count = 10,
    visual_neighbor_count = 5
  } = params;
  
  try {
    // Fetch core video data
    const { data: video, error: videoError } = await supabase
      .from('videos')
      .select('*')
      .eq('id', video_id)
      .single();
    
    if (videoError || !video) {
      return {
        success: false,
        error: {
          code: 'VIDEO_NOT_FOUND',
          message: `Video ${video_id} not found`
        }
      };
    }
    
    // Initialize response structure
    const response: ComprehensiveAnalysisResponse = {
      video_id,
      core_metrics: {
        title: video.title,
        tps: video.temporal_performance_score,
        views: video.view_count,
        format_type: video.format_type,
        topic_niche: video.topic_niche,
        topic_cluster_id: video.topic_cluster_id,
        published_at: video.published_at,
        channel_id: video.channel_id,
        channel_name: video.channel_name
      },
      semantic_analysis: {
        embedding_variance_from_channel: 0,
        nearest_viral_distance: 0,
        cluster_coherence_score: 0,
        cross_niche_appeal_score: 0,
        unique_semantic_features: []
      },
      semantic_neighbors: {
        title_based: [],
        concept_based: [],
        cross_channel_patterns: []
      },
      composite_insights: {
        performance_drivers: [],
        risk_factors: [],
        opportunities: [],
        confidence_score: 0
      },
      multidimensional_score: 0
    };
    
    // Parallel fetch: embeddings and semantic neighbors
    if (include_semantic_neighbors) {
      const titleIndex = pinecone.index(process.env.PINECONE_INDEX_NAME!);
      const summaryIndex = pinecone.index(process.env.PINECONE_INDEX_NAME!).namespace('llm-summaries');
      
      // Fetch video's own embeddings
      const [titleEmbedding, summaryEmbedding] = await Promise.all([
        titleIndex.fetch([video_id]),
        summaryIndex.fetch([video_id])
      ]);
      
      const videoTitleVector = titleEmbedding.records[video_id]?.values;
      const videoSummaryVector = summaryEmbedding.records[video_id]?.values;
      
      // Search for similar videos by title
      let titleNeighbors: SemanticNeighbor[] = [];
      if (videoTitleVector) {
        const titleResults = await titleIndex.query({
          vector: videoTitleVector,
          topK: semantic_neighbor_count + 1,
          includeMetadata: true
        });
        
        const neighborIds = titleResults.matches
          .filter(m => m.id !== video_id)
          .map(m => m.id);
        
        if (neighborIds.length > 0) {
          const { data: neighborVideos } = await supabase
            .from('videos')
            .select('id, title, channel_name, temporal_performance_score, format_type, topic_niche, published_at')
            .in('id', neighborIds);
          
          if (neighborVideos) {
            titleNeighbors = titleResults.matches
              .filter(m => m.id !== video_id)
              .map(match => {
                const neighborVideo = neighborVideos.find(v => v.id === match.id);
                return neighborVideo ? {
                  video_id: match.id,
                  title: neighborVideo.title,
                  channel_name: neighborVideo.channel_name,
                  similarity_score: match.score || 0,
                  tps: neighborVideo.temporal_performance_score,
                  format_type: neighborVideo.format_type,
                  topic_niche: neighborVideo.topic_niche,
                  published_at: neighborVideo.published_at,
                  relationship_type: 'title_similar' as const
                } : null;
              })
              .filter((n): n is SemanticNeighbor => n !== null);
          }
        }
      }
      
      // Search for similar videos by concept (summary)
      let conceptNeighbors: SemanticNeighbor[] = [];
      if (videoSummaryVector) {
        const summaryResults = await summaryIndex.query({
          vector: videoSummaryVector,
          topK: semantic_neighbor_count + 1,
          includeMetadata: true
        });
        
        const neighborIds = summaryResults.matches
          .filter(m => m.id !== video_id)
          .map(m => m.id);
        
        if (neighborIds.length > 0) {
          const { data: neighborVideos } = await supabase
            .from('videos')
            .select('id, title, channel_name, temporal_performance_score, format_type, topic_niche, published_at')
            .in('id', neighborIds);
          
          if (neighborVideos) {
            conceptNeighbors = summaryResults.matches
              .filter(m => m.id !== video_id)
              .map(match => {
                const neighborVideo = neighborVideos.find(v => v.id === match.id);
                return neighborVideo ? {
                  video_id: match.id,
                  title: neighborVideo.title,
                  channel_name: neighborVideo.channel_name,
                  similarity_score: match.score || 0,
                  tps: neighborVideo.temporal_performance_score,
                  format_type: neighborVideo.format_type,
                  topic_niche: neighborVideo.topic_niche,
                  published_at: neighborVideo.published_at,
                  relationship_type: 'concept_similar' as const
                } : null;
              })
              .filter((n): n is SemanticNeighbor => n !== null);
          }
        }
      }
      
      response.semantic_neighbors.title_based = titleNeighbors;
      response.semantic_neighbors.concept_based = conceptNeighbors;
      
      // Analyze cross-channel patterns
      const allNeighbors = [...titleNeighbors, ...conceptNeighbors];
      const patternMap = new Map<string, { videos: SemanticNeighbor[] }>();
      
      allNeighbors.forEach(neighbor => {
        if (neighbor.format_type && neighbor.topic_niche) {
          const pattern = `${neighbor.format_type}:${neighbor.topic_niche}`;
          if (!patternMap.has(pattern)) {
            patternMap.set(pattern, { videos: [] });
          }
          patternMap.get(pattern)!.videos.push(neighbor);
        }
      });
      
      response.semantic_neighbors.cross_channel_patterns = Array.from(patternMap.entries())
        .map(([pattern, data]) => ({
          pattern,
          video_count: data.videos.length,
          avg_tps: data.videos.reduce((sum, v) => sum + (v.tps || 0), 0) / data.videos.length
        }))
        .filter(p => p.video_count >= 2)
        .sort((a, b) => b.avg_tps - a.avg_tps)
        .slice(0, 5);
      
      // Calculate semantic analysis metrics
      if (videoTitleVector) {
        // Get channel's average embedding
        const { data: channelVideos } = await supabase
          .from('videos')
          .select('id')
          .eq('channel_id', video.channel_id)
          .neq('id', video_id)
          .limit(20);
        
        if (channelVideos && channelVideos.length > 0) {
          const channelEmbeddings = await titleIndex.fetch(channelVideos.map(v => v.id));
          const channelVectors = Object.values(channelEmbeddings.records)
            .map(r => r.values)
            .filter((v): v is number[] => v !== undefined);
          
          if (channelVectors.length > 0) {
            // Calculate centroid
            const centroid = new Array(videoTitleVector.length).fill(0);
            channelVectors.forEach(vec => {
              vec.forEach((val, i) => {
                centroid[i] += val / channelVectors.length;
              });
            });
            
            response.semantic_analysis.embedding_variance_from_channel = 
              1 - cosineSimilarity(videoTitleVector, centroid);
          }
        }
        
        // Find nearest viral video distance
        const { data: viralVideos } = await supabase
          .from('videos')
          .select('id')
          .gte('temporal_performance_score', 3.0)
          .neq('id', video_id)
          .limit(10);
        
        if (viralVideos && viralVideos.length > 0) {
          const viralEmbeddings = await titleIndex.fetch(viralVideos.map(v => v.id));
          let minDistance = 1;
          
          Object.values(viralEmbeddings.records).forEach(record => {
            if (record.values) {
              const similarity = cosineSimilarity(videoTitleVector, record.values);
              minDistance = Math.min(minDistance, 1 - similarity);
            }
          });
          
          response.semantic_analysis.nearest_viral_distance = minDistance;
        }
        
        // Calculate cluster coherence
        if (titleNeighbors.length > 0) {
          const avgSimilarity = titleNeighbors.reduce((sum, n) => sum + n.similarity_score, 0) / titleNeighbors.length;
          response.semantic_analysis.cluster_coherence_score = avgSimilarity;
        }
        
        // Cross-niche appeal score
        const uniqueNiches = new Set(allNeighbors.map(n => n.topic_niche).filter(n => n !== null));
        response.semantic_analysis.cross_niche_appeal_score = Math.min(1, uniqueNiches.size / 5);
        
        // Identify unique semantic features
        if (response.semantic_analysis.embedding_variance_from_channel > 0.3) {
          response.semantic_analysis.unique_semantic_features.push('Semantically distinct from channel norm');
        }
        if (response.semantic_analysis.nearest_viral_distance < 0.2) {
          response.semantic_analysis.unique_semantic_features.push('Close to viral semantic space');
        }
        if (response.semantic_analysis.cross_niche_appeal_score > 0.6) {
          response.semantic_analysis.unique_semantic_features.push('Cross-niche appeal detected');
        }
      }
    }
    
    // Visual analysis using CLIP embeddings
    if (include_visual_analysis) {
      const thumbnailIndex = pinecone.index(process.env.PINECONE_THUMBNAIL_INDEX_NAME!);
      const thumbEmbedding = await thumbnailIndex.fetch([video_id]);
      const videoThumbVector = thumbEmbedding.records[video_id]?.values;
      
      if (videoThumbVector) {
        const visualResults = await thumbnailIndex.query({
          vector: videoThumbVector,
          topK: visual_neighbor_count + 1,
          includeMetadata: true
        });
        
        const visualNeighborIds = visualResults.matches
          .filter(m => m.id !== video_id)
          .map(m => m.id);
        
        if (visualNeighborIds.length > 0) {
          const { data: visualNeighborVideos } = await supabase
            .from('videos')
            .select('id, title, channel_name, temporal_performance_score, format_type, topic_niche, published_at')
            .in('id', visualNeighborIds);
          
          if (visualNeighborVideos) {
            response.visual_neighbors = visualResults.matches
              .filter(m => m.id !== video_id)
              .map(match => {
                const neighborVideo = visualNeighborVideos.find(v => v.id === match.id);
                return neighborVideo ? {
                  video_id: match.id,
                  title: neighborVideo.title,
                  channel_name: neighborVideo.channel_name,
                  similarity_score: match.score || 0,
                  tps: neighborVideo.temporal_performance_score,
                  format_type: neighborVideo.format_type,
                  topic_niche: neighborVideo.topic_niche,
                  published_at: neighborVideo.published_at,
                  relationship_type: 'visual_similar' as const
                } : null;
              })
              .filter((n): n is SemanticNeighbor => n !== null);
            
            // Calculate visual metrics
            const avgVisualSimilarity = response.visual_neighbors.reduce((sum, n) => sum + n.similarity_score, 0) / 
                                       (response.visual_neighbors.length || 1);
            
            response.visual_analysis = {
              thumbnail_uniqueness_score: 1 - avgVisualSimilarity,
              visual_clustering_group: response.visual_neighbors.length >= 3 ? 'cohesive_group' : 'unique',
              color_dominance: null, // Would need color analysis
              visual_complexity_score: 0.5, // Placeholder
              similar_thumbnail_performance: response.visual_neighbors.length > 0 ?
                response.visual_neighbors.reduce((sum, n) => sum + (n.tps || 0), 0) / response.visual_neighbors.length : null
            };
          }
        }
      }
    }
    
    // Temporal patterns analysis
    if (include_temporal_patterns) {
      response.temporal_patterns = await analyzeTemporalPattern(video_id);
    }
    
    // Channel context analysis
    if (include_channel_context) {
      // Get channel baseline at publish time
      const { data: channelVideos } = await supabase
        .from('videos')
        .select('temporal_performance_score')
        .eq('channel_id', video.channel_id)
        .lte('published_at', video.published_at)
        .gte('published_at', new Date(new Date(video.published_at).getTime() - 30 * 24 * 60 * 60 * 1000).toISOString())
        .not('temporal_performance_score', 'is', null);
      
      if (channelVideos && channelVideos.length > 0) {
        const baseline = channelVideos.reduce((sum, v) => sum + v.temporal_performance_score!, 0) / channelVideos.length;
        
        // Get all channel videos for percentile calculation
        const { data: allChannelVideos } = await supabase
          .from('videos')
          .select('temporal_performance_score')
          .eq('channel_id', video.channel_id)
          .not('temporal_performance_score', 'is', null);
        
        let percentile = 50;
        if (allChannelVideos && video.temporal_performance_score) {
          const belowCount = allChannelVideos.filter(v => v.temporal_performance_score! < video.temporal_performance_score!).length;
          percentile = (belowCount / allChannelVideos.length) * 100;
        }
        
        // Recent trend
        const { data: recentVideos } = await supabase
          .from('videos')
          .select('temporal_performance_score, published_at')
          .eq('channel_id', video.channel_id)
          .gte('published_at', new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString())
          .not('temporal_performance_score', 'is', null)
          .order('published_at', { ascending: true });
        
        let trend: ChannelContext['recent_channel_trend'] = 'stable';
        if (recentVideos && recentVideos.length >= 5) {
          const firstHalf = recentVideos.slice(0, Math.floor(recentVideos.length / 2));
          const secondHalf = recentVideos.slice(Math.floor(recentVideos.length / 2));
          
          const firstAvg = firstHalf.reduce((sum, v) => sum + v.temporal_performance_score!, 0) / firstHalf.length;
          const secondAvg = secondHalf.reduce((sum, v) => sum + v.temporal_performance_score!, 0) / secondHalf.length;
          
          if (secondAvg > firstAvg * 1.2) trend = 'improving';
          else if (secondAvg < firstAvg * 0.8) trend = 'declining';
        }
        
        response.channel_context = {
          channel_baseline_at_publish: baseline,
          performance_vs_baseline: video.temporal_performance_score ? video.temporal_performance_score / baseline : null,
          percentile_in_channel: percentile,
          recent_channel_trend: trend,
          avg_channel_tps_30d: recentVideos ? 
            recentVideos.reduce((sum, v) => sum + v.temporal_performance_score!, 0) / recentVideos.length : null,
          is_channel_outlier: video.temporal_performance_score ? 
            (video.temporal_performance_score > baseline * 2 || video.temporal_performance_score < baseline * 0.5) : false
        };
      }
    }
    
    // Generate composite insights
    const insights = response.composite_insights;
    let confidenceFactors = 0;
    let totalFactors = 0;
    
    // Performance drivers
    if (response.semantic_analysis.nearest_viral_distance < 0.3) {
      insights.performance_drivers.push('Semantic similarity to viral content');
      confidenceFactors++;
    }
    if (response.channel_context?.is_channel_outlier && video.temporal_performance_score! > 2) {
      insights.performance_drivers.push('Breakthrough performance for channel');
      confidenceFactors++;
    }
    if (response.semantic_neighbors.cross_channel_patterns.some(p => p.avg_tps > 2.5)) {
      insights.performance_drivers.push('Part of high-performing cross-channel pattern');
      confidenceFactors++;
    }
    if (response.temporal_patterns?.pattern_type === 'early_spike') {
      insights.performance_drivers.push('Strong early momentum captured audience');
      confidenceFactors++;
    }
    totalFactors += 4;
    
    // Risk factors
    if (response.semantic_analysis.embedding_variance_from_channel > 0.7) {
      insights.risk_factors.push('Very different from channel\'s typical content');
    }
    if (response.temporal_patterns?.current_trajectory === 'falling') {
      insights.risk_factors.push('Performance trajectory declining');
    }
    if (response.visual_analysis?.thumbnail_uniqueness_score && response.visual_analysis.thumbnail_uniqueness_score > 0.8) {
      insights.risk_factors.push('Thumbnail style very different from similar content');
    }
    
    // Opportunities
    if (response.semantic_analysis.cross_niche_appeal_score > 0.6) {
      insights.opportunities.push('Content appeals across multiple niches');
    }
    if (response.semantic_neighbors.concept_based.filter(n => n.tps && n.tps > 3).length >= 3) {
      insights.opportunities.push('Concept validated by multiple viral videos');
    }
    if (response.channel_context?.recent_channel_trend === 'improving' && video.temporal_performance_score! > 2) {
      insights.opportunities.push('Riding channel momentum wave');
    }
    
    // Calculate confidence score
    insights.confidence_score = Math.min(100, (confidenceFactors / totalFactors) * 100);
    
    // Calculate multidimensional score
    const scoreComponents = [
      video.temporal_performance_score ? Math.min(30, video.temporal_performance_score * 10) : 0,
      response.semantic_analysis.cluster_coherence_score * 20,
      response.semantic_analysis.cross_niche_appeal_score * 15,
      (1 - response.semantic_analysis.nearest_viral_distance) * 15,
      response.channel_context?.percentile_in_channel ? response.channel_context.percentile_in_channel / 5 : 10,
      insights.confidence_score / 10
    ];
    
    response.multidimensional_score = Math.min(100, scoreComponents.reduce((sum, score) => sum + score, 0));
    
    return {
      success: true,
      data: response
    };
    
  } catch (error: any) {
    console.error('Error in comprehensive analysis:', error);
    return {
      success: false,
      error: {
        code: 'ANALYSIS_ERROR',
        message: 'Failed to generate comprehensive analysis',
        details: error.message,
        retryable: true
      }
    };
  }
}

// Wrap handler with caching and retry logic
const wrappedHandler = wrapTool({
  name: 'get_comprehensive_video_analysis',
  description: 'Orchestrate all signals for unified semantic and performance analysis',
  parameters: {
    type: 'object',
    properties: {
      video_id: {
        type: 'string',
        description: 'Video ID to analyze comprehensively'
      },
      include_semantic_neighbors: {
        type: 'boolean',
        description: 'Include semantic neighbor analysis',
        default: true
      },
      include_visual_analysis: {
        type: 'boolean',
        description: 'Include CLIP visual analysis',
        default: true
      },
      include_temporal_patterns: {
        type: 'boolean',
        description: 'Include temporal performance patterns',
        default: true
      },
      include_channel_context: {
        type: 'boolean',
        description: 'Include channel performance context',
        default: true
      },
      semantic_neighbor_count: {
        type: 'number',
        description: 'Number of semantic neighbors to fetch',
        default: 10
      },
      visual_neighbor_count: {
        type: 'number',
        description: 'Number of visual neighbors to fetch',
        default: 5
      }
    },
    required: ['video_id']
  },
  handler: getComprehensiveVideoAnalysisHandler,
  parallelSafe: false, // Complex orchestration
  cacheTTL: 900, // Cache for 15 minutes
  timeout: 30000, // Long timeout for comprehensive analysis
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
export { getComprehensiveVideoAnalysisHandler, cosineSimilarity, analyzeTemporalPattern };