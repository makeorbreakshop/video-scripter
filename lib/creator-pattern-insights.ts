/**
 * Creator Pattern Insights
 * Transforms raw patterns into actionable creator insights with ideation support
 */

import { supabase } from './supabase';
import { AnthropicAPI } from './anthropic-api';
import { PatternLifecycleTracker, PatternLifecycleStage } from './pattern-lifecycle-tracker';

export interface CreatorInsight {
  pattern_id: string;
  headline: string; // Compelling headline that sparks ideas
  why_it_works: string; // Psychology/mechanism explanation
  how_to_apply: string[]; // Specific implementation steps
  video_ideas: string[]; // 3-5 concrete video ideas
  best_for: CreatorStage[]; // Which creators benefit most
  success_examples: VideoExample[];
  lifecycle: PatternLifecycleStage;
  risk_factors: string[];
  differentiation_tips: string[]; // How to stand out even with this pattern
  combinations: PatternCombination[]; // Patterns that work well together
}

export interface VideoExample {
  video_id: string;
  title: string;
  channel_name: string;
  view_count: number;
  performance_multiplier: number;
  key_elements: string[]; // What specifically made this work
  thumbnail_url?: string;
}

export interface PatternCombination {
  pattern_ids: string[];
  synergy_score: number;
  explanation: string;
  example_videos: string[];
}

export type CreatorStage = 'beginner' | 'growing' | 'established' | 'expert';

export interface IdeationFramework {
  pattern_id: string;
  framework_type: 'formula' | 'template' | 'checklist' | 'matrix';
  name: string;
  description: string;
  components: FrameworkComponent[];
  examples: FrameworkExample[];
}

export interface FrameworkComponent {
  name: string;
  description: string;
  options?: string[];
  required: boolean;
}

export interface FrameworkExample {
  title: string;
  breakdown: Record<string, string>;
  performance: number;
}

export class CreatorPatternInsights {
  private anthropic: AnthropicAPI;
  private lifecycleTracker: PatternLifecycleTracker;
  
  constructor() {
    this.anthropic = new AnthropicAPI();
    this.lifecycleTracker = new PatternLifecycleTracker();
  }
  
  /**
   * Transform a raw pattern into creator-focused insights
   */
  async generateCreatorInsights(
    pattern: any,
    videoIds: string[]
  ): Promise<CreatorInsight> {
    // Get lifecycle stage
    const lifecycle = await this.lifecycleTracker.analyzePatternLifecycle(
      pattern.id,
      videoIds
    );
    
    // Get success examples
    const examples = await this.getSuccessExamples(videoIds, pattern);
    
    // Generate insights using Claude
    const insights = await this.generateInsightsWithAI(pattern, examples, lifecycle);
    
    // Find pattern combinations
    const combinations = await this.findPatternCombinations(pattern, videoIds);
    
    // Determine best creator stages
    const bestFor = this.determineCreatorStages(pattern, lifecycle);
    
    return {
      pattern_id: pattern.id,
      headline: insights.headline,
      why_it_works: insights.why_it_works,
      how_to_apply: insights.how_to_apply,
      video_ideas: insights.video_ideas,
      best_for: bestFor,
      success_examples: examples,
      lifecycle,
      risk_factors: insights.risk_factors,
      differentiation_tips: insights.differentiation_tips,
      combinations
    };
  }
  
  /**
   * Get successful video examples
   */
  private async getSuccessExamples(
    videoIds: string[],
    pattern: any
  ): Promise<VideoExample[]> {
    const { data: videos } = await supabase
      .from('videos')
      .select(`
        id,
        title,
        channel_name,
        view_count,
        rolling_baseline_views,
        channel_avg_views,
        thumbnail_url,
        published_at,
        duration,
        topic_cluster_id
      `)
      .in('id', videoIds)
      .order('view_count', { ascending: false })
      .limit(10);
    
    if (!videos) return [];
    
    // Analyze what made each video successful
    const examples: VideoExample[] = [];
    
    for (const video of videos.slice(0, 5)) {
      const baseline = video.rolling_baseline_views || video.channel_avg_views || 1;
      const multiplier = video.view_count / baseline;
      
      // Extract key elements that made this video work
      const keyElements = await this.extractKeyElements(video, pattern);
      
      examples.push({
        video_id: video.id,
        title: video.title,
        channel_name: video.channel_name,
        view_count: video.view_count,
        performance_multiplier: multiplier,
        key_elements: keyElements,
        thumbnail_url: video.thumbnail_url
      });
    }
    
    return examples;
  }
  
  /**
   * Extract key elements that made a video successful
   */
  private async extractKeyElements(video: any, pattern: any): Promise<string[]> {
    const elements: string[] = [];
    
    // Pattern-specific elements
    switch (pattern.pattern_type) {
      case 'title':
        if (pattern.pattern_data.ngram) {
          elements.push(`Uses "${pattern.pattern_data.ngram}" effectively`);
        }
        if (video.title.includes('?')) {
          elements.push('Question creates curiosity gap');
        }
        if (/\d+/.test(video.title)) {
          elements.push('Number provides specificity');
        }
        break;
        
      case 'duration':
        elements.push(`Optimal ${pattern.pattern_data.duration_range} length`);
        break;
        
      case 'format':
        elements.push(`${pattern.pattern_data.format} format execution`);
        break;
    }
    
    // Universal elements
    if (video.view_count > video.channel_avg_views * 10) {
      elements.push('Viral breakthrough performance');
    }
    
    // Timing elements
    const publishDate = new Date(video.published_at);
    const dayOfWeek = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][publishDate.getDay()];
    if (['Tuesday', 'Thursday', 'Saturday'].includes(dayOfWeek)) {
      elements.push(`Published on high-engagement ${dayOfWeek}`);
    }
    
    return elements;
  }
  
  /**
   * Generate insights using Claude
   */
  private async generateInsightsWithAI(
    pattern: any,
    examples: VideoExample[],
    lifecycle: PatternLifecycleStage
  ): Promise<{
    headline: string;
    why_it_works: string;
    how_to_apply: string[];
    video_ideas: string[];
    risk_factors: string[];
    differentiation_tips: string[];
  }> {
    const prompt = `You are a YouTube strategist helping creators understand and apply successful content patterns.

Pattern Analysis:
${JSON.stringify(pattern.pattern_data, null, 2)}

Performance: ${pattern.performance_stats.avg || pattern.performance_stats.overall?.avg}x baseline
Lifecycle Stage: ${lifecycle.stage} (${lifecycle.saturation_percentage.toFixed(1)}% saturated)
Competitive Advantage: ${(lifecycle.competitive_advantage * 100).toFixed(0)}%

Top Examples:
${examples.map(ex => `- "${ex.title}" (${ex.performance_multiplier.toFixed(1)}x performance)`).join('\n')}

Generate creator insights:

1. Headline: Write a compelling headline that makes creators want to use this pattern (focus on the benefit, not the pattern itself)

2. Why It Works: Explain the psychological/algorithmic mechanism in 2-3 sentences that creators can understand

3. How to Apply: List 4-5 specific, actionable steps to implement this pattern effectively

4. Video Ideas: Generate 5 concrete video ideas that use this pattern (specific titles creators could use)

5. Risk Factors: List 2-3 risks or pitfalls to avoid when using this pattern

6. Differentiation Tips: Provide 3-4 ways to stand out even when using this popular pattern

Format as JSON with these exact keys: headline, why_it_works, how_to_apply, video_ideas, risk_factors, differentiation_tips`;

    try {
      const response = await this.anthropic.generateJSON({
        prompt,
        model: 'claude-3-5-sonnet-20241022',
        maxTokens: 2000,
        temperature: 0.7
      });
      
      return response;
    } catch (error) {
      console.error('Error generating AI insights:', error);
      
      // Fallback insights
      return {
        headline: `${pattern.pattern_data.name} drives ${pattern.performance_stats.avg?.toFixed(1)}x performance`,
        why_it_works: 'This pattern has shown consistent success in your niche.',
        how_to_apply: ['Study the top examples', 'Adapt to your style', 'Test and iterate'],
        video_ideas: ['Example video 1', 'Example video 2', 'Example video 3'],
        risk_factors: ['Pattern may be saturating', 'Requires authentic implementation'],
        differentiation_tips: ['Add your unique perspective', 'Combine with other patterns', 'Focus on execution quality']
      };
    }
  }
  
  /**
   * Find patterns that work well together
   */
  private async findPatternCombinations(
    pattern: any,
    videoIds: string[]
  ): Promise<PatternCombination[]> {
    // Get other patterns used by these successful videos
    const { data: videoPatterns } = await supabase
      .from('video_patterns')
      .select('pattern_id, video_id')
      .in('video_id', videoIds.slice(0, 50))
      .neq('pattern_id', pattern.id);
    
    if (!videoPatterns) return [];
    
    // Count co-occurrences
    const coOccurrences = new Map<string, number>();
    const patternVideos = new Map<string, Set<string>>();
    
    videoPatterns.forEach(vp => {
      if (!coOccurrences.has(vp.pattern_id)) {
        coOccurrences.set(vp.pattern_id, 0);
        patternVideos.set(vp.pattern_id, new Set());
      }
      coOccurrences.set(vp.pattern_id, coOccurrences.get(vp.pattern_id)! + 1);
      patternVideos.get(vp.pattern_id)!.add(vp.video_id);
    });
    
    // Get pattern details for top co-occurring patterns
    const topPatternIds = Array.from(coOccurrences.entries())
      .sort(([, a], [, b]) => b - a)
      .slice(0, 5)
      .map(([id]) => id);
    
    const { data: patterns } = await supabase
      .from('patterns')
      .select('*')
      .in('id', topPatternIds);
    
    if (!patterns) return [];
    
    // Calculate synergy and create combinations
    const combinations: PatternCombination[] = [];
    
    for (const otherPattern of patterns) {
      const sharedVideos = Array.from(patternVideos.get(otherPattern.id) || []);
      const synergy = await this.calculateSynergy(pattern, otherPattern, sharedVideos);
      
      if (synergy.score > 0.7) {
        combinations.push({
          pattern_ids: [pattern.id, otherPattern.id],
          synergy_score: synergy.score,
          explanation: synergy.explanation,
          example_videos: sharedVideos.slice(0, 3)
        });
      }
    }
    
    return combinations.slice(0, 3); // Top 3 combinations
  }
  
  /**
   * Calculate synergy between patterns
   */
  private async calculateSynergy(
    pattern1: any,
    pattern2: any,
    sharedVideoIds: string[]
  ): Promise<{score: number; explanation: string}> {
    if (sharedVideoIds.length < 5) {
      return { score: 0, explanation: 'Insufficient data' };
    }
    
    // Get performance of videos using both patterns
    const { data: videos } = await supabase
      .from('videos')
      .select('view_count, rolling_baseline_views, channel_avg_views')
      .in('id', sharedVideoIds);
    
    if (!videos) return { score: 0, explanation: 'No performance data' };
    
    const avgPerformance = videos.reduce((sum, v) => {
      const baseline = v.rolling_baseline_views || v.channel_avg_views || 1;
      return sum + (v.view_count / baseline);
    }, 0) / videos.length;
    
    // High performance = high synergy
    const synergyScore = Math.min(avgPerformance / 3, 1); // 3x performance = perfect synergy
    
    // Generate explanation
    let explanation = '';
    if (synergyScore > 0.8) {
      explanation = `These patterns amplify each other - videos using both see ${avgPerformance.toFixed(1)}x performance`;
    } else if (synergyScore > 0.6) {
      explanation = `Good combination - complementary patterns that work well together`;
    } else {
      explanation = `Limited synergy - patterns can work together but don't amplify results`;
    }
    
    return { score: synergyScore, explanation };
  }
  
  /**
   * Determine which creator stages benefit most
   */
  private determineCreatorStages(
    pattern: any,
    lifecycle: PatternLifecycleStage
  ): CreatorStage[] {
    const stages: CreatorStage[] = [];
    
    // Emerging patterns are great for established creators who can move fast
    if (lifecycle.stage === 'emerging') {
      stages.push('established', 'expert');
    }
    
    // Growing patterns good for growing channels
    if (lifecycle.stage === 'growing') {
      stages.push('growing', 'established');
    }
    
    // Mature patterns safe for beginners
    if (lifecycle.stage === 'mature') {
      stages.push('beginner', 'growing');
    }
    
    // Pattern complexity
    if (pattern.pattern_type === 'compound' || pattern.pattern_data.complexity === 'high') {
      stages.push('expert');
    } else {
      stages.push('beginner');
    }
    
    // Remove duplicates
    return [...new Set(stages)];
  }
  
  /**
   * Generate ideation framework for a pattern
   */
  async generateIdeationFramework(
    pattern: any,
    insights: CreatorInsight
  ): Promise<IdeationFramework> {
    const frameworkType = this.determineFrameworkType(pattern);
    
    switch (frameworkType) {
      case 'formula':
        return this.generateFormulaFramework(pattern, insights);
      case 'template':
        return this.generateTemplateFramework(pattern, insights);
      case 'checklist':
        return this.generateChecklistFramework(pattern, insights);
      case 'matrix':
        return this.generateMatrixFramework(pattern, insights);
    }
  }
  
  /**
   * Determine best framework type for pattern
   */
  private determineFrameworkType(pattern: any): IdeationFramework['framework_type'] {
    if (pattern.pattern_type === 'title' && pattern.pattern_data.template) {
      return 'template';
    } else if (pattern.pattern_type === 'compound') {
      return 'checklist';
    } else if (pattern.pattern_data.variables && pattern.pattern_data.variables.length > 2) {
      return 'matrix';
    }
    return 'formula';
  }
  
  /**
   * Generate formula-based framework
   */
  private async generateFormulaFramework(
    pattern: any,
    insights: CreatorInsight
  ): Promise<IdeationFramework> {
    return {
      pattern_id: pattern.id,
      framework_type: 'formula',
      name: `${pattern.pattern_data.name} Formula`,
      description: `Step-by-step formula to implement the ${pattern.pattern_data.name}`,
      components: [
        {
          name: 'Hook',
          description: 'Opening element that grabs attention',
          options: this.extractHookOptions(insights.success_examples),
          required: true
        },
        {
          name: 'Core Value',
          description: 'Main benefit or transformation promised',
          required: true
        },
        {
          name: 'Specificity',
          description: 'Specific detail that adds credibility',
          options: ['Number', 'Timeframe', 'Result', 'Method'],
          required: false
        }
      ],
      examples: insights.success_examples.slice(0, 3).map(ex => ({
        title: ex.title,
        breakdown: this.breakdownTitle(ex.title, pattern),
        performance: ex.performance_multiplier
      }))
    };
  }
  
  /**
   * Generate template-based framework
   */
  private async generateTemplateFramework(
    pattern: any,
    insights: CreatorInsight
  ): Promise<IdeationFramework> {
    return {
      pattern_id: pattern.id,
      framework_type: 'template',
      name: `${pattern.pattern_data.name} Templates`,
      description: `Fill-in-the-blank templates based on top performers`,
      components: [
        {
          name: 'Template 1',
          description: pattern.pattern_data.template || 'Primary template structure',
          required: true
        },
        {
          name: 'Variables',
          description: 'Elements you can customize',
          options: pattern.pattern_data.variables || ['Topic', 'Number', 'Outcome'],
          required: true
        }
      ],
      examples: this.generateTemplateExamples(pattern, insights)
    };
  }
  
  /**
   * Generate checklist framework
   */
  private async generateChecklistFramework(
    pattern: any,
    insights: CreatorInsight
  ): Promise<IdeationFramework> {
    return {
      pattern_id: pattern.id,
      framework_type: 'checklist',
      name: `${pattern.pattern_data.name} Checklist`,
      description: 'Essential elements to include for maximum impact',
      components: insights.how_to_apply.map((step, i) => ({
        name: `Element ${i + 1}`,
        description: step,
        required: i < 3 // First 3 are required
      })),
      examples: insights.success_examples.slice(0, 2).map(ex => ({
        title: ex.title,
        breakdown: {
          'Checklist Score': `${ex.key_elements.length}/5 elements`,
          'Key Strengths': ex.key_elements.join(', ')
        },
        performance: ex.performance_multiplier
      }))
    };
  }
  
  /**
   * Generate matrix framework
   */
  private async generateMatrixFramework(
    pattern: any,
    insights: CreatorInsight
  ): Promise<IdeationFramework> {
    return {
      pattern_id: pattern.id,
      framework_type: 'matrix',
      name: `${pattern.pattern_data.name} Idea Matrix`,
      description: 'Combine different elements to generate unique video ideas',
      components: [
        {
          name: 'Format',
          description: 'Video format to use',
          options: ['Tutorial', 'List', 'Story', 'Review', 'Experiment'],
          required: true
        },
        {
          name: 'Angle',
          description: 'Unique perspective or hook',
          options: ['Beginner', 'Advanced', 'Controversial', 'Personal', 'Data-driven'],
          required: true
        },
        {
          name: 'Outcome',
          description: 'What viewers will gain',
          options: ['Learn', 'Save time', 'Make money', 'Avoid mistakes', 'Get inspired'],
          required: true
        }
      ],
      examples: this.generateMatrixExamples(insights)
    };
  }
  
  // Helper methods
  private extractHookOptions(examples: VideoExample[]): string[] {
    const hooks = new Set<string>();
    examples.forEach(ex => {
      if (ex.title.includes('How')) hooks.add('How to');
      if (ex.title.includes('Why')) hooks.add('Why');
      if (ex.title.includes('?')) hooks.add('Question');
      if (/^\d+/.test(ex.title)) hooks.add('Number list');
      if (ex.title.includes('I ')) hooks.add('Personal story');
    });
    return Array.from(hooks);
  }
  
  private breakdownTitle(title: string, pattern: any): Record<string, string> {
    const breakdown: Record<string, string> = {};
    
    if (pattern.pattern_type === 'title') {
      breakdown['Pattern Element'] = pattern.pattern_data.ngram || pattern.pattern_data.name;
      breakdown['Hook Type'] = title.includes('?') ? 'Question' : 
                              title.includes('How') ? 'How-to' : 
                              /^\d+/.test(title) ? 'Listicle' : 'Statement';
    }
    
    if (/\d+/.test(title)) {
      breakdown['Number Used'] = title.match(/\d+/)?.[0] || 'N/A';
    }
    
    breakdown['Word Count'] = title.split(' ').length.toString();
    
    return breakdown;
  }
  
  private generateTemplateExamples(pattern: any, insights: CreatorInsight): FrameworkExample[] {
    return insights.video_ideas.slice(0, 3).map((idea, i) => ({
      title: idea,
      breakdown: {
        'Template Used': pattern.pattern_data.template || 'Custom',
        'Customization': 'Your unique angle here',
        'Expected Performance': `${(2 + i * 0.5).toFixed(1)}x baseline`
      },
      performance: 2 + i * 0.5
    }));
  }
  
  private generateMatrixExamples(insights: CreatorInsight): FrameworkExample[] {
    const combinations = [
      { format: 'Tutorial', angle: 'Beginner', outcome: 'Learn' },
      { format: 'List', angle: 'Data-driven', outcome: 'Save time' },
      { format: 'Story', angle: 'Personal', outcome: 'Get inspired' }
    ];
    
    return combinations.map((combo, i) => ({
      title: insights.video_ideas[i] || 'Generated idea',
      breakdown: combo,
      performance: 2.5 - (i * 0.3)
    }));
  }
}