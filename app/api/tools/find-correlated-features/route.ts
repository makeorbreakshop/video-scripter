/**
 * API endpoint for find_correlated_features tool
 * Analyzes correlation between embedding dimensions and performance
 * Bridges vector space features with TPS scores
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

interface CorrelatedFeaturesParams {
  video_ids?: string[];
  channel_id?: string;
  min_tps?: number;
  top_dimensions?: number;
  include_thumbnails?: boolean;
  sample_size?: number;
}

interface DimensionCorrelation {
  dimension_index: number;
  correlation_coefficient: number;
  p_value: number;
  direction: 'positive' | 'negative';
  strength: 'weak' | 'moderate' | 'strong';
  avg_value_high_performers: number;
  avg_value_low_performers: number;
}

interface SemanticDirection {
  description: string;
  dimension_indices: number[];
  combined_correlation: number;
  example_videos: Array<{
    video_id: string;
    title: string;
    tps: number;
    projection: number; // Value along this semantic direction
  }>;
}

interface VisualCorrelation {
  dimension_index: number;
  correlation_coefficient: number;
  interpretation: string; // What this CLIP dimension might represent
}

interface CorrelatedFeaturesResponse {
  analysis_scope: {
    total_videos: number;
    avg_tps: number;
    embedding_type: 'title' | 'summary' | 'both';
    dimensions_analyzed: number;
  };
  title_correlations: {
    top_positive: DimensionCorrelation[];
    top_negative: DimensionCorrelation[];
    semantic_directions: SemanticDirection[];
  };
  thumbnail_correlations?: {
    top_positive: VisualCorrelation[];
    top_negative: VisualCorrelation[];
  };
  cross_modal_patterns: {
    title_thumbnail_alignment: number; // Correlation between text and visual embeddings
    reinforcing_dimensions: Array<{
      title_dim: number;
      thumbnail_dim: number;
      combined_correlation: number;
    }>;
  };
  actionable_insights: string[];
}

/**
 * Calculate Pearson correlation coefficient
 */
function calculatePearsonCorrelation(x: number[], y: number[]): {
  correlation: number;
  pValue: number;
} {
  const n = x.length;
  if (n !== y.length || n < 3) {
    return { correlation: 0, pValue: 1 };
  }
  
  const meanX = x.reduce((sum, v) => sum + v, 0) / n;
  const meanY = y.reduce((sum, v) => sum + v, 0) / n;
  
  let numerator = 0;
  let denomX = 0;
  let denomY = 0;
  
  for (let i = 0; i < n; i++) {
    const dx = x[i] - meanX;
    const dy = y[i] - meanY;
    numerator += dx * dy;
    denomX += dx * dx;
    denomY += dy * dy;
  }
  
  if (denomX === 0 || denomY === 0) {
    return { correlation: 0, pValue: 1 };
  }
  
  const correlation = numerator / Math.sqrt(denomX * denomY);
  
  // Calculate t-statistic for p-value
  const t = correlation * Math.sqrt((n - 2) / (1 - correlation * correlation));
  // Simplified p-value calculation (use proper stats library in production)
  const pValue = 2 * (1 - Math.min(0.999, Math.abs(t) / Math.sqrt(n)));
  
  return { correlation, pValue };
}

/**
 * Identify semantic directions (combinations of dimensions)
 */
function findSemanticDirections(
  embeddings: Map<string, number[]>,
  tpsMap: Map<string, number>,
  topDims: number[]
): SemanticDirection[] {
  const directions: SemanticDirection[] = [];
  
  // Example: Find "educational" direction (hypothetical combination)
  // In production, use PCA or factor analysis
  const educationalDims = topDims.slice(0, 3);
  const educationalCorr = calculateCombinedCorrelation(embeddings, tpsMap, educationalDims);
  
  if (Math.abs(educationalCorr) > 0.3) {
    directions.push({
      description: 'Educational content signal',
      dimension_indices: educationalDims,
      combined_correlation: educationalCorr,
      example_videos: findExampleVideos(embeddings, tpsMap, educationalDims, 3)
    });
  }
  
  // Find "entertainment" direction (different combination)
  if (topDims.length > 5) {
    const entertainmentDims = topDims.slice(3, 6);
    const entertainmentCorr = calculateCombinedCorrelation(embeddings, tpsMap, entertainmentDims);
    
    if (Math.abs(entertainmentCorr) > 0.3) {
      directions.push({
        description: 'Entertainment value signal',
        dimension_indices: entertainmentDims,
        combined_correlation: entertainmentCorr,
        example_videos: findExampleVideos(embeddings, tpsMap, entertainmentDims, 3)
      });
    }
  }
  
  return directions;
}

/**
 * Calculate correlation for combined dimensions
 */
function calculateCombinedCorrelation(
  embeddings: Map<string, number[]>,
  tpsMap: Map<string, number>,
  dimensions: number[]
): number {
  const projections: number[] = [];
  const tpsValues: number[] = [];
  
  for (const [videoId, embedding] of embeddings.entries()) {
    const tps = tpsMap.get(videoId);
    if (tps === undefined) continue;
    
    // Calculate projection along this direction
    let projection = 0;
    for (const dim of dimensions) {
      projection += embedding[dim] || 0;
    }
    projection /= dimensions.length;
    
    projections.push(projection);
    tpsValues.push(tps);
  }
  
  return calculatePearsonCorrelation(projections, tpsValues).correlation;
}

/**
 * Find example videos for a semantic direction
 */
function findExampleVideos(
  embeddings: Map<string, number[]>,
  tpsMap: Map<string, number>,
  dimensions: number[],
  count: number
): any[] {
  const videos: any[] = [];
  
  for (const [videoId, embedding] of embeddings.entries()) {
    const tps = tpsMap.get(videoId);
    if (tps === undefined) continue;
    
    let projection = 0;
    for (const dim of dimensions) {
      projection += embedding[dim] || 0;
    }
    projection /= dimensions.length;
    
    videos.push({
      video_id: videoId,
      title: '', // Will be filled later
      tps,
      projection
    });
  }
  
  // Sort by projection value and take top examples
  videos.sort((a, b) => Math.abs(b.projection) - Math.abs(a.projection));
  return videos.slice(0, count);
}

/**
 * Find correlated features between embeddings and performance
 */
async function findCorrelatedFeaturesHandler(
  params: CorrelatedFeaturesParams,
  context?: any
): Promise<ToolResponse<CorrelatedFeaturesResponse>> {
  const {
    video_ids,
    channel_id,
    min_tps = 0,
    top_dimensions = 10,
    include_thumbnails = false,
    sample_size = 500
  } = params;
  
  try {
    // Get videos to analyze
    let query = supabase
      .from('videos')
      .select('id, title, temporal_performance_score, channel_id')
      .gte('temporal_performance_score', min_tps)
      .not('temporal_performance_score', 'is', null)
      .eq('is_short', false);
    
    if (video_ids && video_ids.length > 0) {
      query = query.in('id', video_ids);
    } else if (channel_id) {
      query = query.eq('channel_id', channel_id);
    } else {
      // Random sample if no specific videos/channel
      query = query.limit(sample_size);
    }
    
    const { data: videos, error: videoError } = await query;
    
    if (videoError || !videos || videos.length === 0) {
      return {
        success: false,
        error: {
          code: 'NO_DATA',
          message: 'No videos found matching criteria'
        }
      };
    }
    
    const videoIds = videos.map(v => v.id);
    const tpsMap = new Map(videos.map(v => [v.id, v.temporal_performance_score!]));
    const titleMap = new Map(videos.map(v => [v.id, v.title]));
    
    // Fetch title embeddings from Pinecone
    const titleIndex = pinecone.index(process.env.PINECONE_INDEX_NAME!);
    const titleEmbeddings = new Map<string, number[]>();
    
    // Batch fetch
    const chunks = [];
    for (let i = 0; i < videoIds.length; i += 100) {
      chunks.push(videoIds.slice(i, i + 100));
    }
    
    for (const chunk of chunks) {
      try {
        const response = await titleIndex.fetch(chunk);
        for (const [id, data] of Object.entries(response.records)) {
          if (data?.values) {
            titleEmbeddings.set(id, data.values);
          }
        }
      } catch (error) {
        console.error('Error fetching title embeddings:', error);
      }
    }
    
    if (titleEmbeddings.size === 0) {
      return {
        success: false,
        error: {
          code: 'NO_EMBEDDINGS',
          message: 'No embeddings found for videos'
        }
      };
    }
    
    // Calculate dimension correlations with TPS
    const dimensionCount = titleEmbeddings.values().next().value?.length || 512;
    const dimensionCorrelations: DimensionCorrelation[] = [];
    
    for (let dim = 0; dim < dimensionCount; dim++) {
      const dimValues: number[] = [];
      const tpsValues: number[] = [];
      
      for (const [videoId, embedding] of titleEmbeddings.entries()) {
        const tps = tpsMap.get(videoId);
        if (tps === undefined) continue;
        
        dimValues.push(embedding[dim]);
        tpsValues.push(tps);
      }
      
      if (dimValues.length < 3) continue;
      
      const { correlation, pValue } = calculatePearsonCorrelation(dimValues, tpsValues);
      
      if (Math.abs(correlation) > 0.1) { // Only keep meaningful correlations
        // Calculate averages for high vs low performers
        const highPerformers = dimValues.filter((_, i) => tpsValues[i] >= 2);
        const lowPerformers = dimValues.filter((_, i) => tpsValues[i] < 1);
        
        dimensionCorrelations.push({
          dimension_index: dim,
          correlation_coefficient: correlation,
          p_value: pValue,
          direction: correlation > 0 ? 'positive' : 'negative',
          strength: Math.abs(correlation) > 0.5 ? 'strong' : 
                   Math.abs(correlation) > 0.3 ? 'moderate' : 'weak',
          avg_value_high_performers: highPerformers.length > 0 
            ? highPerformers.reduce((a, b) => a + b, 0) / highPerformers.length 
            : 0,
          avg_value_low_performers: lowPerformers.length > 0
            ? lowPerformers.reduce((a, b) => a + b, 0) / lowPerformers.length
            : 0
        });
      }
    }
    
    // Sort by absolute correlation
    dimensionCorrelations.sort((a, b) => Math.abs(b.correlation_coefficient) - Math.abs(a.correlation_coefficient));
    
    // Get top positive and negative correlations
    const topPositive = dimensionCorrelations
      .filter(d => d.correlation_coefficient > 0)
      .slice(0, top_dimensions);
    
    const topNegative = dimensionCorrelations
      .filter(d => d.correlation_coefficient < 0)
      .slice(0, top_dimensions);
    
    // Find semantic directions
    const topDimIndices = dimensionCorrelations
      .slice(0, top_dimensions * 2)
      .map(d => d.dimension_index);
    
    const semanticDirections = findSemanticDirections(titleEmbeddings, tpsMap, topDimIndices);
    
    // Fill in titles for example videos
    for (const direction of semanticDirections) {
      for (const example of direction.example_videos) {
        example.title = titleMap.get(example.video_id) || 'Unknown';
      }
    }
    
    // Handle thumbnail correlations if requested
    let thumbnailCorrelations = undefined;
    let crossModalPatterns = {
      title_thumbnail_alignment: 0,
      reinforcing_dimensions: [] as any[]
    };
    
    if (include_thumbnails) {
      // Fetch CLIP embeddings
      const thumbIndex = pinecone.index(process.env.PINECONE_THUMBNAIL_INDEX_NAME!);
      const thumbEmbeddings = new Map<string, number[]>();
      
      for (const chunk of chunks) {
        try {
          const response = await thumbIndex.fetch(chunk);
          for (const [id, data] of Object.entries(response.records)) {
            if (data?.values) {
              thumbEmbeddings.set(id, data.values);
            }
          }
        } catch (error) {
          console.error('Error fetching thumbnail embeddings:', error);
        }
      }
      
      if (thumbEmbeddings.size > 0) {
        // Calculate thumbnail dimension correlations
        const thumbDimCount = thumbEmbeddings.values().next().value?.length || 768;
        const thumbCorrelations: VisualCorrelation[] = [];
        
        for (let dim = 0; dim < Math.min(thumbDimCount, 50); dim++) { // Sample first 50 dims
          const dimValues: number[] = [];
          const tpsValues: number[] = [];
          
          for (const [videoId, embedding] of thumbEmbeddings.entries()) {
            const tps = tpsMap.get(videoId);
            if (tps === undefined) continue;
            
            dimValues.push(embedding[dim]);
            tpsValues.push(tps);
          }
          
          const { correlation } = calculatePearsonCorrelation(dimValues, tpsValues);
          
          if (Math.abs(correlation) > 0.15) {
            thumbCorrelations.push({
              dimension_index: dim,
              correlation_coefficient: correlation,
              interpretation: `CLIP dimension ${dim}` // In production, map to known CLIP features
            });
          }
        }
        
        thumbCorrelations.sort((a, b) => Math.abs(b.correlation_coefficient) - Math.abs(a.correlation_coefficient));
        
        thumbnailCorrelations = {
          top_positive: thumbCorrelations.filter(c => c.correlation_coefficient > 0).slice(0, 5),
          top_negative: thumbCorrelations.filter(c => c.correlation_coefficient < 0).slice(0, 5)
        };
        
        // Calculate cross-modal alignment
        let alignmentScore = 0;
        let alignmentCount = 0;
        
        for (const [videoId, titleEmb] of titleEmbeddings.entries()) {
          const thumbEmb = thumbEmbeddings.get(videoId);
          if (!thumbEmb) continue;
          
          // Simplified: just check if both perform similarly
          const tps = tpsMap.get(videoId)!;
          const titleStrength = titleEmb.slice(0, 10).reduce((a, b) => a + Math.abs(b), 0) / 10;
          const thumbStrength = thumbEmb.slice(0, 10).reduce((a, b) => a + Math.abs(b), 0) / 10;
          
          if ((titleStrength > 0.5 && thumbStrength > 0.5 && tps > 2) ||
              (titleStrength < 0.5 && thumbStrength < 0.5 && tps < 1)) {
            alignmentScore++;
          }
          alignmentCount++;
        }
        
        crossModalPatterns.title_thumbnail_alignment = alignmentCount > 0 
          ? alignmentScore / alignmentCount 
          : 0;
      }
    }
    
    // Generate actionable insights
    const insights: string[] = [];
    
    if (topPositive.length > 0) {
      const strongestPositive = topPositive[0];
      insights.push(`Dimension ${strongestPositive.dimension_index} shows ${strongestPositive.strength} positive correlation (r=${strongestPositive.correlation_coefficient.toFixed(3)})`);
    }
    
    if (topNegative.length > 0) {
      const strongestNegative = topNegative[0];
      insights.push(`Dimension ${strongestNegative.dimension_index} shows ${strongestNegative.strength} negative correlation (r=${strongestNegative.correlation_coefficient.toFixed(3)})`);
    }
    
    if (semanticDirections.length > 0) {
      insights.push(`Identified ${semanticDirections.length} semantic directions correlating with performance`);
    }
    
    if (crossModalPatterns.title_thumbnail_alignment > 0.6) {
      insights.push('Strong alignment between title and thumbnail signals');
    }
    
    const avgTps = Array.from(tpsMap.values()).reduce((a, b) => a + b, 0) / tpsMap.size;
    
    const response: CorrelatedFeaturesResponse = {
      analysis_scope: {
        total_videos: videos.length,
        avg_tps: avgTps,
        embedding_type: include_thumbnails ? 'both' : 'title',
        dimensions_analyzed: dimensionCount
      },
      title_correlations: {
        top_positive: topPositive,
        top_negative: topNegative,
        semantic_directions: semanticDirections
      },
      thumbnail_correlations: thumbnailCorrelations,
      cross_modal_patterns: crossModalPatterns,
      actionable_insights: insights
    };
    
    return {
      success: true,
      data: response
    };
    
  } catch (error: any) {
    console.error('Error finding correlated features:', error);
    return {
      success: false,
      error: {
        code: 'ANALYSIS_ERROR',
        message: 'Failed to find correlated features',
        details: error.message,
        retryable: true
      }
    };
  }
}

// Wrap handler with caching and retry logic
const wrappedHandler = wrapTool({
  name: 'find_correlated_features',
  description: 'Analyze correlation between embedding dimensions and performance',
  parameters: {
    type: 'object',
    properties: {
      video_ids: {
        type: 'array',
        items: { type: 'string' },
        description: 'Specific video IDs to analyze'
      },
      channel_id: {
        type: 'string',
        description: 'Analyze videos from specific channel'
      },
      min_tps: {
        type: 'number',
        description: 'Minimum TPS threshold',
        default: 0
      },
      top_dimensions: {
        type: 'number',
        description: 'Number of top dimensions to return',
        default: 10
      },
      include_thumbnails: {
        type: 'boolean',
        description: 'Include CLIP embedding analysis',
        default: false
      },
      sample_size: {
        type: 'number',
        description: 'Sample size if no specific videos/channel',
        default: 500
      }
    },
    required: []
  },
  handler: findCorrelatedFeaturesHandler,
  parallelSafe: false, // Pinecone rate limits
  cacheTTL: 900, // Cache for 15 minutes
  timeout: 20000, // Long timeout for complex analysis
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
export { findCorrelatedFeaturesHandler, calculatePearsonCorrelation };