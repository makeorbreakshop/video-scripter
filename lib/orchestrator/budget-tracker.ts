/**
 * Budget Tracker for Idea Heist Agentic Mode
 * Enforces hard limits on tool calls, tokens, and costs
 */

import { BudgetCaps, BudgetUsage, BudgetTracker } from '@/types/orchestrator';

/**
 * Cost estimates per 1K tokens for each model
 */
const TOKEN_COSTS = {
  'gpt-5': 0.015,        // $15 per 1M tokens (estimate)
  'gpt-5-mini': 0.002,   // $2 per 1M tokens (estimate)
  'gpt-5-nano': 0.0005,  // $0.50 per 1M tokens (estimate)
};

/**
 * Implementation of budget tracking with hard limits
 */
export class BudgetTrackerImpl implements BudgetTracker {
  private caps: BudgetCaps;
  private usage: BudgetUsage;
  private startTime: number;

  constructor() {
    // Default caps - will be overridden by initialize()
    this.caps = {
      maxFanouts: 5,
      maxValidations: 20,
      maxCandidates: 200,
      maxTokens: 200000,
      maxDurationMs: 180000,
      maxToolCalls: 100
    };

    this.usage = {
      fanouts: 0,
      validations: 0,
      candidates: 0,
      tokens: 0,
      durationMs: 0,
      toolCalls: 0,
      costs: {
        gpt5: 0,
        gpt5Mini: 0,
        gpt5Nano: 0,
        total: 0
      }
    };

    this.startTime = Date.now();
  }

  /**
   * Initialize with custom budget caps
   */
  initialize(caps: BudgetCaps): void {
    this.caps = { ...caps };
    this.startTime = Date.now();
  }

  /**
   * Check if a tool can be executed within budget
   */
  canExecute(toolName: string, estimatedTokens: number = 0): boolean {
    // Update duration
    this.usage.durationMs = Date.now() - this.startTime;

    // Check time limit
    if (this.usage.durationMs >= this.caps.maxDurationMs) {
      console.warn(`Budget exceeded: duration ${this.usage.durationMs}ms >= ${this.caps.maxDurationMs}ms`);
      return false;
    }

    // Check tool call limit
    if (this.usage.toolCalls >= this.caps.maxToolCalls) {
      console.warn(`Budget exceeded: tool calls ${this.usage.toolCalls} >= ${this.caps.maxToolCalls}`);
      return false;
    }

    // Check token limit
    if (estimatedTokens > 0 && this.usage.tokens + estimatedTokens > this.caps.maxTokens) {
      console.warn(`Budget exceeded: tokens ${this.usage.tokens + estimatedTokens} > ${this.caps.maxTokens}`);
      return false;
    }

    // Special checks for specific tools
    if (toolName.includes('validation') && this.usage.validations >= this.caps.maxValidations) {
      console.warn(`Budget exceeded: validations ${this.usage.validations} >= ${this.caps.maxValidations}`);
      return false;
    }

    if (toolName.includes('search') && this.usage.fanouts >= this.caps.maxFanouts) {
      console.warn(`Budget exceeded: fanouts ${this.usage.fanouts} >= ${this.caps.maxFanouts}`);
      return false;
    }

    return true;
  }

  /**
   * Record a tool call and update usage
   */
  recordToolCall(toolName: string, tokensUsed: number, cost: number): void {
    this.usage.toolCalls++;
    this.usage.tokens += tokensUsed;
    this.usage.costs.total += cost;
    this.usage.durationMs = Date.now() - this.startTime;

    // Track model-specific costs based on token usage patterns
    if (toolName.includes('comprehensive') || toolName.includes('hypothesis')) {
      this.usage.costs.gpt5 += cost * 0.7; // Assume 70% from GPT-5
      this.usage.costs.gpt5Mini += cost * 0.2;
      this.usage.costs.gpt5Nano += cost * 0.1;
    } else if (toolName.includes('validation')) {
      this.usage.costs.gpt5Mini += cost * 0.8; // Mostly GPT-5-mini
      this.usage.costs.gpt5 += cost * 0.2;
    } else {
      this.usage.costs.gpt5Nano += cost * 0.6; // Simple enrichment
      this.usage.costs.gpt5Mini += cost * 0.4;
    }
  }

  /**
   * Record a validation batch
   */
  recordValidation(candidateCount: number): boolean {
    if (this.usage.validations >= this.caps.maxValidations) {
      console.warn(`Validation limit reached: ${this.usage.validations} >= ${this.caps.maxValidations}`);
      return false;
    }

    if (this.usage.candidates + candidateCount > this.caps.maxCandidates) {
      console.warn(`Candidate limit would be exceeded: ${this.usage.candidates + candidateCount} > ${this.caps.maxCandidates}`);
      return false;
    }

    this.usage.validations++;
    this.usage.candidates += candidateCount;
    return true;
  }

  /**
   * Record a search fanout
   */
  recordFanout(): boolean {
    if (this.usage.fanouts >= this.caps.maxFanouts) {
      console.warn(`Fanout limit reached: ${this.usage.fanouts} >= ${this.caps.maxFanouts}`);
      return false;
    }

    this.usage.fanouts++;
    return true;
  }

  /**
   * Get current usage
   */
  getUsage(): BudgetUsage {
    // Update duration
    this.usage.durationMs = Date.now() - this.startTime;
    return { ...this.usage };
  }

  /**
   * Check if any budget limit is exceeded
   */
  isExceeded(): boolean {
    const usage = this.getUsage();
    
    // Debug logging to see which limit is hit
    if (usage.fanouts >= this.caps.maxFanouts) {
      console.log(`[BUDGET] Fanouts exceeded: ${usage.fanouts} >= ${this.caps.maxFanouts}`);
      return true;
    }
    if (usage.validations >= this.caps.maxValidations) {
      console.log(`[BUDGET] Validations exceeded: ${usage.validations} >= ${this.caps.maxValidations}`);
      return true;
    }
    if (usage.candidates >= this.caps.maxCandidates) {
      console.log(`[BUDGET] Candidates exceeded: ${usage.candidates} >= ${this.caps.maxCandidates}`);
      return true;
    }
    if (usage.tokens >= this.caps.maxTokens) {
      console.log(`[BUDGET] Tokens exceeded: ${usage.tokens} >= ${this.caps.maxTokens}`);
      return true;
    }
    if (usage.durationMs >= this.caps.maxDurationMs) {
      console.log(`[BUDGET] Duration exceeded: ${usage.durationMs} >= ${this.caps.maxDurationMs}`);
      return true;
    }
    if (usage.toolCalls >= this.caps.maxToolCalls) {
      console.log(`[BUDGET] Tool calls exceeded: ${usage.toolCalls} >= ${this.caps.maxToolCalls}`);
      return true;
    }
    
    return false;
  }

  /**
   * Get remaining budget
   */
  getRemainingBudget(): Partial<BudgetCaps> {
    const usage = this.getUsage();
    
    return {
      maxFanouts: Math.max(0, this.caps.maxFanouts - usage.fanouts),
      maxValidations: Math.max(0, this.caps.maxValidations - usage.validations),
      maxCandidates: Math.max(0, this.caps.maxCandidates - usage.candidates),
      maxTokens: Math.max(0, this.caps.maxTokens - usage.tokens),
      maxDurationMs: Math.max(0, this.caps.maxDurationMs - usage.durationMs),
      maxToolCalls: Math.max(0, this.caps.maxToolCalls - usage.toolCalls)
    };
  }

  /**
   * Calculate cost for a specific model and token count
   */
  static calculateCost(model: keyof typeof TOKEN_COSTS, tokens: number): number {
    return (tokens / 1000) * TOKEN_COSTS[model];
  }

  /**
   * Get a summary of budget status
   */
  getBudgetSummary(): {
    percentUsed: Record<string, number>;
    criticalResources: string[];
    estimatedCostRemaining: number;
  } {
    const usage = this.getUsage();
    
    const percentUsed = {
      fanouts: (usage.fanouts / this.caps.maxFanouts) * 100,
      validations: (usage.validations / this.caps.maxValidations) * 100,
      candidates: (usage.candidates / this.caps.maxCandidates) * 100,
      tokens: (usage.tokens / this.caps.maxTokens) * 100,
      duration: (usage.durationMs / this.caps.maxDurationMs) * 100,
      toolCalls: (usage.toolCalls / this.caps.maxToolCalls) * 100
    };

    const criticalResources = Object.entries(percentUsed)
      .filter(([_, percent]) => percent >= 80)
      .map(([resource]) => resource);

    // Estimate remaining cost based on remaining tokens
    const remainingTokens = this.caps.maxTokens - usage.tokens;
    const estimatedCostRemaining = BudgetTrackerImpl.calculateCost('gpt-5-mini', remainingTokens);

    return {
      percentUsed,
      criticalResources,
      estimatedCostRemaining
    };
  }
}

/**
 * Create a budget tracker with default or custom caps
 */
export function createBudgetTracker(customCaps?: Partial<BudgetCaps>): BudgetTracker {
  const tracker = new BudgetTrackerImpl();
  
  if (customCaps) {
    const defaultCaps: BudgetCaps = {
      maxFanouts: 5,
      maxValidations: 20,
      maxCandidates: 200,
      maxTokens: 200000,
      maxDurationMs: 180000,
      maxToolCalls: 100
    };
    
    tracker.initialize({ ...defaultCaps, ...customCaps });
  }
  
  return tracker;
}

/**
 * Budget exceeded error
 */
export class BudgetExceededError extends Error {
  constructor(
    public readonly resource: string,
    public readonly used: number,
    public readonly limit: number
  ) {
    super(`Budget exceeded for ${resource}: ${used} >= ${limit}`);
    this.name = 'BudgetExceededError';
  }
}