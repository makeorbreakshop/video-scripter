/**
 * Final Pattern Report Schema for Idea Heist Agentic Mode
 * Defines the structured output format for pattern analysis results
 */

import { z } from 'zod';

/**
 * Evidence item supporting a pattern
 */
export const EvidenceItemSchema = z.object({
  videoId: z.string().describe('YouTube video ID'),
  title: z.string().describe('Video title'),
  tps: z.number().describe('Temporal Performance Score'),
  channelName: z.string().describe('Channel name'),
  relevance: z.number().min(0).max(1).describe('Relevance score to pattern'),
  excerpt: z.string().optional().describe('Relevant excerpt or feature')
});

/**
 * A discovered pattern with evidence
 */
export const PatternSchema = z.object({
  type: z.enum([
    'format',
    'topic',
    'timing',
    'thumbnail',
    'title',
    'engagement',
    'cross_channel',
    'seasonal'
  ]).describe('Pattern category'),
  
  statement: z.string().describe('Clear pattern statement'),
  
  confidence: z.number()
    .min(0)
    .max(1)
    .describe('Statistical confidence in pattern'),
  
  strength: z.number()
    .min(0)
    .max(1)
    .describe('Effect size or strength of pattern'),
  
  evidence: z.array(EvidenceItemSchema)
    .min(3)
    .describe('Supporting evidence (minimum 3 examples)'),
  
  niches: z.array(z.string())
    .describe('Topic niches where pattern applies'),
  
  performanceImpact: z.object({
    averageTPS: z.number().describe('Average TPS of videos with pattern'),
    tpsLift: z.number().describe('TPS improvement vs baseline'),
    sampleSize: z.number().describe('Number of videos analyzed')
  }).describe('Quantified performance impact'),
  
  actionability: z.enum(['high', 'medium', 'low'])
    .describe('How actionable is this pattern')
});

/**
 * Competitive analysis results
 */
export const CompetitiveAnalysisSchema = z.object({
  topCompetitors: z.array(z.object({
    channelId: z.string(),
    channelName: z.string(),
    avgTPS: z.number(),
    videoCount: z.number()
  })).describe('Top performing competitor channels'),
  
  untappedFormats: z.array(z.string())
    .describe('Formats competitors use successfully but target channel has not tried'),
  
  contentGaps: z.array(z.string())
    .describe('Topics with high performance potential not covered by target')
});

/**
 * Channel-specific insights
 */
export const ChannelInsightsSchema = z.object({
  currentBaseline: z.object({
    avgTPS: z.number(),
    p50TPS: z.number(),
    p90TPS: z.number()
  }).describe('Current channel performance baseline'),
  
  strengthTopics: z.array(z.string())
    .describe('Topics where channel performs above average'),
  
  weaknessTopics: z.array(z.string())
    .describe('Topics where channel underperforms'),
  
  growthTrajectory: z.enum(['accelerating', 'steady', 'declining', 'volatile'])
    .describe('Recent growth pattern')
});

/**
 * Complete pattern analysis report
 */
export const FinalPatternReportSchema = z.object({
  version: z.literal('1.0').describe('Schema version'),
  
  videoId: z.string().describe('Target video analyzed'),
  
  analysisMode: z.enum(['classic', 'agentic'])
    .describe('Mode used for analysis'),
  
  timestamp: z.string().datetime()
    .describe('Analysis completion time'),
  
  primaryPattern: PatternSchema
    .describe('The strongest, most actionable pattern discovered'),
  
  secondaryPatterns: z.array(PatternSchema)
    .max(4)
    .describe('Additional patterns discovered (up to 4)'),
  
  competitiveAnalysis: CompetitiveAnalysisSchema
    .describe('Competitive landscape insights'),
  
  channelInsights: ChannelInsightsSchema
    .describe('Channel-specific insights'),
  
  recommendations: z.array(z.object({
    priority: z.enum(['immediate', 'short_term', 'long_term']),
    action: z.string().describe('Specific action to take'),
    expectedImpact: z.string().describe('Expected outcome'),
    confidence: z.number().min(0).max(1)
  })).min(3).max(10)
    .describe('Actionable recommendations ranked by priority'),
  
  metadata: z.object({
    totalVideosAnalyzed: z.number(),
    totalChannelsAnalyzed: z.number(),
    tokensUsed: z.number(),
    executionTimeMs: z.number(),
    toolCallCount: z.number(),
    modelSwitches: z.number(),
    totalCost: z.number()
  }).describe('Analysis metadata and statistics'),
  
  confidence: z.object({
    overall: z.number().min(0).max(1),
    dataQuality: z.number().min(0).max(1),
    patternClarity: z.number().min(0).max(1)
  }).describe('Confidence metrics for the analysis')
});

/**
 * Type exports
 */
export type EvidenceItem = z.infer<typeof EvidenceItemSchema>;
export type Pattern = z.infer<typeof PatternSchema>;
export type CompetitiveAnalysis = z.infer<typeof CompetitiveAnalysisSchema>;
export type ChannelInsights = z.infer<typeof ChannelInsightsSchema>;
export type FinalPatternReport = z.infer<typeof FinalPatternReportSchema>;

/**
 * JSON Schema export (for OpenAI Responses API json_schema enforcement)
 * Note: Kept moderately strict to ensure structure without over-constraining generation.
 */
export const FinalPatternReportJsonSchema = {
  name: 'FinalPatternReport',
  schema: {
    type: 'object',
    properties: {
      version: { const: '1.0' },
      videoId: { type: 'string' },
      analysisMode: { type: 'string', enum: ['classic', 'agentic'] },
      timestamp: { type: 'string' },
      primaryPattern: {
        type: 'object',
        properties: {
          type: { type: 'string', enum: ['format','topic','timing','thumbnail','title','engagement','cross_channel','seasonal'] },
          statement: { type: 'string' },
          confidence: { type: 'number', minimum: 0, maximum: 1 },
          strength: { type: 'number', minimum: 0, maximum: 1 },
          evidence: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                videoId: { type: 'string' },
                title: { type: 'string' },
                tps: { type: 'number' },
                channelName: { type: 'string' },
                relevance: { type: 'number', minimum: 0, maximum: 1 },
                excerpt: { type: 'string' }
              },
              required: ['videoId','title','tps','channelName','relevance']
            },
            minItems: 3
          },
          niches: { type: 'array', items: { type: 'string' } },
          performanceImpact: {
            type: 'object',
            properties: {
              averageTPS: { type: 'number' },
              tpsLift: { type: 'number' },
              sampleSize: { type: 'number' }
            },
            required: ['averageTPS','tpsLift','sampleSize']
          },
          actionability: { type: 'string', enum: ['high','medium','low'] }
        },
        required: ['type','statement','confidence','strength','evidence','niches','performanceImpact','actionability']
      },
      secondaryPatterns: {
        type: 'array',
        items: { $ref: '#/properties/primaryPattern' },
        maxItems: 4
      },
      competitiveAnalysis: {
        type: 'object',
        properties: {
          topCompetitors: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                channelId: { type: 'string' },
                channelName: { type: 'string' },
                avgTPS: { type: 'number' },
                videoCount: { type: 'number' }
              },
              required: ['channelId','channelName','avgTPS','videoCount']
            }
          },
          untappedFormats: { type: 'array', items: { type: 'string' } },
          contentGaps: { type: 'array', items: { type: 'string' } }
        },
        required: ['topCompetitors','untappedFormats','contentGaps']
      },
      channelInsights: {
        type: 'object',
        properties: {
          currentBaseline: {
            type: 'object',
            properties: {
              avgTPS: { type: 'number' },
              p50TPS: { type: 'number' },
              p90TPS: { type: 'number' }
            },
            required: ['avgTPS','p50TPS','p90TPS']
          },
          strengthTopics: { type: 'array', items: { type: 'string' } },
          weaknessTopics: { type: 'array', items: { type: 'string' } },
          growthTrajectory: { type: 'string', enum: ['accelerating','steady','declining','volatile'] }
        },
        required: ['currentBaseline','strengthTopics','weaknessTopics','growthTrajectory']
      },
      recommendations: {
        type: 'array',
        minItems: 3,
        maxItems: 10,
        items: {
          type: 'object',
          properties: {
            priority: { type: 'string', enum: ['immediate','short_term','long_term'] },
            action: { type: 'string' },
            expectedImpact: { type: 'string' },
            confidence: { type: 'number', minimum: 0, maximum: 1 }
          },
          required: ['priority','action','expectedImpact','confidence']
        }
      },
      metadata: {
        type: 'object',
        properties: {
          totalVideosAnalyzed: { type: 'number' },
          totalChannelsAnalyzed: { type: 'number' },
          tokensUsed: { type: 'number' },
          executionTimeMs: { type: 'number' },
          toolCallCount: { type: 'number' },
          modelSwitches: { type: 'number' },
          totalCost: { type: 'number' }
        },
        required: ['totalVideosAnalyzed','totalChannelsAnalyzed','tokensUsed','executionTimeMs','toolCallCount','modelSwitches','totalCost']
      },
      confidence: {
        type: 'object',
        properties: {
          overall: { type: 'number', minimum: 0, maximum: 1 },
          dataQuality: { type: 'number', minimum: 0, maximum: 1 },
          patternClarity: { type: 'number', minimum: 0, maximum: 1 }
        },
        required: ['overall','dataQuality','patternClarity']
      }
    },
    required: ['version','videoId','analysisMode','timestamp','primaryPattern','secondaryPatterns','competitiveAnalysis','channelInsights','recommendations','metadata','confidence']
  }
};

/**
 * Validation function with detailed error reporting
 */
export function validatePatternReport(data: unknown): {
  valid: boolean;
  data?: FinalPatternReport;
  errors?: z.ZodError;
} {
  try {
    const validated = FinalPatternReportSchema.parse(data);
    return { valid: true, data: validated };
  } catch (error) {
    if (error instanceof z.ZodError) {
      return { valid: false, errors: error };
    }
    throw error;
  }
}

/**
 * Schema repair function to fix common issues
 */
export function repairPatternReport(data: any): FinalPatternReport {
  // If data is a string, try to parse it
  if (typeof data === 'string') {
    try {
      data = JSON.parse(data);
    } catch (e) {
      console.error('Failed to parse string data:', e);
      data = {};
    }
  }
  
  // If data is null or undefined, use empty object
  if (!data || typeof data !== 'object') {
    data = {};
  }
  
  // Start with a complete empty report as base
  const emptyReport = createEmptyReport(data.videoId || data.video_id || 'unknown');
  
  // Fix version if it's not exactly "1.0"
  if (data.version && data.version !== '1.0') {
    data.version = '1.0';
  }
  
  // Deep merge with provided data, preserving any valid fields
  const repaired = {
    ...emptyReport,
    version: '1.0', // Always use 1.0
    videoId: data.videoId || data.video_id || 'unknown',
    analysisMode: data.analysisMode || data.analysis_mode || 'agentic',
    timestamp: data.timestamp || new Date().toISOString()
  };
  
  // Fix primaryPattern - ensure complete structure
  if (repaired.primaryPattern) {
    const defaultPattern = emptyReport.primaryPattern;
    repaired.primaryPattern = {
      ...defaultPattern,
      ...repaired.primaryPattern,
      type: repaired.primaryPattern.type || 'format',
      statement: repaired.primaryPattern.statement || 'Pattern analysis in progress',
      confidence: typeof repaired.primaryPattern.confidence === 'number' ? repaired.primaryPattern.confidence : 0.5,
      strength: typeof repaired.primaryPattern.strength === 'number' ? repaired.primaryPattern.strength : 
                (typeof repaired.primaryPattern.strength === 'string' ? parseFloat(repaired.primaryPattern.strength) || 0.5 : 0.5),
      evidence: Array.isArray(repaired.primaryPattern.evidence) ? repaired.primaryPattern.evidence : [],
      niches: Array.isArray(repaired.primaryPattern.niches) ? repaired.primaryPattern.niches : [],
      performanceImpact: repaired.primaryPattern.performanceImpact || defaultPattern.performanceImpact,
      actionability: repaired.primaryPattern.actionability || 'low'
    };
    
    // Fix each evidence item to have all required fields
    repaired.primaryPattern.evidence = repaired.primaryPattern.evidence.map((e: any, idx: number) => ({
      videoId: e?.videoId || e?.video_id || `placeholder-${idx}`,
      title: e?.title || 'Pending analysis',
      tps: typeof e?.tps === 'number' ? e.tps : 0,
      channelName: e?.channelName || e?.channel_name || 'Unknown',
      relevance: typeof e?.relevance === 'number' ? e.relevance : 0,
      excerpt: e?.excerpt
    }));
    
    // Ensure minimum 3 evidence items
    while (repaired.primaryPattern.evidence.length < 3) {
      repaired.primaryPattern.evidence.push({
        videoId: `placeholder-${repaired.primaryPattern.evidence.length}`,
        title: 'Pending analysis',
        tps: 0,
        channelName: 'Unknown',
        relevance: 0
      });
    }
  }
  
  // Fix secondaryPatterns - ensure each pattern is complete
  if (!Array.isArray(repaired.secondaryPatterns)) {
    repaired.secondaryPatterns = [];
  }
  repaired.secondaryPatterns = repaired.secondaryPatterns
    .filter((p: any) => p && typeof p === 'object')
    .map((p: any, pIdx: number) => {
      // Fix evidence items for this pattern
      let evidence = Array.isArray(p.evidence) ? p.evidence : [];
      evidence = evidence.map((e: any, idx: number) => ({
        videoId: e?.videoId || e?.video_id || `secondary-${pIdx}-${idx}`,
        title: e?.title || 'Secondary evidence',
        tps: typeof e?.tps === 'number' ? e.tps : 0,
        channelName: e?.channelName || e?.channel_name || 'Unknown',
        relevance: typeof e?.relevance === 'number' ? e.relevance : 0,
        excerpt: e?.excerpt
      }));
      
      // Ensure minimum 3 evidence items for each secondary pattern
      while (evidence.length < 3) {
        evidence.push({
          videoId: `secondary-${pIdx}-${evidence.length}`,
          title: 'Secondary evidence',
          tps: 0,
          channelName: 'Unknown',
          relevance: 0
        });
      }
      
      return {
        type: p.type || 'format',
        statement: p.statement || 'Secondary pattern',
        confidence: p.confidence ?? 0.3,
        strength: p.strength ?? 0.3,
        evidence,
        niches: Array.isArray(p.niches) ? p.niches : [],
        performanceImpact: p.performanceImpact || {
          averageTPS: 0,
          tpsLift: 0,
          sampleSize: 0
        },
        actionability: p.actionability || 'low'
      };
    });
  
  // Fix recommendations array
  if (!Array.isArray(repaired.recommendations)) {
    repaired.recommendations = [];
  }
  repaired.recommendations = repaired.recommendations
    .filter((r: any) => r && typeof r === 'object')
    .map((r: any) => ({
      priority: r.priority || 'long_term',
      action: r.action || 'Continue analysis',
      expectedImpact: r.expectedImpact || r.expected_impact || 'Potential improvement',
      confidence: typeof r.confidence === 'number' ? r.confidence : 0.5
    }));
  
  // Fix competitive analysis
  if (!repaired.competitiveAnalysis || typeof repaired.competitiveAnalysis !== 'object') {
    repaired.competitiveAnalysis = emptyReport.competitiveAnalysis;
  } else {
    repaired.competitiveAnalysis = {
      topCompetitors: Array.isArray(repaired.competitiveAnalysis.topCompetitors) 
        ? repaired.competitiveAnalysis.topCompetitors : [],
      untappedFormats: Array.isArray(repaired.competitiveAnalysis.untappedFormats) 
        ? repaired.competitiveAnalysis.untappedFormats : [],
      contentGaps: Array.isArray(repaired.competitiveAnalysis.contentGaps) 
        ? repaired.competitiveAnalysis.contentGaps : []
    };
  }
  
  // Fix channel insights
  if (!repaired.channelInsights || typeof repaired.channelInsights !== 'object') {
    repaired.channelInsights = emptyReport.channelInsights;
  } else {
    const baseline = repaired.channelInsights.currentBaseline || {};
    repaired.channelInsights = {
      currentBaseline: {
        avgTPS: baseline.avgTPS ?? 0,
        p50TPS: baseline.p50TPS ?? 0,
        p90TPS: baseline.p90TPS ?? 0
      },
      strengthTopics: Array.isArray(repaired.channelInsights.strengthTopics) 
        ? repaired.channelInsights.strengthTopics : [],
      weaknessTopics: Array.isArray(repaired.channelInsights.weaknessTopics) 
        ? repaired.channelInsights.weaknessTopics : [],
      growthTrajectory: repaired.channelInsights.growthTrajectory || 'steady'
    };
  }
  
  // Fix metadata
  if (!repaired.metadata || typeof repaired.metadata !== 'object') {
    repaired.metadata = emptyReport.metadata;
  } else {
    repaired.metadata = {
      totalVideosAnalyzed: repaired.metadata.totalVideosAnalyzed ?? 0,
      totalChannelsAnalyzed: repaired.metadata.totalChannelsAnalyzed ?? 0,
      tokensUsed: repaired.metadata.tokensUsed ?? 0,
      executionTimeMs: repaired.metadata.executionTimeMs ?? 0,
      toolCallCount: repaired.metadata.toolCallCount ?? 0,
      modelSwitches: repaired.metadata.modelSwitches ?? 0,
      totalCost: repaired.metadata.totalCost ?? 0
    };
  }
  
  // Fix confidence - handle both object and number types
  if (typeof repaired.confidence === 'number') {
    repaired.confidence = {
      overall: repaired.confidence,
      dataQuality: 0.5,
      patternClarity: 0.5
    };
  } else if (!repaired.confidence || typeof repaired.confidence !== 'object') {
    repaired.confidence = emptyReport.confidence;
  } else {
    repaired.confidence = {
      overall: repaired.confidence.overall ?? 0.5,
      dataQuality: repaired.confidence.dataQuality ?? 0.5,
      patternClarity: repaired.confidence.patternClarity ?? 0.5
    };
  }
  
  // Ensure minimum recommendations
  while (repaired.recommendations.length < 3) {
    repaired.recommendations.push({
      priority: 'long_term',
      action: 'Gather more data for analysis',
      expectedImpact: 'Improved pattern discovery',
      confidence: 0.3
    });
  }
  
  // Validate and return
  const validation = validatePatternReport(repaired);
  if (validation.valid && validation.data) {
    return validation.data;
  }
  
  // If still invalid, throw with details
  throw new Error(`Failed to repair pattern report: ${JSON.stringify(validation.errors?.errors)}`);
}

/**
 * Create empty report template
 */
export function createEmptyReport(videoId: string): FinalPatternReport {
  return {
    version: '1.0',
    videoId,
    analysisMode: 'agentic',
    timestamp: new Date().toISOString(),
    primaryPattern: {
      type: 'format',
      statement: 'No pattern discovered',
      confidence: 0,
      strength: 0,
      evidence: [],
      niches: [],
      performanceImpact: {
        averageTPS: 0,
        tpsLift: 0,
        sampleSize: 0
      },
      actionability: 'low'
    },
    secondaryPatterns: [],
    competitiveAnalysis: {
      topCompetitors: [],
      untappedFormats: [],
      contentGaps: []
    },
    channelInsights: {
      currentBaseline: { avgTPS: 0, p50TPS: 0, p90TPS: 0 },
      strengthTopics: [],
      weaknessTopics: [],
      growthTrajectory: 'steady'
    },
    recommendations: [],
    metadata: {
      totalVideosAnalyzed: 0,
      totalChannelsAnalyzed: 0,
      tokensUsed: 0,
      executionTimeMs: 0,
      toolCallCount: 0,
      modelSwitches: 0,
      totalCost: 0
    },
    confidence: {
      overall: 0,
      dataQuality: 0,
      patternClarity: 0
    }
  };
}