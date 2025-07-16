/**
 * Pattern Lifecycle Tracker
 * Tracks the adoption curve and saturation of discovered patterns
 */

import { supabase } from './supabase';

export interface PatternLifecycleStage {
  stage: 'emerging' | 'growing' | 'mature' | 'saturated' | 'declining';
  confidence: number;
  first_seen_date: string;
  adoption_rate: number; // Videos per week using this pattern
  saturation_percentage: number; // % of videos in niche using this
  competitive_advantage: number; // 0-1 score of how much advantage remains
  estimated_window: string; // e.g., "2-3 weeks remaining"
}

export interface PatternTimeline {
  pattern_id: string;
  timeline: Array<{
    date: string;
    adoption_count: number;
    performance_avg: number;
    saturation_score: number;
  }>;
  forecast: Array<{
    date: string;
    predicted_saturation: number;
    confidence_interval: [number, number];
  }>;
}

export class PatternLifecycleTracker {
  /**
   * Analyze the lifecycle stage of a pattern
   */
  async analyzePatternLifecycle(
    patternId: string,
    videoIds: string[]
  ): Promise<PatternLifecycleStage> {
    // Get temporal data about pattern adoption
    const adoptionData = await this.getPatternAdoptionTimeline(patternId, videoIds);
    
    // Calculate growth rate
    const growthRate = this.calculateGrowthRate(adoptionData);
    
    // Calculate saturation
    const saturationData = await this.calculateSaturation(patternId, videoIds);
    
    // Determine lifecycle stage
    const stage = this.determineLifecycleStage(
      growthRate,
      saturationData.percentage,
      adoptionData
    );
    
    // Calculate competitive advantage
    const competitiveAdvantage = this.calculateCompetitiveAdvantage(
      stage,
      saturationData,
      adoptionData
    );
    
    // Estimate window of opportunity
    const window = this.estimateOpportunityWindow(
      stage,
      growthRate,
      saturationData
    );
    
    return {
      stage,
      confidence: this.calculateConfidence(adoptionData, saturationData),
      first_seen_date: adoptionData[0]?.date || new Date().toISOString(),
      adoption_rate: growthRate.weeklyRate,
      saturation_percentage: saturationData.percentage,
      competitive_advantage,
      estimated_window: window
    };
  }
  
  /**
   * Get pattern adoption timeline
   */
  private async getPatternAdoptionTimeline(
    patternId: string,
    videoIds: string[]
  ): Promise<Array<{date: string; count: number; performance: number}>> {
    const { data, error } = await supabase
      .from('videos')
      .select('published_at, view_count, rolling_baseline_views')
      .in('id', videoIds)
      .order('published_at', { ascending: true });
    
    if (error || !data) return [];
    
    // Group by week
    const weeklyData = new Map<string, {count: number; totalPerf: number}>();
    
    data.forEach(video => {
      const week = this.getWeekStart(new Date(video.published_at));
      const perf = video.view_count / (video.rolling_baseline_views || 1);
      
      if (!weeklyData.has(week)) {
        weeklyData.set(week, { count: 0, totalPerf: 0 });
      }
      
      const weekData = weeklyData.get(week)!;
      weekData.count++;
      weekData.totalPerf += perf;
    });
    
    return Array.from(weeklyData.entries()).map(([date, data]) => ({
      date,
      count: data.count,
      performance: data.totalPerf / data.count
    }));
  }
  
  /**
   * Calculate pattern saturation in the niche
   */
  private async calculateSaturation(
    patternId: string,
    patternVideoIds: string[]
  ): Promise<{percentage: number; totalVideos: number}> {
    // Get topic cluster from pattern videos
    const { data: patternVideos } = await supabase
      .from('videos')
      .select('topic_cluster_id')
      .in('id', patternVideoIds.slice(0, 10))
      .limit(1);
    
    if (!patternVideos?.length) {
      return { percentage: 0, totalVideos: 0 };
    }
    
    const topicClusterId = patternVideos[0].topic_cluster_id;
    
    // Get total recent videos in this topic
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    
    const { count: totalVideos } = await supabase
      .from('videos')
      .select('*', { count: 'exact', head: true })
      .eq('topic_cluster_id', topicClusterId)
      .gte('published_at', thirtyDaysAgo.toISOString());
    
    const percentage = (patternVideoIds.length / (totalVideos || 1)) * 100;
    
    return {
      percentage: Math.min(percentage, 100),
      totalVideos: totalVideos || 0
    };
  }
  
  /**
   * Calculate growth rate
   */
  private calculateGrowthRate(
    timeline: Array<{date: string; count: number; performance: number}>
  ): {weeklyRate: number; acceleration: number} {
    if (timeline.length < 2) {
      return { weeklyRate: 0, acceleration: 0 };
    }
    
    // Calculate week-over-week growth
    const growthRates: number[] = [];
    for (let i = 1; i < timeline.length; i++) {
      const prevCount = timeline[i - 1].count;
      const currCount = timeline[i].count;
      const growth = prevCount > 0 ? (currCount - prevCount) / prevCount : 0;
      growthRates.push(growth);
    }
    
    const avgGrowth = growthRates.reduce((a, b) => a + b, 0) / growthRates.length;
    
    // Calculate acceleration (is growth speeding up or slowing down?)
    let acceleration = 0;
    if (growthRates.length >= 2) {
      const recentGrowth = growthRates.slice(-2).reduce((a, b) => a + b, 0) / 2;
      const earlierGrowth = growthRates.slice(0, 2).reduce((a, b) => a + b, 0) / 2;
      acceleration = recentGrowth - earlierGrowth;
    }
    
    return {
      weeklyRate: avgGrowth,
      acceleration
    };
  }
  
  /**
   * Determine lifecycle stage based on metrics
   */
  private determineLifecycleStage(
    growthRate: {weeklyRate: number; acceleration: number},
    saturationPercentage: number,
    timeline: Array<{date: string; count: number; performance: number}>
  ): PatternLifecycleStage['stage'] {
    // Check performance trend
    const performanceTrend = this.calculatePerformanceTrend(timeline);
    
    if (saturationPercentage < 5 && growthRate.weeklyRate > 0.5) {
      return 'emerging';
    } else if (saturationPercentage < 20 && growthRate.weeklyRate > 0.2) {
      return 'growing';
    } else if (saturationPercentage < 50 && growthRate.acceleration >= 0) {
      return 'mature';
    } else if (saturationPercentage >= 50 || performanceTrend < -0.1) {
      return 'saturated';
    } else if (growthRate.weeklyRate < -0.1 && performanceTrend < -0.2) {
      return 'declining';
    }
    
    return 'mature'; // Default
  }
  
  /**
   * Calculate performance trend
   */
  private calculatePerformanceTrend(
    timeline: Array<{date: string; count: number; performance: number}>
  ): number {
    if (timeline.length < 3) return 0;
    
    const recentPerf = timeline.slice(-3).reduce((sum, t) => sum + t.performance, 0) / 3;
    const earlierPerf = timeline.slice(0, 3).reduce((sum, t) => sum + t.performance, 0) / 3;
    
    return (recentPerf - earlierPerf) / earlierPerf;
  }
  
  /**
   * Calculate remaining competitive advantage
   */
  private calculateCompetitiveAdvantage(
    stage: PatternLifecycleStage['stage'],
    saturationData: {percentage: number},
    timeline: Array<{date: string; count: number; performance: number}>
  ): number {
    let advantage = 1.0;
    
    // Reduce by saturation
    advantage *= (1 - saturationData.percentage / 100);
    
    // Reduce by stage
    const stageMultipliers = {
      'emerging': 1.0,
      'growing': 0.8,
      'mature': 0.5,
      'saturated': 0.2,
      'declining': 0.1
    };
    advantage *= stageMultipliers[stage];
    
    // Reduce if performance is declining
    const perfTrend = this.calculatePerformanceTrend(timeline);
    if (perfTrend < 0) {
      advantage *= (1 + perfTrend); // perfTrend is negative
    }
    
    return Math.max(0, Math.min(1, advantage));
  }
  
  /**
   * Estimate window of opportunity
   */
  private estimateOpportunityWindow(
    stage: PatternLifecycleStage['stage'],
    growthRate: {weeklyRate: number},
    saturationData: {percentage: number}
  ): string {
    if (stage === 'saturated' || stage === 'declining') {
      return 'Window has closed';
    }
    
    if (stage === 'emerging') {
      return '4-8 weeks of high opportunity';
    }
    
    // Calculate weeks until saturation at current growth rate
    const remainingSaturation = 50 - saturationData.percentage; // Target 50% as "saturated"
    const weeksToSaturation = remainingSaturation / (growthRate.weeklyRate * 100);
    
    if (weeksToSaturation < 1) {
      return 'Less than 1 week remaining';
    } else if (weeksToSaturation < 2) {
      return '1-2 weeks remaining';
    } else if (weeksToSaturation < 4) {
      return '2-4 weeks remaining';
    } else {
      return '4+ weeks of opportunity';
    }
  }
  
  /**
   * Calculate confidence in lifecycle analysis
   */
  private calculateConfidence(
    timeline: Array<{date: string; count: number; performance: number}>,
    saturationData: {percentage: number; totalVideos: number}
  ): number {
    let confidence = 0.5; // Base confidence
    
    // More data points = higher confidence
    confidence += Math.min(timeline.length / 20, 0.3);
    
    // More total videos = higher confidence
    confidence += Math.min(saturationData.totalVideos / 1000, 0.2);
    
    return Math.min(confidence, 1.0);
  }
  
  /**
   * Get week start date
   */
  private getWeekStart(date: Date): string {
    const d = new Date(date);
    const day = d.getDay();
    const diff = d.getDate() - day;
    d.setDate(diff);
    d.setHours(0, 0, 0, 0);
    return d.toISOString().split('T')[0];
  }
  
  /**
   * Forecast pattern saturation
   */
  async forecastPatternSaturation(
    patternId: string,
    videoIds: string[],
    weeksAhead: number = 4
  ): Promise<PatternTimeline['forecast']> {
    const timeline = await this.getPatternAdoptionTimeline(patternId, videoIds);
    const growthRate = this.calculateGrowthRate(timeline);
    const currentSaturation = await this.calculateSaturation(patternId, videoIds);
    
    const forecast: PatternTimeline['forecast'] = [];
    let projectedSaturation = currentSaturation.percentage;
    
    for (let week = 1; week <= weeksAhead; week++) {
      // Apply growth with decay factor
      const decayFactor = Math.pow(0.9, week); // Growth slows over time
      const weeklyGrowth = growthRate.weeklyRate * decayFactor;
      projectedSaturation += projectedSaturation * weeklyGrowth;
      
      // Calculate confidence interval
      const uncertainty = week * 0.1; // Uncertainty increases over time
      const lowerBound = projectedSaturation * (1 - uncertainty);
      const upperBound = Math.min(100, projectedSaturation * (1 + uncertainty));
      
      const futureDate = new Date();
      futureDate.setDate(futureDate.getDate() + (week * 7));
      
      forecast.push({
        date: futureDate.toISOString(),
        predicted_saturation: Math.min(100, projectedSaturation),
        confidence_interval: [lowerBound, upperBound]
      });
    }
    
    return forecast;
  }
}