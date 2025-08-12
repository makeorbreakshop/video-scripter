/**
 * Mode Selector for Idea Heist
 * Determines whether to use classic pipeline or agentic mode
 */

import { AnalysisMode } from '@/types/orchestrator';

/**
 * Factors that influence mode selection
 */
interface ModeSelectionFactors {
  videoHasHighTPS: boolean;          // TPS >= 3.0
  channelHasPatterns: boolean;       // Previous successful patterns found
  hasCompetitiveData: boolean;       // Competitor videos available
  hasSemanticClusters: boolean;      // Dense embedding clusters exist
  userPreference?: AnalysisMode;     // Explicit user choice
  previousFailures: number;           // Failed attempts with agentic mode
  quotaAvailable: boolean;            // Sufficient API quota remaining
  timeConstraint?: number;            // Max execution time in ms
}

/**
 * Mode selection result with reasoning
 */
interface ModeSelectionResult {
  mode: AnalysisMode;
  confidence: number;
  reasoning: string[];
  fallbackRecommended: boolean;
  estimatedDuration: number;
  estimatedCost: number;
}

/**
 * Historical performance tracking
 */
interface ModePerformance {
  mode: AnalysisMode;
  successRate: number;
  avgDurationMs: number;
  avgCost: number;
  patternQuality: number; // 0-1 scale
  sampleSize: number;
}

/**
 * Mode selector implementation
 */
export class ModeSelector {
  private performanceHistory: Map<AnalysisMode, ModePerformance>;
  private selectionHistory: Array<{
    timestamp: Date;
    factors: ModeSelectionFactors;
    selected: AnalysisMode;
    result: 'success' | 'failure' | 'fallback';
  }> = [];

  constructor() {
    // Initialize with baseline performance metrics
    this.performanceHistory = new Map([
      ['classic', {
        mode: 'classic',
        successRate: 0.95,    // Very reliable
        avgDurationMs: 5000,   // Fast
        avgCost: 0.10,        // Cheap
        patternQuality: 0.6,  // Moderate quality
        sampleSize: 1000
      }],
      ['agentic', {
        mode: 'agentic',
        successRate: 0.75,    // Less reliable
        avgDurationMs: 30000,  // Slower
        avgCost: 0.50,        // More expensive
        patternQuality: 0.85, // High quality
        sampleSize: 100
      }]
    ]);
  }

  /**
   * Select optimal mode based on factors
   */
  selectMode(factors: ModeSelectionFactors): ModeSelectionResult {
    const reasoning: string[] = [];
    let agenticScore = 0;
    let classicScore = 0;

    // User preference is highest priority
    if (factors.userPreference) {
      reasoning.push(`User explicitly requested ${factors.userPreference} mode`);
      return {
        mode: factors.userPreference,
        confidence: 1.0,
        reasoning,
        fallbackRecommended: factors.userPreference === 'agentic',
        estimatedDuration: this.performanceHistory.get(factors.userPreference)!.avgDurationMs,
        estimatedCost: this.performanceHistory.get(factors.userPreference)!.avgCost
      };
    }

    // Check hard constraints
    if (!factors.quotaAvailable) {
      reasoning.push('Insufficient API quota - using classic mode');
      return this.createResult('classic', 0.9, reasoning, false);
    }

    if (factors.previousFailures >= 2) {
      reasoning.push('Multiple agentic failures - falling back to classic');
      return this.createResult('classic', 0.95, reasoning, false);
    }

    // Score based on video characteristics
    if (factors.videoHasHighTPS) {
      agenticScore += 3;
      reasoning.push('High TPS video benefits from deep pattern analysis (+agentic)');
    } else {
      classicScore += 1;
      reasoning.push('Standard TPS video can use classic pipeline (+classic)');
    }

    // Score based on available data
    if (factors.channelHasPatterns) {
      agenticScore += 2;
      reasoning.push('Channel has discoverable patterns (+agentic)');
    }

    if (factors.hasCompetitiveData) {
      agenticScore += 2;
      reasoning.push('Competitive data available for cross-channel analysis (+agentic)');
    } else {
      classicScore += 1;
      reasoning.push('Limited competitive data (+classic)');
    }

    if (factors.hasSemanticClusters) {
      agenticScore += 3;
      reasoning.push('Dense semantic clusters enable pattern discovery (+agentic)');
    } else {
      classicScore += 2;
      reasoning.push('Sparse embeddings limit pattern discovery (+classic)');
    }

    // Time constraint check
    if (factors.timeConstraint) {
      const agenticDuration = this.performanceHistory.get('agentic')!.avgDurationMs;
      const classicDuration = this.performanceHistory.get('classic')!.avgDurationMs;
      
      if (factors.timeConstraint < agenticDuration) {
        classicScore += 3;
        reasoning.push(`Time constraint ${factors.timeConstraint}ms favors classic mode`);
      }
    }

    // Historical performance weighting
    const agenticPerf = this.performanceHistory.get('agentic')!;
    const classicPerf = this.performanceHistory.get('classic')!;
    
    if (agenticPerf.successRate > 0.8 && agenticPerf.sampleSize > 50) {
      agenticScore += 1;
      reasoning.push('Agentic mode has good historical performance');
    }

    // Make final decision
    const selectedMode: AnalysisMode = agenticScore > classicScore ? 'agentic' : 'classic';
    const confidence = Math.abs(agenticScore - classicScore) / (agenticScore + classicScore);
    
    // Recommend fallback for low-confidence agentic selection
    const fallbackRecommended = selectedMode === 'agentic' && confidence < 0.3;
    
    if (fallbackRecommended) {
      reasoning.push('Low confidence in agentic mode - fallback recommended');
    }

    reasoning.push(`Final scores: Agentic=${agenticScore}, Classic=${classicScore}`);

    return this.createResult(selectedMode, confidence, reasoning, fallbackRecommended);
  }

  /**
   * Create mode selection result
   */
  private createResult(
    mode: AnalysisMode,
    confidence: number,
    reasoning: string[],
    fallbackRecommended: boolean
  ): ModeSelectionResult {
    const perf = this.performanceHistory.get(mode)!;
    
    return {
      mode,
      confidence,
      reasoning,
      fallbackRecommended,
      estimatedDuration: perf.avgDurationMs,
      estimatedCost: perf.avgCost
    };
  }

  /**
   * Update performance history after execution
   */
  updatePerformance(
    mode: AnalysisMode,
    success: boolean,
    durationMs: number,
    cost: number,
    patternQuality?: number
  ): void {
    const current = this.performanceHistory.get(mode)!;
    const newSampleSize = current.sampleSize + 1;
    
    // Update with exponential moving average
    const alpha = 0.1; // Recent results have 10% weight
    
    const updated: ModePerformance = {
      mode,
      successRate: current.successRate * (1 - alpha) + (success ? 1 : 0) * alpha,
      avgDurationMs: current.avgDurationMs * (1 - alpha) + durationMs * alpha,
      avgCost: current.avgCost * (1 - alpha) + cost * alpha,
      patternQuality: patternQuality !== undefined 
        ? current.patternQuality * (1 - alpha) + patternQuality * alpha
        : current.patternQuality,
      sampleSize: newSampleSize
    };
    
    this.performanceHistory.set(mode, updated);
  }

  /**
   * Record selection for analysis
   */
  recordSelection(
    factors: ModeSelectionFactors,
    selected: AnalysisMode,
    result: 'success' | 'failure' | 'fallback'
  ): void {
    this.selectionHistory.push({
      timestamp: new Date(),
      factors,
      selected,
      result
    });

    // Keep only last 100 selections
    if (this.selectionHistory.length > 100) {
      this.selectionHistory.shift();
    }
  }

  /**
   * Get performance statistics
   */
  getPerformanceStats(): {
    classic: ModePerformance;
    agentic: ModePerformance;
    recentSelections: typeof ModeSelector.prototype.selectionHistory;
  } {
    return {
      classic: this.performanceHistory.get('classic')!,
      agentic: this.performanceHistory.get('agentic')!,
      recentSelections: this.selectionHistory.slice(-10)
    };
  }

  /**
   * Analyze factors from video and database context
   */
  async analyzeFactors(videoId: string): Promise<ModeSelectionFactors> {
    // This would query the database for real data
    // For now, return mock factors for implementation
    
    try {
      // Fetch video data
      const videoResponse = await fetch(`/api/videos/${videoId}`);
      const video = await videoResponse.json();
      
      // Fetch channel patterns
      const patternResponse = await fetch(`/api/tools/suggest-pattern-hypotheses`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          channel_id: video.channel_id,
          max_hypotheses: 1 
        })
      });
      const patterns = await patternResponse.json();
      
      // Check competitive data
      const competitiveResponse = await fetch(`/api/tools/find-competitive-successes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          topic_cluster_id: video.topic_cluster_id,
          exclude_channel_id: video.channel_id
        })
      });
      const competitive = await competitiveResponse.json();
      
      return {
        videoHasHighTPS: video.temporal_score >= 3.0,
        channelHasPatterns: patterns.hypotheses?.length > 0,
        hasCompetitiveData: competitive.videos?.length > 10,
        hasSemanticClusters: video.embedding_id !== null,
        previousFailures: 0,
        quotaAvailable: true
      };
    } catch (error) {
      console.error('Error analyzing factors:', error);
      
      // Return conservative defaults on error
      return {
        videoHasHighTPS: false,
        channelHasPatterns: false,
        hasCompetitiveData: false,
        hasSemanticClusters: false,
        previousFailures: 0,
        quotaAvailable: true
      };
    }
  }

  /**
   * Check if fallback to classic should be triggered
   */
  shouldFallback(
    currentMode: AnalysisMode,
    elapsedMs: number,
    tokensUsed: number,
    errors: number
  ): boolean {
    if (currentMode !== 'agentic') {
      return false; // Only fallback from agentic
    }

    const agenticPerf = this.performanceHistory.get('agentic')!;
    
    // Fallback conditions
    if (errors >= 3) {
      console.log('Fallback triggered: too many errors');
      return true;
    }
    
    if (elapsedMs > agenticPerf.avgDurationMs * 2) {
      console.log('Fallback triggered: execution time exceeded');
      return true;
    }
    
    if (tokensUsed > 80000) {
      console.log('Fallback triggered: token usage excessive');
      return true;
    }
    
    return false;
  }

  /**
   * Reset performance history (for testing)
   */
  resetHistory(): void {
    this.selectionHistory = [];
    
    // Reset to baseline
    this.performanceHistory.set('classic', {
      mode: 'classic',
      successRate: 0.95,
      avgDurationMs: 5000,
      avgCost: 0.10,
      patternQuality: 0.6,
      sampleSize: 0
    });
    
    this.performanceHistory.set('agentic', {
      mode: 'agentic',
      successRate: 0.75,
      avgDurationMs: 30000,
      avgCost: 0.50,
      patternQuality: 0.85,
      sampleSize: 0
    });
  }
}

/**
 * Create mode selector instance
 */
export function createModeSelector(): ModeSelector {
  return new ModeSelector();
}

// Export singleton instance
let selectorInstance: ModeSelector | null = null;

export function getModeSelector(): ModeSelector {
  if (!selectorInstance) {
    selectorInstance = createModeSelector();
  }
  return selectorInstance;
}