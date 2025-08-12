/**
 * Unit tests for Model Router
 */

import { describe, it, expect, beforeEach } from '@jest/globals';
import { ModelRouter, createModelRouter } from '../model-router';
import { SessionState, BudgetUsage, TurnType, ModelType } from '@/types/orchestrator';

describe('ModelRouter', () => {
  let router: ModelRouter;
  let mockSessionState: SessionState;
  let mockBudgetUsage: BudgetUsage;
  
  beforeEach(() => {
    router = new ModelRouter();
    
    mockSessionState = {
      videoId: 'test-video-123',
      videoContext: {
        title: 'Test Video',
        tps: 2.5,
        channelName: 'Test Channel',
        formatType: 'tutorial',
        topicNiche: 'technology'
      },
      hypothesis: {
        statement: 'Test hypothesis',
        confidence: 0.7,
        supportingEvidence: ['evidence1', 'evidence2']
      },
      searchResults: {
        semanticNeighbors: ['video1', 'video2'],
        competitiveSuccesses: ['video3', 'video4'],
        totalCandidates: 20
      },
      validationResults: undefined,
      toolCalls: [],
      errors: []
    };
    
    mockBudgetUsage = {
      fanouts: 0,
      validations: 0,
      candidates: 0,
      tokens: 10000,
      durationMs: 5000,
      toolCalls: 5,
      costs: {
        gpt5: 0.10,
        gpt5Mini: 0.02,
        gpt5Nano: 0.01,
        total: 0.13
      }
    };
  });

  describe('route', () => {
    it('should route hypothesis generation to GPT-5', () => {
      const decision = router.route('hypothesis_generation', mockSessionState, mockBudgetUsage);
      
      expect(decision.model).toBe('gpt-5');
      expect(decision.reason).toContain('hypothesis');
      expect(decision.estimatedTokens).toBeGreaterThan(0);
      expect(decision.estimatedCost).toBeGreaterThan(0);
    });

    it('should route simple enrichment to GPT-5-nano', () => {
      const decision = router.route('enrichment', mockSessionState, mockBudgetUsage);
      
      expect(decision.model).toBe('gpt-5-nano');
      expect(decision.reason).toContain('enrichment');
    });

    it('should route validation to GPT-5-mini for high confidence', () => {
      mockSessionState.hypothesis!.confidence = 0.85;
      const decision = router.route('validation', mockSessionState, mockBudgetUsage);
      
      expect(decision.model).toBe('gpt-5-mini');
      expect(decision.reason).toContain('High-confidence');
    });

    it('should route validation to GPT-5 for low confidence', () => {
      mockSessionState.hypothesis!.confidence = 0.4;
      const decision = router.route('validation', mockSessionState, mockBudgetUsage);
      
      expect(decision.model).toBe('gpt-5');
      expect(decision.reason).toContain('Low-confidence');
    });

    it('should downgrade model when budget constrained', () => {
      mockBudgetUsage.costs.total = 0.85; // 85% of $1 budget
      const decision = router.route('hypothesis_generation', mockSessionState, mockBudgetUsage);
      
      expect(decision.model).toBe('gpt-5-nano');
      expect(decision.reason).toContain('Budget constraint');
    });

    it('should downgrade model when token budget constrained', () => {
      mockBudgetUsage.tokens = 85000; // 85% of 100k budget
      const decision = router.route('hypothesis_generation', mockSessionState, mockBudgetUsage);
      
      expect(decision.model).toBe('gpt-5-nano');
    });

    it('should upgrade model when state size requires it', () => {
      // Create a very large state
      mockSessionState.toolCalls = new Array(100).fill({
        id: 'call',
        toolName: 'test',
        params: {},
        status: 'success' as const,
        startTime: new Date(),
        result: { data: 'x'.repeat(1000) }
      });
      
      const decision = router.route('enrichment', mockSessionState, mockBudgetUsage);
      
      // Should upgrade from nano due to state size
      expect(['gpt-5-mini', 'gpt-5']).toContain(decision.model);
      expect(decision.reason).toContain('State size');
    });

    it('should track model switches', () => {
      router.route('hypothesis_generation', mockSessionState, mockBudgetUsage);
      router.route('enrichment', mockSessionState, mockBudgetUsage);
      router.route('validation', mockSessionState, mockBudgetUsage);
      
      expect(router.getSwitchCount()).toBeGreaterThan(0);
    });
  });

  describe('getModelSwitchHistory', () => {
    it('should track turn history', () => {
      router.route('hypothesis_generation', mockSessionState, mockBudgetUsage);
      router.route('enrichment', mockSessionState, mockBudgetUsage);
      
      const history = router.getModelSwitchHistory();
      expect(history).toHaveLength(2);
      expect(history[0].turn).toBe('hypothesis_generation');
      expect(history[0].model).toBe('gpt-5');
      expect(history[1].turn).toBe('enrichment');
      expect(history[1].model).toBe('gpt-5-nano');
    });
  });

  describe('forceModel', () => {
    it('should override routing decision', () => {
      router.forceModel('gpt-5-mini');
      const decision = router.route('hypothesis_generation', mockSessionState, mockBudgetUsage);
      
      // Should still route to GPT-5 for hypothesis despite force
      expect(decision.model).toBe('gpt-5');
    });

    it('should count as a switch', () => {
      const initialCount = router.getSwitchCount();
      router.forceModel('gpt-5-mini');
      expect(router.getSwitchCount()).toBe(initialCount + 1);
    });
  });

  describe('reset', () => {
    it('should clear all history', () => {
      router.route('hypothesis_generation', mockSessionState, mockBudgetUsage);
      router.route('enrichment', mockSessionState, mockBudgetUsage);
      
      router.reset();
      
      expect(router.getSwitchCount()).toBe(0);
      expect(router.getModelSwitchHistory()).toHaveLength(0);
    });
  });

  describe('getRoutingStats', () => {
    it('should calculate model usage statistics', () => {
      router.route('hypothesis_generation', mockSessionState, mockBudgetUsage);
      router.route('enrichment', mockSessionState, mockBudgetUsage);
      router.route('validation', mockSessionState, mockBudgetUsage);
      
      const stats = router.getRoutingStats();
      
      expect(stats.modelUsage['gpt-5']).toBeGreaterThan(0);
      expect(stats.modelUsage['gpt-5-nano']).toBeGreaterThan(0);
      expect(stats.turnDistribution['hypothesis_generation']).toContain('gpt-5');
      expect(stats.turnDistribution['enrichment']).toContain('gpt-5-nano');
    });
  });

  describe('canModelHandle', () => {
    it('should check model capabilities', () => {
      expect(router.canModelHandle('gpt-5', 'canHypothesizePatterns')).toBe(true);
      expect(router.canModelHandle('gpt-5-nano', 'canHypothesizePatterns')).toBe(false);
      expect(router.canModelHandle('gpt-5-mini', 'canValidateStatistically')).toBe(true);
      expect(router.canModelHandle('gpt-5-nano', 'canCompactState')).toBe(false);
    });
  });

  describe('getOptimalModelForParallelTools', () => {
    it('should select model based on tool count', () => {
      expect(router.getOptimalModelForParallelTools(2)).toBe('gpt-5-nano');
      expect(router.getOptimalModelForParallelTools(4)).toBe('gpt-5-mini');
      expect(router.getOptimalModelForParallelTools(8)).toBe('gpt-5');
    });
  });

  describe('estimateTokensForTurn', () => {
    it('should estimate different token counts by turn type', () => {
      const hypothesisDecision = router.route('hypothesis_generation', mockSessionState, mockBudgetUsage);
      const enrichmentDecision = router.route('enrichment', mockSessionState, mockBudgetUsage);
      
      expect(hypothesisDecision.estimatedTokens).toBeGreaterThan(enrichmentDecision.estimatedTokens);
    });

    it('should account for state size in estimates', () => {
      const smallStateDecision = router.route('validation', mockSessionState, mockBudgetUsage);
      
      // Add more data to state
      mockSessionState.searchResults!.totalCandidates = 100;
      const largeStateDecision = router.route('validation', mockSessionState, mockBudgetUsage);
      
      expect(largeStateDecision.estimatedTokens).toBeGreaterThan(smallStateDecision.estimatedTokens);
    });
  });

  describe('factory function', () => {
    it('should create new router instance', () => {
      const router1 = createModelRouter();
      const router2 = createModelRouter();
      
      expect(router1).not.toBe(router2);
      expect(router1).toBeInstanceOf(ModelRouter);
    });
  });
});