/**
 * Model Router for Idea Heist Agentic Mode
 * Routes decisions to appropriate models based on turn type and complexity
 */

import { 
  ModelType,
  TurnType,
  ModelRoutingDecision,
  SessionState,
  BudgetUsage
} from '@/types/orchestrator';

/**
 * Token limits per model (conservative estimates)
 */
const MODEL_TOKEN_LIMITS = {
  'gpt-5': 128000,      // Full context window
  'gpt-5-mini': 16000,  // Reduced context
  'gpt-5-nano': 8000    // Minimal context
};

/**
 * Cost per 1K tokens (input + output averaged)
 */
const MODEL_COSTS = {
  'gpt-5': 0.015,
  'gpt-5-mini': 0.002,
  'gpt-5-nano': 0.0005
};

/**
 * Model capabilities matrix
 */
const MODEL_CAPABILITIES = {
  'gpt-5': {
    canHypothesizePatterns: true,
    canValidateStatistically: true,
    canOrchestrateTools: true,
    canCompactState: true,
    maxParallelTools: 10,
    preferredTurns: ['hypothesis_generation', 'finalization']
  },
  'gpt-5-mini': {
    canHypothesizePatterns: false,
    canValidateStatistically: true,
    canOrchestrateTools: true,
    canCompactState: true,
    maxParallelTools: 5,
    preferredTurns: ['validation', 'search_planning']
  },
  'gpt-5-nano': {
    canHypothesizePatterns: false,
    canValidateStatistically: false,
    canOrchestrateTools: true,
    canCompactState: false,
    maxParallelTools: 3,
    preferredTurns: ['context_gathering', 'enrichment']
  }
};

/**
 * Model router implementation
 */
export class ModelRouter {
  private currentModel: ModelType = 'gpt-5';
  private modelSwitchCount: number = 0;
  private turnHistory: Array<{ turn: TurnType; model: ModelType }> = [];

  /**
   * Route to appropriate model based on turn type and context
   */
  route(
    turnType: TurnType,
    sessionState: SessionState,
    budgetUsage: BudgetUsage
  ): ModelRoutingDecision {
    // Start with current model preference
    let selectedModel = this.currentModel;
    let reason = 'Continuing with current model';

    // Check turn-specific routing
    const turnRouting = this.getTurnSpecificModel(turnType, sessionState);
    if (turnRouting.model !== this.currentModel) {
      selectedModel = turnRouting.model;
      reason = turnRouting.reason;
    }

    // Check budget constraints
    const budgetConstrainedModel = this.checkBudgetConstraints(
      selectedModel,
      budgetUsage
    );
    if (budgetConstrainedModel !== selectedModel) {
      selectedModel = budgetConstrainedModel;
      reason = `Budget constraint: downgraded from ${selectedModel} to ${budgetConstrainedModel}`;
    }

    // Check state size constraints
    const stateSize = this.estimateStateSize(sessionState);
    const stateConstrainedModel = this.checkStateSizeConstraints(
      selectedModel,
      stateSize
    );
    if (stateConstrainedModel !== selectedModel) {
      selectedModel = stateConstrainedModel;
      reason = `State size constraint: ${stateSize} tokens requires ${stateConstrainedModel}`;
    }

    // Estimate costs
    const estimatedTokens = this.estimateTokensForTurn(
      turnType,
      sessionState,
      selectedModel
    );
    const estimatedCost = (estimatedTokens / 1000) * MODEL_COSTS[selectedModel];

    // Record model switch if changed
    if (selectedModel !== this.currentModel) {
      this.modelSwitchCount++;
      this.currentModel = selectedModel;
    }

    // Record turn history
    this.turnHistory.push({ turn: turnType, model: selectedModel });

    return {
      model: selectedModel,
      reason,
      estimatedTokens,
      estimatedCost
    };
  }

  /**
   * Get turn-specific model recommendation
   */
  private getTurnSpecificModel(
    turnType: TurnType,
    sessionState: SessionState
  ): { model: ModelType; reason: string } {
    switch (turnType) {
      case 'hypothesis_generation':
        // Always use GPT-5 for complex pattern hypothesis
        return {
          model: 'gpt-5',
          reason: 'Complex pattern hypothesis requires GPT-5'
        };

      case 'validation':
        // Use GPT-5-mini for validation unless complex patterns
        if (sessionState.hypothesis?.confidence && sessionState.hypothesis.confidence > 0.8) {
          return {
            model: 'gpt-5-mini',
            reason: 'High-confidence hypothesis can be validated with GPT-5-mini'
          };
        }
        return {
          model: 'gpt-5',
          reason: 'Low-confidence hypothesis needs GPT-5 validation'
        };

      case 'search_planning':
        // GPT-5-mini is sufficient for search planning
        return {
          model: 'gpt-5-mini',
          reason: 'Search planning optimized for GPT-5-mini'
        };

      case 'context_gathering':
      case 'enrichment':
        // GPT-5-nano for simple data fetching
        return {
          model: 'gpt-5-nano',
          reason: 'Simple enrichment tasks use GPT-5-nano'
        };

      case 'finalization':
        // GPT-5 for final synthesis
        return {
          model: 'gpt-5',
          reason: 'Final synthesis requires GPT-5 capabilities'
        };

      default:
        return {
          model: this.currentModel,
          reason: 'Continuing with current model'
        };
    }
  }

  /**
   * Check budget constraints and downgrade if needed
   */
  private checkBudgetConstraints(
    preferredModel: ModelType,
    budgetUsage: BudgetUsage
  ): ModelType {
    const budgetPercentUsed = budgetUsage.costs.total / 1.0; // $1 budget assumption
    
    if (budgetPercentUsed > 0.8) {
      // Severe budget constraint - use nano
      return 'gpt-5-nano';
    } else if (budgetPercentUsed > 0.6 && preferredModel === 'gpt-5') {
      // Moderate constraint - downgrade from GPT-5
      return 'gpt-5-mini';
    }

    // Check token budget
    const tokenPercentUsed = budgetUsage.tokens / 100000; // 100k token budget
    if (tokenPercentUsed > 0.8) {
      return 'gpt-5-nano';
    } else if (tokenPercentUsed > 0.6 && preferredModel === 'gpt-5') {
      return 'gpt-5-mini';
    }

    return preferredModel;
  }

  /**
   * Check if state size requires a larger model
   */
  private checkStateSizeConstraints(
    preferredModel: ModelType,
    stateSize: number
  ): ModelType {
    const modelLimit = MODEL_TOKEN_LIMITS[preferredModel];
    
    // Leave 50% headroom for response
    const effectiveLimit = modelLimit * 0.5;
    
    if (stateSize > effectiveLimit) {
      // Need to upgrade model
      if (preferredModel === 'gpt-5-nano' && stateSize <= MODEL_TOKEN_LIMITS['gpt-5-mini'] * 0.5) {
        return 'gpt-5-mini';
      } else if (stateSize <= MODEL_TOKEN_LIMITS['gpt-5'] * 0.5) {
        return 'gpt-5';
      }
      // State too large even for GPT-5 - will need compaction
      console.warn(`State size ${stateSize} exceeds all model limits, compaction required`);
    }

    return preferredModel;
  }

  /**
   * Estimate state size in tokens
   */
  private estimateStateSize(sessionState: SessionState): number {
    // Rough estimation: 4 characters per token
    const stateJson = JSON.stringify(sessionState);
    const baseTokens = Math.ceil(stateJson.length / 4);
    
    // Add overhead for tool call history
    const toolCallTokens = sessionState.toolCalls.length * 50;
    
    // Add overhead for search results
    const searchTokens = (sessionState.searchResults?.totalCandidates || 0) * 10;
    
    return baseTokens + toolCallTokens + searchTokens;
  }

  /**
   * Estimate tokens needed for a turn
   */
  private estimateTokensForTurn(
    turnType: TurnType,
    sessionState: SessionState,
    model: ModelType
  ): number {
    const stateSize = this.estimateStateSize(sessionState);
    
    // Base tokens for system prompt and turn instructions
    let baseTokens = 2000;
    
    // Add turn-specific estimates
    switch (turnType) {
      case 'hypothesis_generation':
        baseTokens += 3000; // Complex reasoning
        break;
      case 'validation':
        baseTokens += 2000 * (sessionState.searchResults?.totalCandidates || 20) / 20;
        break;
      case 'search_planning':
        baseTokens += 1500;
        break;
      case 'context_gathering':
      case 'enrichment':
        baseTokens += 1000;
        break;
      case 'finalization':
        baseTokens += 2500;
        break;
    }

    // Add state overhead
    return stateSize + baseTokens;
  }

  /**
   * Get model switch history
   */
  getModelSwitchHistory(): Array<{ turn: TurnType; model: ModelType }> {
    return [...this.turnHistory];
  }

  /**
   * Get switch count
   */
  getSwitchCount(): number {
    return this.modelSwitchCount;
  }

  /**
   * Reset router state
   */
  reset(): void {
    this.currentModel = 'gpt-5';
    this.modelSwitchCount = 0;
    this.turnHistory = [];
  }

  /**
   * Force a specific model (for testing or fallback)
   */
  forceModel(model: ModelType): void {
    if (model !== this.currentModel) {
      this.modelSwitchCount++;
      this.currentModel = model;
    }
  }

  /**
   * Get routing statistics
   */
  getRoutingStats(): {
    currentModel: ModelType;
    switchCount: number;
    modelUsage: Record<ModelType, number>;
    turnDistribution: Record<TurnType, ModelType[]>;
  } {
    const modelUsage: Record<ModelType, number> = {
      'gpt-5': 0,
      'gpt-5-mini': 0,
      'gpt-5-nano': 0
    };

    const turnDistribution: Record<TurnType, ModelType[]> = {
      'context_gathering': [],
      'hypothesis_generation': [],
      'search_planning': [],
      'enrichment': [],
      'validation': [],
      'finalization': []
    };

    for (const entry of this.turnHistory) {
      modelUsage[entry.model]++;
      if (turnDistribution[entry.turn]) {
        turnDistribution[entry.turn].push(entry.model);
      }
    }

    return {
      currentModel: this.currentModel,
      switchCount: this.modelSwitchCount,
      modelUsage,
      turnDistribution
    };
  }

  /**
   * Check if a model can handle a specific capability
   */
  canModelHandle(model: ModelType, capability: keyof typeof MODEL_CAPABILITIES['gpt-5']): boolean {
    return MODEL_CAPABILITIES[model][capability] as boolean;
  }

  /**
   * Get optimal model for parallel tool execution
   */
  getOptimalModelForParallelTools(toolCount: number): ModelType {
    if (toolCount <= MODEL_CAPABILITIES['gpt-5-nano'].maxParallelTools) {
      return 'gpt-5-nano';
    } else if (toolCount <= MODEL_CAPABILITIES['gpt-5-mini'].maxParallelTools) {
      return 'gpt-5-mini';
    }
    return 'gpt-5';
  }
}

/**
 * Create model router instance
 */
export function createModelRouter(): ModelRouter {
  return new ModelRouter();
}

// Export singleton instance
let routerInstance: ModelRouter | null = null;

export function getModelRouter(): ModelRouter {
  if (!routerInstance) {
    routerInstance = createModelRouter();
  }
  return routerInstance;
}