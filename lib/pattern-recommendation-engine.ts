/**
 * Pattern Recommendation Engine
 * Personalizes pattern recommendations based on creator profile and goals
 */

import { supabase } from './supabase';
import { CreatorInsight, CreatorStage } from './creator-pattern-insights';
import { PatternLifecycleStage } from './pattern-lifecycle-tracker';

export interface CreatorProfile {
  channel_id: string;
  subscriber_count: number;
  avg_views: number;
  upload_frequency: number; // videos per month
  content_style: ContentStyle[];
  goals: CreatorGoal[];
  risk_tolerance: 'low' | 'medium' | 'high';
  time_availability: 'limited' | 'moderate' | 'full-time';
  strengths: string[];
  weaknesses: string[];
}

export type ContentStyle = 
  | 'educational' 
  | 'entertainment' 
  | 'personal' 
  | 'news' 
  | 'review' 
  | 'vlog' 
  | 'tutorial'
  | 'commentary';

export type CreatorGoal = 
  | 'grow_subscribers'
  | 'increase_views' 
  | 'improve_retention'
  | 'build_community'
  | 'monetize_better'
  | 'save_time'
  | 'find_viral_hits';

export interface PatternRecommendation {
  pattern: CreatorInsight;
  relevance_score: number; // 0-1
  reasoning: string[];
  priority: 'immediate' | 'soon' | 'explore';
  implementation_difficulty: 'easy' | 'medium' | 'hard';
  expected_impact: {
    metric: string;
    improvement: string; // e.g., "2-3x views"
    timeframe: string; // e.g., "2-4 weeks"
  };
  action_plan: ActionStep[];
  success_probability: number; // 0-1
}

export interface ActionStep {
  step: number;
  action: string;
  resources_needed: string[];
  estimated_time: string;
  tips: string[];
}

export interface RecommendationContext {
  current_performance: {
    view_velocity: number; // recent growth rate
    best_videos: Array<{id: string; title: string; views: number}>;
    weak_areas: string[];
  };
  competitor_analysis: {
    top_patterns: string[];
    performance_gaps: string[];
  };
  market_timing: {
    trending_up: string[];
    saturating: string[];
    emerging_opportunities: string[];
  };
}

export class PatternRecommendationEngine {
  /**
   * Generate personalized pattern recommendations
   */
  async recommendPatterns(
    profile: CreatorProfile,
    availablePatterns: CreatorInsight[],
    context: RecommendationContext
  ): Promise<PatternRecommendation[]> {
    const recommendations: PatternRecommendation[] = [];
    
    // Score each pattern for this creator
    for (const pattern of availablePatterns) {
      const score = await this.scorePatternForCreator(pattern, profile, context);
      
      if (score.relevance >= 0.6) { // Minimum relevance threshold
        const recommendation = await this.buildRecommendation(
          pattern,
          profile,
          score,
          context
        );
        recommendations.push(recommendation);
      }
    }
    
    // Sort by priority and relevance
    return recommendations.sort((a, b) => {
      const priorityOrder = { immediate: 3, soon: 2, explore: 1 };
      const aPriority = priorityOrder[a.priority];
      const bPriority = priorityOrder[b.priority];
      
      if (aPriority !== bPriority) return bPriority - aPriority;
      return b.relevance_score - a.relevance_score;
    });
  }
  
  /**
   * Score a pattern's relevance for a specific creator
   */
  private async scorePatternForCreator(
    pattern: CreatorInsight,
    profile: CreatorProfile,
    context: RecommendationContext
  ): Promise<{relevance: number; factors: Record<string, number>}> {
    const factors: Record<string, number> = {};
    
    // 1. Lifecycle stage fit
    factors.lifecycle = this.scoreLifecycleFit(pattern.lifecycle, profile);
    
    // 2. Creator stage alignment
    factors.stage = this.scoreStageAlignment(pattern.best_for, profile);
    
    // 3. Goal alignment
    factors.goals = this.scoreGoalAlignment(pattern, profile.goals);
    
    // 4. Content style fit
    factors.style = this.scoreStyleFit(pattern, profile.content_style);
    
    // 5. Implementation feasibility
    factors.feasibility = this.scoreFeasibility(pattern, profile);
    
    // 6. Competitive advantage
    factors.competitive = this.scoreCompetitiveAdvantage(
      pattern,
      context.competitor_analysis
    );
    
    // 7. Market timing
    factors.timing = this.scoreMarketTiming(pattern, context.market_timing);
    
    // Calculate weighted relevance score
    const weights = {
      lifecycle: 0.2,
      stage: 0.15,
      goals: 0.2,
      style: 0.15,
      feasibility: 0.1,
      competitive: 0.1,
      timing: 0.1
    };
    
    const relevance = Object.entries(factors).reduce(
      (sum, [key, value]) => sum + (value * weights[key as keyof typeof weights]),
      0
    );
    
    return { relevance, factors };
  }
  
  /**
   * Score lifecycle fit based on creator's risk profile
   */
  private scoreLifecycleFit(
    lifecycle: PatternLifecycleStage,
    profile: CreatorProfile
  ): number {
    const riskScores = {
      low: { emerging: 0.3, growing: 0.7, mature: 1.0, saturated: 0.4, declining: 0.1 },
      medium: { emerging: 0.7, growing: 0.9, mature: 0.8, saturated: 0.3, declining: 0.1 },
      high: { emerging: 1.0, growing: 0.8, mature: 0.5, saturated: 0.2, declining: 0.1 }
    };
    
    return riskScores[profile.risk_tolerance][lifecycle.stage];
  }
  
  /**
   * Score creator stage alignment
   */
  private scoreStageAlignment(
    bestFor: CreatorStage[],
    profile: CreatorProfile
  ): number {
    const creatorStage = this.determineCreatorStage(profile);
    
    if (bestFor.includes(creatorStage)) return 1.0;
    
    // Partial credit for adjacent stages
    const stageOrder: CreatorStage[] = ['beginner', 'growing', 'established', 'expert'];
    const creatorIndex = stageOrder.indexOf(creatorStage);
    
    for (const stage of bestFor) {
      const stageIndex = stageOrder.indexOf(stage);
      const distance = Math.abs(creatorIndex - stageIndex);
      if (distance === 1) return 0.7; // Adjacent stage
    }
    
    return 0.3; // Not ideal but could work
  }
  
  /**
   * Determine creator's stage from profile
   */
  private determineCreatorStage(profile: CreatorProfile): CreatorStage {
    if (profile.subscriber_count < 1000) return 'beginner';
    if (profile.subscriber_count < 10000) return 'growing';
    if (profile.subscriber_count < 100000) return 'established';
    return 'expert';
  }
  
  /**
   * Score goal alignment
   */
  private scoreGoalAlignment(
    pattern: CreatorInsight,
    goals: CreatorGoal[]
  ): number {
    let score = 0;
    
    for (const goal of goals) {
      switch (goal) {
        case 'increase_views':
          // High-performance patterns align with view goals
          if (pattern.success_examples[0]?.performance_multiplier > 3) {
            score += 1.0;
          } else if (pattern.success_examples[0]?.performance_multiplier > 2) {
            score += 0.7;
          }
          break;
          
        case 'find_viral_hits':
          // Emerging patterns with high performance
          if (pattern.lifecycle.stage === 'emerging' && 
              pattern.success_examples[0]?.performance_multiplier > 5) {
            score += 1.0;
          }
          break;
          
        case 'save_time':
          // Simple patterns that are easy to implement
          if (pattern.how_to_apply.length <= 3) {
            score += 0.8;
          }
          break;
          
        case 'build_community':
          // Patterns that encourage engagement
          if (pattern.pattern_id.includes('question') || 
              pattern.pattern_id.includes('personal')) {
            score += 0.9;
          }
          break;
      }
    }
    
    return Math.min(score / goals.length, 1.0);
  }
  
  /**
   * Score content style fit
   */
  private scoreStyleFit(
    pattern: CreatorInsight,
    styles: ContentStyle[]
  ): number {
    // Extract style hints from pattern
    const patternStyles = this.extractPatternStyles(pattern);
    
    // Calculate overlap
    const overlap = styles.filter(style => patternStyles.includes(style)).length;
    
    if (overlap === 0) return 0.3; // Can adapt but not natural fit
    return Math.min(overlap / styles.length + 0.5, 1.0);
  }
  
  /**
   * Extract content styles from pattern
   */
  private extractPatternStyles(pattern: CreatorInsight): ContentStyle[] {
    const styles: ContentStyle[] = [];
    const text = JSON.stringify(pattern).toLowerCase();
    
    if (text.includes('tutorial') || text.includes('how to')) styles.push('tutorial');
    if (text.includes('review')) styles.push('review');
    if (text.includes('personal') || text.includes('story')) styles.push('personal');
    if (text.includes('educational') || text.includes('learn')) styles.push('educational');
    if (text.includes('entertainment') || text.includes('fun')) styles.push('entertainment');
    
    return styles;
  }
  
  /**
   * Score implementation feasibility
   */
  private scoreFeasibility(
    pattern: CreatorInsight,
    profile: CreatorProfile
  ): number {
    let score = 1.0;
    
    // Time availability impact
    if (profile.time_availability === 'limited' && pattern.how_to_apply.length > 5) {
      score *= 0.5;
    } else if (profile.time_availability === 'moderate' && pattern.how_to_apply.length > 7) {
      score *= 0.7;
    }
    
    // Complexity vs experience
    const creatorStage = this.determineCreatorStage(profile);
    if (creatorStage === 'beginner' && pattern.differentiation_tips.length > 3) {
      score *= 0.6; // Complex pattern for beginner
    }
    
    // Check if creator has necessary strengths
    const requiredSkills = this.extractRequiredSkills(pattern);
    const matchingStrengths = requiredSkills.filter(skill => 
      profile.strengths.some(strength => strength.toLowerCase().includes(skill))
    );
    
    score *= (matchingStrengths.length / Math.max(requiredSkills.length, 1));
    
    return score;
  }
  
  /**
   * Extract required skills from pattern
   */
  private extractRequiredSkills(pattern: CreatorInsight): string[] {
    const skills: string[] = [];
    const text = JSON.stringify(pattern).toLowerCase();
    
    if (text.includes('edit') || text.includes('production')) skills.push('editing');
    if (text.includes('script') || text.includes('write')) skills.push('writing');
    if (text.includes('thumbnail')) skills.push('design');
    if (text.includes('personality') || text.includes('charisma')) skills.push('personality');
    if (text.includes('data') || text.includes('analyz')) skills.push('analytics');
    
    return skills;
  }
  
  /**
   * Score competitive advantage
   */
  private scoreCompetitiveAdvantage(
    pattern: CreatorInsight,
    competitorAnalysis: RecommendationContext['competitor_analysis']
  ): number {
    // Pattern not used by competitors = advantage
    if (!competitorAnalysis.top_patterns.includes(pattern.pattern_id)) {
      return 0.9;
    }
    
    // Pattern addresses performance gap
    if (competitorAnalysis.performance_gaps.some(gap => 
      pattern.headline.toLowerCase().includes(gap.toLowerCase())
    )) {
      return 0.8;
    }
    
    return 0.5; // Neutral
  }
  
  /**
   * Score market timing
   */
  private scoreMarketTiming(
    pattern: CreatorInsight,
    marketTiming: RecommendationContext['market_timing']
  ): number {
    if (marketTiming.trending_up.includes(pattern.pattern_id)) {
      return 1.0;
    } else if (marketTiming.emerging_opportunities.includes(pattern.pattern_id)) {
      return 0.9;
    } else if (marketTiming.saturating.includes(pattern.pattern_id)) {
      return 0.3;
    }
    
    return 0.6; // Stable
  }
  
  /**
   * Build detailed recommendation
   */
  private async buildRecommendation(
    pattern: CreatorInsight,
    profile: CreatorProfile,
    score: {relevance: number; factors: Record<string, number>},
    context: RecommendationContext
  ): Promise<PatternRecommendation> {
    // Determine priority
    const priority = this.determinePriority(pattern, score, context);
    
    // Calculate implementation difficulty
    const difficulty = this.calculateDifficulty(pattern, profile);
    
    // Generate reasoning
    const reasoning = this.generateReasoning(pattern, score, profile, context);
    
    // Estimate impact
    const expectedImpact = this.estimateImpact(pattern, profile, context);
    
    // Create action plan
    const actionPlan = this.createActionPlan(pattern, profile, difficulty);
    
    // Calculate success probability
    const successProbability = this.calculateSuccessProbability(
      pattern,
      profile,
      score,
      context
    );
    
    return {
      pattern,
      relevance_score: score.relevance,
      reasoning,
      priority,
      implementation_difficulty: difficulty,
      expected_impact: expectedImpact,
      action_plan: actionPlan,
      success_probability
    };
  }
  
  /**
   * Determine recommendation priority
   */
  private determinePriority(
    pattern: CreatorInsight,
    score: {relevance: number; factors: Record<string, number>},
    context: RecommendationContext
  ): PatternRecommendation['priority'] {
    // Immediate: High relevance + good timing + easy to implement
    if (score.relevance > 0.8 && 
        score.factors.timing > 0.8 && 
        pattern.lifecycle.competitive_advantage > 0.7) {
      return 'immediate';
    }
    
    // Soon: Good relevance or about to trend
    if (score.relevance > 0.7 || 
        (pattern.lifecycle.stage === 'emerging' && score.factors.feasibility > 0.7)) {
      return 'soon';
    }
    
    return 'explore';
  }
  
  /**
   * Calculate implementation difficulty
   */
  private calculateDifficulty(
    pattern: CreatorInsight,
    profile: CreatorProfile
  ): PatternRecommendation['implementation_difficulty'] {
    const steps = pattern.how_to_apply.length;
    const creatorStage = this.determineCreatorStage(profile);
    
    if (steps <= 3 && creatorStage !== 'beginner') return 'easy';
    if (steps <= 5 || creatorStage === 'expert') return 'medium';
    return 'hard';
  }
  
  /**
   * Generate reasoning for recommendation
   */
  private generateReasoning(
    pattern: CreatorInsight,
    score: {relevance: number; factors: Record<string, number>},
    profile: CreatorProfile,
    context: RecommendationContext
  ): string[] {
    const reasons: string[] = [];
    
    // Lifecycle reasoning
    if (score.factors.lifecycle > 0.8) {
      if (pattern.lifecycle.stage === 'emerging') {
        reasons.push('Early adoption opportunity - be among the first to capitalize');
      } else if (pattern.lifecycle.stage === 'growing') {
        reasons.push('Pattern is gaining momentum with proven results');
      }
    }
    
    // Goal alignment
    if (score.factors.goals > 0.8) {
      reasons.push(`Directly supports your goal to ${profile.goals[0].replace('_', ' ')}`);
    }
    
    // Competitive advantage
    if (score.factors.competitive > 0.8) {
      reasons.push('Your competitors haven\'t discovered this yet');
    }
    
    // Performance potential
    const avgPerformance = pattern.success_examples.reduce(
      (sum, ex) => sum + ex.performance_multiplier, 0
    ) / pattern.success_examples.length;
    if (avgPerformance > 3) {
      reasons.push(`Top performers see ${avgPerformance.toFixed(1)}x average views`);
    }
    
    // Market timing
    if (score.factors.timing > 0.8) {
      reasons.push('Perfect timing - audience interest is peaking');
    }
    
    return reasons.slice(0, 4); // Top 4 reasons
  }
  
  /**
   * Estimate expected impact
   */
  private estimateImpact(
    pattern: CreatorInsight,
    profile: CreatorProfile,
    context: RecommendationContext
  ): PatternRecommendation['expected_impact'] {
    const basePerformance = pattern.success_examples[0]?.performance_multiplier || 2;
    
    // Adjust based on creator's current performance
    const adjustment = context.current_performance.view_velocity > 1.5 ? 0.8 : 1.0;
    const expectedMultiplier = basePerformance * adjustment;
    
    return {
      metric: 'video views',
      improvement: `${expectedMultiplier.toFixed(1)}-${(expectedMultiplier * 1.5).toFixed(1)}x`,
      timeframe: pattern.lifecycle.stage === 'emerging' ? '1-2 weeks' : '2-4 weeks'
    };
  }
  
  /**
   * Create actionable implementation plan
   */
  private createActionPlan(
    pattern: CreatorInsight,
    profile: CreatorProfile,
    difficulty: PatternRecommendation['implementation_difficulty']
  ): ActionStep[] {
    const plan: ActionStep[] = [];
    
    // Step 1: Study examples
    plan.push({
      step: 1,
      action: 'Study the top 5 performing videos using this pattern',
      resources_needed: ['30 minutes', 'Note-taking app'],
      estimated_time: '30 minutes',
      tips: [
        'Focus on how they implement the pattern, not just that they use it',
        'Note any unique twists or combinations with other elements',
        'Pay attention to thumbnail and title coordination'
      ]
    });
    
    // Step 2: Brainstorm adaptations
    plan.push({
      step: 2,
      action: 'Brainstorm 10 video ideas using the ideation framework',
      resources_needed: ['Ideation framework', 'Your content calendar'],
      estimated_time: '45 minutes',
      tips: pattern.differentiation_tips.slice(0, 2)
    });
    
    // Step 3: Create test video
    plan.push({
      step: 3,
      action: 'Create your first video implementing this pattern',
      resources_needed: ['Your normal production setup'],
      estimated_time: difficulty === 'easy' ? '2-4 hours' : '4-8 hours',
      tips: [
        'Start with your strongest idea from brainstorming',
        'Don\'t overthink - focus on clear execution',
        'Track performance metrics closely for learning'
      ]
    });
    
    // Step 4: Analyze and iterate
    plan.push({
      step: 4,
      action: 'Analyze performance after 48 hours and plan iterations',
      resources_needed: ['YouTube Analytics', 'Performance tracking sheet'],
      estimated_time: '30 minutes',
      tips: [
        'Compare CTR and retention to your channel average',
        'Note which elements resonated most with viewers',
        'Plan 2-3 variations for your next videos'
      ]
    });
    
    return plan;
  }
  
  /**
   * Calculate probability of success
   */
  private calculateSuccessProbability(
    pattern: CreatorInsight,
    profile: CreatorProfile,
    score: {relevance: number; factors: Record<string, number>},
    context: RecommendationContext
  ): number {
    let probability = 0.5; // Base probability
    
    // Relevance increases success chance
    probability += score.relevance * 0.2;
    
    // Good feasibility increases success
    probability += score.factors.feasibility * 0.15;
    
    // Market timing impact
    probability += score.factors.timing * 0.1;
    
    // Creator experience helps
    const stage = this.determineCreatorStage(profile);
    const stageBonus = {
      beginner: 0,
      growing: 0.05,
      established: 0.1,
      expert: 0.15
    };
    probability += stageBonus[stage];
    
    // Cap at realistic maximum
    return Math.min(probability, 0.85);
  }
}