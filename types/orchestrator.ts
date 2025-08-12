/**
 * Type definitions for the Idea Heist Agentic Mode Orchestrator
 * Manages tool execution, model routing, and state management
 */

// Model types available for routing
export type ModelType = 'gpt-5' | 'gpt-5-mini' | 'gpt-5-nano';

// Turn types in the analysis flow
export type TurnType = 
  | 'context_gathering'
  | 'hypothesis_generation'
  | 'search_planning'
  | 'enrichment'
  | 'validation'
  | 'finalization';

// Analysis mode
export type AnalysisMode = 'classic' | 'agentic';

// Tool execution status
export type ToolStatus = 'pending' | 'running' | 'success' | 'error' | 'skipped';

/**
 * Budget constraints for the orchestrator
 */
export interface BudgetCaps {
  maxFanouts: number;          // Maximum search rounds
  maxValidations: number;      // Maximum validation batches
  maxCandidates: number;       // Maximum total candidates
  maxTokens: number;           // Maximum tokens across all models
  maxDurationMs: number;       // Maximum execution time
  maxToolCalls: number;        // Maximum total tool calls
}

/**
 * Current budget usage
 */
export interface BudgetUsage {
  fanouts: number;
  validations: number;
  candidates: number;
  tokens: number;
  durationMs: number;
  toolCalls: number;
  costs: {
    gpt5: number;
    gpt5Mini: number;
    gpt5Nano: number;
    total: number;
  };
}

/**
 * Tool definition in the registry
 */
export interface ToolDefinition {
  name: string;
  description: string;
  category: 'context' | 'search' | 'performance' | 'semantic' | 'composite';
  parameters: Record<string, any>; // JSON schema
  handler: (params: any, context: ToolContext) => Promise<any>;
  parallelSafe: boolean;
  cacheable: boolean;
  estimatedLatencyMs: number;
  costEstimate: number;
}

/**
 * Tool execution context
 */
export interface ToolContext {
  sessionId: string;
  requestId: string;
  mode: AnalysisMode;
  currentModel: ModelType;
  budgetRemaining: BudgetUsage;
}

/**
 * Tool call record
 */
export interface ToolCall {
  id: string;
  toolName: string;
  params: any;
  status: ToolStatus;
  startTime: Date;
  endTime?: Date;
  result?: any;
  error?: {
    code: string;
    message: string;
    retryable: boolean;
  };
  durationMs?: number;
  tokensUsed?: number;
}

/**
 * Session state that gets passed between models
 */
export interface SessionState {
  videoId: string;
  videoContext?: {
    title: string;
    tps: number;
    channelName: string;
    formatType?: string;
    topicNiche?: string;
  };
  hypothesis?: {
    statement: string;
    confidence: number;
    supportingEvidence: string[];
  };
  searchResults?: {
    semanticNeighbors: string[];
    competitiveSuccesses: string[];
    totalCandidates: number;
  };
  validationResults?: {
    validated: number;
    rejected: number;
    patterns: Array<{
      type: string;
      strength: number;
      examples: string[];
    }>;
  };
  finalReport?: any; // FinalPatternReport from pattern-report.ts
  toolCalls: ToolCall[];
  errors: Array<{
    timestamp: Date;
    error: string;
    recoverable: boolean;
  }>;
}

/**
 * Orchestrator configuration
 */
export interface OrchestratorConfig {
  mode: AnalysisMode;
  budget: BudgetCaps;
  timeoutMs: number;
  retryAttempts: number;
  fallbackToClassic: boolean;
  parallelExecution: boolean;
  cacheResults: boolean;
  telemetryEnabled: boolean;
}

/**
 * Model routing decision
 */
export interface ModelRoutingDecision {
  model: ModelType;
  reason: string;
  estimatedTokens: number;
  estimatedCost: number;
}

/**
 * Turn execution result
 */
export interface TurnResult {
  turnType: TurnType;
  model: ModelType;
  toolCalls: ToolCall[];
  tokensUsed: number;
  durationMs: number;
  stateUpdate: Partial<SessionState>;
  nextTurn?: TurnType;
  complete: boolean;
}

/**
 * Final orchestrator result
 */
export interface OrchestratorResult {
  success: boolean;
  mode: AnalysisMode;
  fallbackUsed: boolean;
  pattern?: any; // Can be simple or complex pattern structure
  source_video?: any; // Source video details for UI
  validation?: any; // Validation results for UI
  debug?: any; // Debug information
  metrics: {
    totalDurationMs: number;
    totalTokens: number;
    totalCost: number;
    toolCallCount: number;
    modelSwitches: number;
  };
  budgetUsage: BudgetUsage;
  processing_time_ms?: number;
  error?: {
    code: string;
    message: string;
    turn?: TurnType;
    toolCall?: string;
  };
}

/**
 * Tool registry interface
 */
export interface ToolRegistry {
  register(tool: ToolDefinition): void;
  get(name: string): ToolDefinition | undefined;
  list(category?: string): ToolDefinition[];
  getParallelSafe(): ToolDefinition[];
  estimateCost(toolNames: string[]): number;
}

/**
 * Session manager interface
 */
export interface SessionManager {
  createSession(videoId: string, config: OrchestratorConfig): string;
  getSession(sessionId: string): SessionState | undefined;
  updateSession(sessionId: string, update: Partial<SessionState>): void;
  switchModel(sessionId: string, fromModel: ModelType, toModel: ModelType): void;
  endSession(sessionId: string): void;
  recoverSession(sessionId: string): SessionState | undefined;
}

/**
 * Budget tracker interface
 */
export interface BudgetTracker {
  initialize(caps: BudgetCaps): void;
  canExecute(toolName: string, estimatedTokens?: number): boolean;
  recordToolCall(toolName: string, tokensUsed: number, cost: number): void;
  recordValidation(candidateCount: number): boolean;
  recordFanout(): boolean;
  getUsage(): BudgetUsage;
  isExceeded(): boolean;
  getRemainingBudget(): Partial<BudgetCaps>;
}

/**
 * Telemetry event
 */
export interface TelemetryEvent {
  timestamp: Date;
  sessionId: string;
  eventType: 'tool_call' | 'model_switch' | 'error' | 'fallback' | 'completion';
  details: Record<string, any>;
}

// Export for use in orchestrator implementation
export type {
  ModelType as Model,
  TurnType as Turn,
  AnalysisMode as Mode
};