/**
 * Structured Pattern Output Schema
 * Implements OpenAI's recommended format for consistent UI rendering
 */

import { z } from 'zod';

/**
 * Block types for different pattern sections
 */
export enum BlockType {
  TITLE_PATTERNS = 'TITLE_PATTERNS',
  THUMB_PATTERNS = 'THUMB_PATTERNS', 
  OUTLIERS = 'OUTLIERS',
  CHECKLIST = 'CHECKLIST',
  METRICS = 'METRICS',
  RECOMMENDATIONS = 'RECOMMENDATIONS'
}

/**
 * Pattern data structure
 */
export const PatternDataSchema = z.object({
  id: z.string(),
  statement: z.string(),
  confidence: z.number().min(0).max(1),
  evidence: z.array(z.object({
    videoId: z.string(),
    title: z.string(),
    performance: z.number(),
    relevance: z.number()
  })),
  impact: z.string().optional()
});

/**
 * Outlier video data
 */
export const OutlierVideoSchema = z.object({
  id: z.string(),
  title: z.string(),
  channel: z.string(),
  views: z.number(),
  performance: z.number(),
  thumbnail: z.string().optional(),
  publishedAt: z.string(),
  outlierReason: z.string()
});

/**
 * Checklist item
 */
export const ChecklistItemSchema = z.object({
  id: z.string(),
  action: z.string(),
  priority: z.enum(['immediate', 'high', 'medium', 'low']),
  impact: z.string(),
  confidence: z.number()
});

/**
 * Block data structure
 */
export const BlockSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal(BlockType.TITLE_PATTERNS),
    data: z.object({
      patterns: z.array(PatternDataSchema)
    })
  }),
  z.object({
    type: z.literal(BlockType.THUMB_PATTERNS),
    data: z.object({
      patterns: z.array(PatternDataSchema)
    })
  }),
  z.object({
    type: z.literal(BlockType.OUTLIERS),
    data: z.object({
      videos: z.array(OutlierVideoSchema)
    })
  }),
  z.object({
    type: z.literal(BlockType.CHECKLIST),
    data: z.object({
      items: z.array(ChecklistItemSchema)
    })
  }),
  z.object({
    type: z.literal(BlockType.METRICS),
    data: z.object({
      totalAnalyzed: z.number(),
      patternsFound: z.number(),
      avgConfidence: z.number(),
      processingTime: z.number()
    })
  }),
  z.object({
    type: z.literal(BlockType.RECOMMENDATIONS),
    data: z.object({
      recommendations: z.array(z.object({
        title: z.string(),
        description: z.string(),
        expectedImpact: z.string(),
        confidence: z.number()
      }))
    })
  })
]);

/**
 * Main structured pattern page schema
 */
export const PatternPageSchema = z.object({
  version: z.literal('1.0'),
  summary_md: z.string(),
  blocks: z.array(BlockSchema),
  source_ids: z.array(z.string()),
  meta: z.object({
    run_id: z.string().optional(),
    run_time_ms: z.number(),
    tools_used: z.array(z.string()),
    total_tokens: z.number().optional(),
    total_cost: z.number().optional(),
    generator: z.string().optional(),
    log_file: z.string().optional()
  })
});

export type PatternPage = z.infer<typeof PatternPageSchema>;
export type Block = z.infer<typeof BlockSchema>;
export type PatternData = z.infer<typeof PatternDataSchema>;
export type OutlierVideo = z.infer<typeof OutlierVideoSchema>;
export type ChecklistItem = z.infer<typeof ChecklistItemSchema>;

/**
 * Convert agent result to structured pattern page
 */
export function createPatternPage(
  result: any,
  runId?: string,
  logFile?: string
): PatternPage {
  const blocks: Block[] = [];
  
  // Extract title patterns
  if (result.pattern?.evidence) {
    const titlePatterns = result.pattern.evidence
      .filter((e: any) => e.type === 'title' || e.category === 'title')
      .map((e: any) => ({
        id: e.videoId || `pattern_${Date.now()}`,
        statement: e.excerpt || e.statement || 'Title pattern detected',
        confidence: e.relevance || 0.75,
        evidence: [{
          videoId: e.videoId,
          title: e.title,
          performance: e.tps || 1.0,
          relevance: e.relevance || 0.75
        }],
        impact: e.impact
      }));
    
    if (titlePatterns.length > 0) {
      blocks.push({
        type: BlockType.TITLE_PATTERNS,
        data: { patterns: titlePatterns }
      });
    }
  }
  
  // Extract thumbnail patterns
  if (result.pattern?.evidence) {
    const thumbPatterns = result.pattern.evidence
      .filter((e: any) => e.type === 'thumbnail' || e.category === 'thumbnail')
      .map((e: any) => ({
        id: e.videoId || `pattern_${Date.now()}`,
        statement: e.excerpt || e.statement || 'Thumbnail pattern detected',
        confidence: e.relevance || 0.75,
        evidence: [{
          videoId: e.videoId,
          title: e.title,
          performance: e.tps || 1.0,
          relevance: e.relevance || 0.75
        }],
        impact: e.impact
      }));
    
    if (thumbPatterns.length > 0) {
      blocks.push({
        type: BlockType.THUMB_PATTERNS,
        data: { patterns: thumbPatterns }
      });
    }
  }
  
  // Extract outlier videos
  if (result.validation?.results) {
    const outliers = result.validation.results
      .flatMap((r: any) => r.videos || [])
      .filter((v: any) => v.score > 2.0)
      .map((v: any) => ({
        id: v.id,
        title: v.title,
        channel: v.channel,
        views: v.views || 0,
        performance: v.score,
        thumbnail: v.thumbnail,
        publishedAt: v.published_at || new Date().toISOString(),
        outlierReason: `${v.score}x baseline performance`
      }));
    
    if (outliers.length > 0) {
      blocks.push({
        type: BlockType.OUTLIERS,
        data: { videos: outliers }
      });
    }
  }
  
  // Extract recommendations as checklist
  if (result.debug?.recommendations) {
    const checklist = result.debug.recommendations.map((rec: any, idx: number) => ({
      id: `rec_${idx}`,
      action: rec.action || rec.title || rec,
      priority: rec.priority || 'medium',
      impact: rec.expectedImpact || rec.impact || 'Potential improvement',
      confidence: rec.confidence || 0.7
    }));
    
    blocks.push({
      type: BlockType.CHECKLIST,
      data: { items: checklist }
    });
  }
  
  // Add metrics block
  if (result.metrics || result.budgetUsage) {
    blocks.push({
      type: BlockType.METRICS,
      data: {
        totalAnalyzed: result.metrics?.videosAnalyzed || 0,
        patternsFound: result.metrics?.patternsFound || 1,
        avgConfidence: result.pattern?.confidence || 0.75,
        processingTime: result.metrics?.totalDuration || 0
      }
    });
  }
  
  // Build source IDs
  const sourceIds = [];
  if (result.pattern?.evidence) {
    sourceIds.push(...result.pattern.evidence.map((e: any) => `yt:${e.videoId}`));
  }
  if (result.source_video?.id) {
    sourceIds.push(`yt:${result.source_video.id}`);
  }
  
  return {
    version: '1.0',
    summary_md: result.pattern?.pattern_name || result.pattern?.statement || 'Pattern analysis complete',
    blocks,
    source_ids: [...new Set(sourceIds)], // Remove duplicates
    meta: {
      run_id: runId,
      run_time_ms: result.metrics?.totalDuration || 0,
      tools_used: ['db', 'pinecone', 'youtube'],
      total_tokens: result.budgetUsage?.tokens,
      total_cost: result.budgetUsage?.totalCost,
      generator: 'idea-heist-agent-v2',
      log_file: logFile
    }
  };
}

/**
 * Validate and repair pattern page
 */
export function validatePatternPage(data: any): PatternPage {
  try {
    return PatternPageSchema.parse(data);
  } catch (error) {
    console.warn('Pattern page validation failed, attempting repair:', error);
    
    // Attempt to repair
    const repaired: PatternPage = {
      version: '1.0',
      summary_md: data?.summary_md || 'Analysis complete',
      blocks: [],
      source_ids: data?.source_ids || [],
      meta: {
        run_time_ms: data?.meta?.run_time_ms || 0,
        tools_used: data?.meta?.tools_used || [],
        ...data?.meta
      }
    };
    
    // Try to salvage blocks
    if (Array.isArray(data?.blocks)) {
      for (const block of data.blocks) {
        try {
          const validBlock = BlockSchema.parse(block);
          repaired.blocks.push(validBlock);
        } catch {
          console.warn('Skipping invalid block:', block);
        }
      }
    }
    
    return repaired;
  }
}

/**
 * Create minimal valid pattern page (for errors/fallbacks)
 */
export function createMinimalPatternPage(
  message: string,
  error?: string
): PatternPage {
  return {
    version: '1.0',
    summary_md: message,
    blocks: error ? [
      {
        type: BlockType.CHECKLIST,
        data: {
          items: [{
            id: 'error_1',
            action: 'Review error and retry analysis',
            priority: 'immediate',
            impact: error,
            confidence: 1.0
          }]
        }
      }
    ] : [],
    source_ids: [],
    meta: {
      run_time_ms: 0,
      tools_used: [],
      generator: 'error-fallback'
    }
  };
}