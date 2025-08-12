/**
 * Unit tests for Budget Tracker
 */

import { describe, it, expect, beforeEach } from '@jest/globals';
import { BudgetTrackerImpl, createBudgetTracker, BudgetExceededError } from '../budget-tracker';
import { BudgetCaps } from '@/types/orchestrator';

describe('BudgetTracker', () => {
  let tracker: BudgetTrackerImpl;
  
  beforeEach(() => {
    tracker = new BudgetTrackerImpl();
  });

  describe('initialization', () => {
    it('should initialize with default caps', () => {
      const usage = tracker.getUsage();
      expect(usage.fanouts).toBe(0);
      expect(usage.validations).toBe(0);
      expect(usage.candidates).toBe(0);
      expect(usage.tokens).toBe(0);
      expect(usage.toolCalls).toBe(0);
    });

    it('should accept custom caps', () => {
      const customCaps: BudgetCaps = {
        maxFanouts: 5,
        maxValidations: 20,
        maxCandidates: 200,
        maxTokens: 200000,
        maxDurationMs: 120000,
        maxToolCalls: 100
      };
      
      tracker.initialize(customCaps);
      // Test by trying to exceed default but not custom limits
      expect(tracker.canExecute('test', 150000)).toBe(true);
    });
  });

  describe('canExecute', () => {
    it('should allow execution within budget', () => {
      expect(tracker.canExecute('test-tool', 1000)).toBe(true);
    });

    it('should block execution when tool calls exceeded', () => {
      // Simulate 50 tool calls
      for (let i = 0; i < 50; i++) {
        tracker.recordToolCall(`tool-${i}`, 100, 0.01);
      }
      expect(tracker.canExecute('test-tool')).toBe(false);
    });

    it('should block execution when tokens exceeded', () => {
      expect(tracker.canExecute('test-tool', 101000)).toBe(false);
    });

    it('should block validation tools when validation limit reached', () => {
      // Simulate 10 validations
      for (let i = 0; i < 10; i++) {
        tracker.recordValidation(5);
      }
      expect(tracker.canExecute('validation-tool')).toBe(false);
    });

    it('should block search tools when fanout limit reached', () => {
      // Simulate 2 fanouts
      tracker.recordFanout();
      tracker.recordFanout();
      expect(tracker.canExecute('search-tool')).toBe(false);
    });
  });

  describe('recordToolCall', () => {
    it('should update usage metrics', () => {
      tracker.recordToolCall('test-tool', 500, 0.05);
      const usage = tracker.getUsage();
      
      expect(usage.toolCalls).toBe(1);
      expect(usage.tokens).toBe(500);
      expect(usage.costs.total).toBe(0.05);
    });

    it('should distribute costs by tool type', () => {
      tracker.recordToolCall('comprehensive-analysis', 1000, 0.10);
      tracker.recordToolCall('validation-check', 500, 0.05);
      tracker.recordToolCall('simple-enrichment', 200, 0.02);
      
      const usage = tracker.getUsage();
      expect(usage.costs.gpt5).toBeGreaterThan(0);
      expect(usage.costs.gpt5Mini).toBeGreaterThan(0);
      expect(usage.costs.gpt5Nano).toBeGreaterThan(0);
      expect(usage.costs.total).toBe(0.17);
    });
  });

  describe('recordValidation', () => {
    it('should track validation count and candidates', () => {
      expect(tracker.recordValidation(10)).toBe(true);
      expect(tracker.recordValidation(15)).toBe(true);
      
      const usage = tracker.getUsage();
      expect(usage.validations).toBe(2);
      expect(usage.candidates).toBe(25);
    });

    it('should reject when validation limit reached', () => {
      for (let i = 0; i < 10; i++) {
        tracker.recordValidation(5);
      }
      expect(tracker.recordValidation(5)).toBe(false);
    });

    it('should reject when candidate limit would be exceeded', () => {
      expect(tracker.recordValidation(121)).toBe(false);
    });
  });

  describe('recordFanout', () => {
    it('should track fanout count', () => {
      expect(tracker.recordFanout()).toBe(true);
      const usage = tracker.getUsage();
      expect(usage.fanouts).toBe(1);
    });

    it('should reject when fanout limit reached', () => {
      tracker.recordFanout();
      tracker.recordFanout();
      expect(tracker.recordFanout()).toBe(false);
    });
  });

  describe('isExceeded', () => {
    it('should return false when within budget', () => {
      expect(tracker.isExceeded()).toBe(false);
    });

    it('should return true when any limit exceeded', () => {
      tracker.recordFanout();
      tracker.recordFanout();
      expect(tracker.isExceeded()).toBe(true);
    });
  });

  describe('getRemainingBudget', () => {
    it('should calculate remaining budget correctly', () => {
      tracker.recordFanout();
      tracker.recordValidation(20);
      tracker.recordToolCall('test', 10000, 0.10);
      
      const remaining = tracker.getRemainingBudget();
      expect(remaining.maxFanouts).toBe(1);
      expect(remaining.maxValidations).toBe(9);
      expect(remaining.maxCandidates).toBe(100);
      expect(remaining.maxTokens).toBe(90000);
      expect(remaining.maxToolCalls).toBe(49);
    });
  });

  describe('getBudgetSummary', () => {
    it('should identify critical resources', () => {
      // Use up 90% of fanouts
      tracker.recordFanout();
      tracker.recordFanout();
      
      const summary = tracker.getBudgetSummary();
      expect(summary.criticalResources).toContain('fanouts');
      expect(summary.percentUsed.fanouts).toBe(100);
    });

    it('should estimate remaining cost', () => {
      tracker.recordToolCall('test', 50000, 0.50);
      
      const summary = tracker.getBudgetSummary();
      expect(summary.estimatedCostRemaining).toBeGreaterThan(0);
      expect(summary.estimatedCostRemaining).toBeLessThan(0.2);
    });
  });

  describe('calculateCost', () => {
    it('should calculate cost correctly for each model', () => {
      expect(BudgetTrackerImpl.calculateCost('gpt-5', 1000)).toBe(0.015);
      expect(BudgetTrackerImpl.calculateCost('gpt-5-mini', 1000)).toBe(0.002);
      expect(BudgetTrackerImpl.calculateCost('gpt-5-nano', 1000)).toBe(0.0005);
    });
  });

  describe('factory function', () => {
    it('should create tracker with custom caps', () => {
      const tracker = createBudgetTracker({
        maxFanouts: 10,
        maxTokens: 500000
      });
      
      const usage = tracker.getUsage();
      expect(usage.fanouts).toBe(0);
      
      // Should handle partial custom caps
      expect(tracker.canExecute('test', 200000)).toBe(true);
    });
  });

  describe('BudgetExceededError', () => {
    it('should create proper error message', () => {
      const error = new BudgetExceededError('tokens', 150000, 100000);
      expect(error.message).toBe('Budget exceeded for tokens: 150000 >= 100000');
      expect(error.name).toBe('BudgetExceededError');
      expect(error.resource).toBe('tokens');
      expect(error.used).toBe(150000);
      expect(error.limit).toBe(100000);
    });
  });
});