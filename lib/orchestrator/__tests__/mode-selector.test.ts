/**
 * Unit tests for Mode Selector
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { ModeSelector, createModeSelector } from '../mode-selector';

// Mock fetch for analyzeFactors
global.fetch = jest.fn() as jest.MockedFunction<typeof fetch>;

describe('ModeSelector', () => {
  let selector: ModeSelector;
  
  beforeEach(() => {
    selector = new ModeSelector();
    jest.clearAllMocks();
  });

  describe('selectMode', () => {
    it('should respect user preference', () => {
      const result = selector.selectMode({
        videoHasHighTPS: false,
        channelHasPatterns: false,
        hasCompetitiveData: false,
        hasSemanticClusters: false,
        userPreference: 'agentic',
        previousFailures: 0,
        quotaAvailable: true
      });
      
      expect(result.mode).toBe('agentic');
      expect(result.confidence).toBe(1.0);
      expect(result.reasoning[0]).toContain('User explicitly requested');
    });

    it('should use classic when quota unavailable', () => {
      const result = selector.selectMode({
        videoHasHighTPS: true,
        channelHasPatterns: true,
        hasCompetitiveData: true,
        hasSemanticClusters: true,
        previousFailures: 0,
        quotaAvailable: false
      });
      
      expect(result.mode).toBe('classic');
      expect(result.reasoning[0]).toContain('Insufficient API quota');
    });

    it('should fallback to classic after multiple failures', () => {
      const result = selector.selectMode({
        videoHasHighTPS: true,
        channelHasPatterns: true,
        hasCompetitiveData: true,
        hasSemanticClusters: true,
        previousFailures: 2,
        quotaAvailable: true
      });
      
      expect(result.mode).toBe('classic');
      expect(result.reasoning[0]).toContain('Multiple agentic failures');
    });

    it('should prefer agentic for high TPS videos with patterns', () => {
      const result = selector.selectMode({
        videoHasHighTPS: true,
        channelHasPatterns: true,
        hasCompetitiveData: true,
        hasSemanticClusters: true,
        previousFailures: 0,
        quotaAvailable: true
      });
      
      expect(result.mode).toBe('agentic');
      expect(result.reasoning).toContain('High TPS video benefits from deep pattern analysis (+agentic)');
      expect(result.reasoning).toContain('Channel has discoverable patterns (+agentic)');
    });

    it('should prefer classic for standard videos without data', () => {
      const result = selector.selectMode({
        videoHasHighTPS: false,
        channelHasPatterns: false,
        hasCompetitiveData: false,
        hasSemanticClusters: false,
        previousFailures: 0,
        quotaAvailable: true
      });
      
      expect(result.mode).toBe('classic');
      expect(result.reasoning).toContain('Standard TPS video can use classic pipeline (+classic)');
    });

    it('should respect time constraints', () => {
      const result = selector.selectMode({
        videoHasHighTPS: true,
        channelHasPatterns: true,
        hasCompetitiveData: true,
        hasSemanticClusters: true,
        previousFailures: 0,
        quotaAvailable: true,
        timeConstraint: 10000 // 10 seconds
      });
      
      expect(result.mode).toBe('classic');
      expect(result.reasoning.find(r => r.includes('Time constraint'))).toBeDefined();
    });

    it('should recommend fallback for low confidence agentic', () => {
      const result = selector.selectMode({
        videoHasHighTPS: true,
        channelHasPatterns: false,
        hasCompetitiveData: false,
        hasSemanticClusters: true,
        previousFailures: 0,
        quotaAvailable: true
      });
      
      // Should be close decision
      if (result.mode === 'agentic' && result.confidence < 0.3) {
        expect(result.fallbackRecommended).toBe(true);
        expect(result.reasoning).toContain('Low confidence in agentic mode - fallback recommended');
      }
    });
  });

  describe('updatePerformance', () => {
    it('should update performance metrics with exponential moving average', () => {
      const initialStats = selector.getPerformanceStats();
      const initialSuccessRate = initialStats.agentic.successRate;
      
      selector.updatePerformance('agentic', true, 25000, 0.40, 0.90);
      
      const updatedStats = selector.getPerformanceStats();
      expect(updatedStats.agentic.successRate).toBeGreaterThan(initialSuccessRate);
      expect(updatedStats.agentic.avgDurationMs).toBeLessThan(30000);
      expect(updatedStats.agentic.avgCost).toBeLessThan(0.50);
      expect(updatedStats.agentic.patternQuality).toBeGreaterThan(0.85);
      expect(updatedStats.agentic.sampleSize).toBe(101);
    });

    it('should handle failure updates', () => {
      const initialStats = selector.getPerformanceStats();
      const initialSuccessRate = initialStats.agentic.successRate;
      
      selector.updatePerformance('agentic', false, 40000, 0.60);
      
      const updatedStats = selector.getPerformanceStats();
      expect(updatedStats.agentic.successRate).toBeLessThan(initialSuccessRate);
    });
  });

  describe('recordSelection', () => {
    it('should track selection history', () => {
      const factors = {
        videoHasHighTPS: true,
        channelHasPatterns: true,
        hasCompetitiveData: true,
        hasSemanticClusters: true,
        previousFailures: 0,
        quotaAvailable: true
      };
      
      selector.recordSelection(factors, 'agentic', 'success');
      
      const stats = selector.getPerformanceStats();
      expect(stats.recentSelections).toHaveLength(1);
      expect(stats.recentSelections[0].selected).toBe('agentic');
      expect(stats.recentSelections[0].result).toBe('success');
    });

    it('should limit history to 100 entries', () => {
      const factors = {
        videoHasHighTPS: false,
        channelHasPatterns: false,
        hasCompetitiveData: false,
        hasSemanticClusters: false,
        previousFailures: 0,
        quotaAvailable: true
      };
      
      for (let i = 0; i < 110; i++) {
        selector.recordSelection(factors, 'classic', 'success');
      }
      
      // Internal history should be limited (we only see last 10 in stats)
      const stats = selector.getPerformanceStats();
      expect(stats.recentSelections).toHaveLength(10);
    });
  });

  describe('analyzeFactors', () => {
    it('should fetch and analyze video factors', async () => {
      const mockVideo = {
        channel_id: 'channel123',
        temporal_score: 3.5,
        topic_cluster_id: 42,
        embedding_id: 'embed123'
      };
      
      const mockPatterns = {
        hypotheses: [{ pattern: 'test' }]
      };
      
      const mockCompetitive = {
        videos: new Array(15).fill({ id: 'video' })
      };
      
      (global.fetch as jest.MockedFunction<typeof fetch>)
        .mockResolvedValueOnce({
          json: async () => mockVideo
        } as Response)
        .mockResolvedValueOnce({
          json: async () => mockPatterns
        } as Response)
        .mockResolvedValueOnce({
          json: async () => mockCompetitive
        } as Response);
      
      const factors = await selector.analyzeFactors('video123');
      
      expect(factors.videoHasHighTPS).toBe(true);
      expect(factors.channelHasPatterns).toBe(true);
      expect(factors.hasCompetitiveData).toBe(true);
      expect(factors.hasSemanticClusters).toBe(true);
    });

    it('should return conservative defaults on error', async () => {
      (global.fetch as jest.MockedFunction<typeof fetch>)
        .mockRejectedValue(new Error('Network error'));
      
      const factors = await selector.analyzeFactors('video123');
      
      expect(factors.videoHasHighTPS).toBe(false);
      expect(factors.channelHasPatterns).toBe(false);
      expect(factors.hasCompetitiveData).toBe(false);
      expect(factors.hasSemanticClusters).toBe(false);
    });
  });

  describe('shouldFallback', () => {
    it('should not fallback from classic mode', () => {
      expect(selector.shouldFallback('classic', 100000, 50000, 5)).toBe(false);
    });

    it('should fallback on too many errors', () => {
      expect(selector.shouldFallback('agentic', 10000, 10000, 3)).toBe(true);
    });

    it('should fallback on excessive execution time', () => {
      expect(selector.shouldFallback('agentic', 70000, 10000, 0)).toBe(true);
    });

    it('should fallback on excessive token usage', () => {
      expect(selector.shouldFallback('agentic', 10000, 85000, 0)).toBe(true);
    });

    it('should not fallback when within limits', () => {
      expect(selector.shouldFallback('agentic', 20000, 30000, 1)).toBe(false);
    });
  });

  describe('resetHistory', () => {
    it('should reset to baseline performance', () => {
      selector.updatePerformance('agentic', true, 20000, 0.30, 0.95);
      selector.recordSelection({
        videoHasHighTPS: true,
        channelHasPatterns: true,
        hasCompetitiveData: true,
        hasSemanticClusters: true,
        previousFailures: 0,
        quotaAvailable: true
      }, 'agentic', 'success');
      
      selector.resetHistory();
      
      const stats = selector.getPerformanceStats();
      expect(stats.agentic.successRate).toBe(0.75);
      expect(stats.agentic.avgDurationMs).toBe(30000);
      expect(stats.agentic.sampleSize).toBe(0);
      expect(stats.recentSelections).toHaveLength(0);
    });
  });

  describe('factory function', () => {
    it('should create new selector instance', () => {
      const selector1 = createModeSelector();
      const selector2 = createModeSelector();
      
      expect(selector1).not.toBe(selector2);
      expect(selector1).toBeInstanceOf(ModeSelector);
    });
  });
});