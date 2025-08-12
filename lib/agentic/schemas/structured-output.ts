/**
 * Structured Output Enforcement for Idea Heist Agentic Mode
 * Ensures all model outputs conform to expected schemas
 */

import { z } from 'zod';
import { FinalPatternReportSchema, repairPatternReport } from './pattern-report';

/**
 * Tool call request schema
 */
export const ToolCallRequestSchema = z.object({
  tool: z.string().describe('Tool name to call'),
  parameters: z.record(z.any()).describe('Tool parameters'),
  reasoning: z.string().optional().describe('Why this tool is being called')
});

/**
 * Validation result schema
 */
export const ValidationResultSchema = z.object({
  videoId: z.string(),
  validated: z.boolean(),
  confidence: z.number().min(0).max(1),
  reasoning: z.string(),
  patternType: z.string().optional(),
  patternStrength: z.number().min(0).max(1).optional()
});

/**
 * Batch validation response schema
 */
export const BatchValidationSchema = z.object({
  results: z.array(ValidationResultSchema),
  summary: z.object({
    totalValidated: z.number(),
    totalRejected: z.number(),
    averageConfidence: z.number(),
    strongestPattern: z.string().optional()
  })
});

/**
 * Hypothesis generation schema
 */
export const HypothesisSchema = z.object({
  statement: z.string().describe('Clear hypothesis statement'),
  confidence: z.number().min(0).max(1).describe('Initial confidence'),
  reasoning: z.string().describe('Supporting reasoning'),
  testableWith: z.array(z.string()).describe('Tools that can test this'),
  expectedEvidence: z.number().min(1).describe('Minimum evidence needed')
});

/**
 * Turn planning schema
 */
export const TurnPlanSchema = z.object({
  nextTurn: z.enum([
    'context_gathering',
    'hypothesis_generation', 
    'search_planning',
    'enrichment',
    'validation',
    'finalization'
  ]),
  toolsToCall: z.array(z.string()),
  parallelizable: z.boolean(),
  estimatedTokens: z.number(),
  reasoning: z.string()
});

/**
 * Search strategy schema
 */
export const SearchStrategySchema = z.object({
  queries: z.array(z.object({
    type: z.enum(['title', 'summary', 'thumbnail']),
    query: z.string(),
    filters: z.record(z.any()).optional()
  })),
  expectedCandidates: z.number(),
  fanoutRound: z.number(),
  stopCondition: z.string()
});

/**
 * State update schema for model switching
 */
export const StateUpdateSchema = z.object({
  videoContext: z.object({
    title: z.string(),
    tps: z.number(),
    channelName: z.string(),
    formatType: z.string().optional(),
    topicNiche: z.string().optional()
  }).optional(),
  
  hypothesis: z.object({
    statement: z.string(),
    confidence: z.number(),
    supportingEvidence: z.array(z.string())
  }).optional(),
  
  searchSummary: z.object({
    totalCandidates: z.number(),
    semanticNeighbors: z.number(),
    competitiveSuccesses: z.number()
  }).optional(),
  
  validationSummary: z.object({
    validated: z.number(),
    rejected: z.number(),
    strongestPattern: z.string().optional()
  }).optional()
});

/**
 * Generic structured output enforcer
 */
export class StructuredOutputEnforcer {
  /**
   * Parse and validate JSON from model output
   */
  static parseJSON(text: string): any {
    // Extract JSON from markdown code blocks if present
    const jsonMatch = text.match(/```json\n?([\s\S]*?)\n?```/);
    const jsonText = jsonMatch ? jsonMatch[1] : text;
    
    try {
      return JSON.parse(jsonText.trim());
    } catch (error) {
      // Try to fix common JSON issues
      let fixed = jsonText
        .replace(/,\s*}/g, '}')  // Remove trailing commas
        .replace(/,\s*]/g, ']')  // Remove trailing commas in arrays
        .replace(/'/g, '"')      // Single to double quotes
        .replace(/(\w+):/g, '"$1":'); // Quote unquoted keys
      
      try {
        return JSON.parse(fixed);
      } catch {
        throw new Error(`Failed to parse JSON: ${error}`);
      }
    }
  }
  
  /**
   * Enforce schema on model output
   */
  static enforce<T>(
    output: string,
    schema: z.ZodSchema<T>,
    repair?: (data: any) => T
  ): T {
    // Parse JSON
    const parsed = this.parseJSON(output);
    
    // Try direct validation
    try {
      return schema.parse(parsed);
    } catch (error) {
      // Try repair if available
      if (repair) {
        try {
          const repaired = repair(parsed);
          return schema.parse(repaired);
        } catch (repairError) {
          console.error('Repair failed:', repairError);
        }
      }
      
      // Log validation errors for debugging
      if (error instanceof z.ZodError) {
        console.error('Schema validation failed:', error.errors);
      }
      
      throw error;
    }
  }
  
  /**
   * Enforce tool call request
   */
  static enforceToolCall(output: string): z.infer<typeof ToolCallRequestSchema> {
    return this.enforce(output, ToolCallRequestSchema);
  }
  
  /**
   * Enforce batch validation
   */
  static enforceBatchValidation(output: string): z.infer<typeof BatchValidationSchema> {
    return this.enforce(output, BatchValidationSchema, (data) => {
      // Repair common issues
      if (!data.results) data.results = [];
      if (!data.summary) {
        data.summary = {
          totalValidated: data.results.filter((r: any) => r.validated).length,
          totalRejected: data.results.filter((r: any) => !r.validated).length,
          averageConfidence: 0,
          strongestPattern: undefined
        };
      }
      return data;
    });
  }
  
  /**
   * Enforce hypothesis generation
   */
  static enforceHypothesis(output: string): z.infer<typeof HypothesisSchema> {
    return this.enforce(output, HypothesisSchema, (data) => {
      // Repair common issues with hypothesis structure
      if (!data.reasoning && data.supportingEvidence) {
        data.reasoning = Array.isArray(data.supportingEvidence) 
          ? data.supportingEvidence.join('. ') 
          : String(data.supportingEvidence);
      }
      if (!data.reasoning) {
        data.reasoning = `Hypothesis based on video performance analysis`;
      }
      if (!data.expectedEvidence || typeof data.expectedEvidence !== 'number') {
        data.expectedEvidence = data.testableWith?.length || 3;
      }
      if (!data.testableWith) {
        data.testableWith = ['get_video_bundle', 'search_titles', 'perf_snapshot'];
      }
      return data;
    });
  }
  
  /**
   * Enforce turn planning
   */
  static enforceTurnPlan(output: string): z.infer<typeof TurnPlanSchema> {
    return this.enforce(output, TurnPlanSchema);
  }
  
  /**
   * Enforce search strategy
   */
  static enforceSearchStrategy(output: string): z.infer<typeof SearchStrategySchema> {
    return this.enforce(output, SearchStrategySchema);
  }
  
  /**
   * Enforce state update
   */
  static enforceStateUpdate(output: string): z.infer<typeof StateUpdateSchema> {
    return this.enforce(output, StateUpdateSchema);
  }
  
  /**
   * Enforce final pattern report
   */
  static enforceFinalReport(output: string): z.infer<typeof FinalPatternReportSchema> {
    return this.enforce(output, FinalPatternReportSchema, repairPatternReport);
  }
}

/**
 * Response formatter for consistent JSON output
 */
export class ResponseFormatter {
  /**
   * Format tool calls for model consumption
   */
  static formatToolCalls(calls: Array<{ tool: string; result: any }>): string {
    return JSON.stringify({
      toolCalls: calls.map(c => ({
        tool: c.tool,
        success: true,
        result: c.result
      }))
    }, null, 2);
  }
  
  /**
   * Format state for model switching
   */
  static formatStateForSwitch(state: any): string {
    const summary = {
      videoContext: state.videoContext,
      hypothesis: state.hypothesis ? {
        statement: state.hypothesis.statement,
        confidence: state.hypothesis.confidence
      } : null,
      searchProgress: {
        totalCandidates: state.searchResults?.totalCandidates || 0,
        fanoutsCompleted: state.searchResults?.fanouts || 0
      },
      validationProgress: {
        validated: state.validationResults?.validated || 0,
        rejected: state.validationResults?.rejected || 0
      },
      toolCallsSoFar: state.toolCalls?.length || 0
    };
    
    return JSON.stringify(summary, null, 2);
  }
  
  /**
   * Format error for model
   */
  static formatError(error: any): string {
    return JSON.stringify({
      error: true,
      message: error.message || 'Unknown error',
      retryable: error.retryable !== false,
      suggestion: error.suggestion || 'Try a different approach'
    }, null, 2);
  }
}

/**
 * Export all schemas for external use
 */
export const Schemas = {
  ToolCallRequest: ToolCallRequestSchema,
  ValidationResult: ValidationResultSchema,
  BatchValidation: BatchValidationSchema,
  Hypothesis: HypothesisSchema,
  TurnPlan: TurnPlanSchema,
  SearchStrategy: SearchStrategySchema,
  StateUpdate: StateUpdateSchema,
  FinalPatternReport: FinalPatternReportSchema
};

/**
 * Type exports
 */
export type ToolCallRequest = z.infer<typeof ToolCallRequestSchema>;
export type ValidationResult = z.infer<typeof ValidationResultSchema>;
export type BatchValidation = z.infer<typeof BatchValidationSchema>;
export type Hypothesis = z.infer<typeof HypothesisSchema>;
export type TurnPlan = z.infer<typeof TurnPlanSchema>;
export type SearchStrategy = z.infer<typeof SearchStrategySchema>;
export type StateUpdate = z.infer<typeof StateUpdateSchema>;