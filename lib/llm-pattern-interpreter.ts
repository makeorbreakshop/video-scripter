import { AnthropicAPI } from './anthropic-api';

export interface PatternCandidate {
  pattern_type: string;
  pattern_data: {
    name: string;
    template?: string;
    description?: string;
    evidence_count: number;
    confidence: number;
    examples?: string[];
  };
  performance_stats: {
    avg: number;
    median?: number;
    count: number;
  };
  context?: {
    topic_cluster?: string;
    format?: string;
    duration_range?: string;
  };
}

export interface InterpretedPattern extends PatternCandidate {
  llm_analysis: {
    is_meaningful: boolean;
    actionability_score: number; // 1-10
    why_it_works: string;
    best_use_cases: string[];
    warnings?: string[];
    semantic_category: string; // e.g., "psychological", "format", "timing"
    confidence: number;
  };
}

export class LLMPatternInterpreter {
  private anthropic: AnthropicAPI;

  constructor() {
    this.anthropic = new AnthropicAPI();
  }

  async analyzePatterns(
    patterns: PatternCandidate[],
    options: {
      batchSize?: number;
      videoContext?: any;
    } = {}
  ): Promise<InterpretedPattern[]> {
    const { batchSize = 10 } = options;
    const interpretedPatterns: InterpretedPattern[] = [];

    // Process in batches for efficiency
    for (let i = 0; i < patterns.length; i += batchSize) {
      const batch = patterns.slice(i, i + batchSize);
      const batchResults = await this.analyzeBatch(batch, options.videoContext);
      interpretedPatterns.push(...batchResults);
    }

    // Filter out non-meaningful patterns
    return interpretedPatterns.filter(p => p.llm_analysis.is_meaningful);
  }

  private async analyzeBatch(
    patterns: PatternCandidate[],
    videoContext?: any
  ): Promise<InterpretedPattern[]> {
    const prompt = this.buildAnalysisPrompt(patterns, videoContext);
    
    try {
      const response = await this.anthropic.generateText({
        prompt,
        model: 'claude-3-5-sonnet-20241022',
        maxTokens: 4000,
        temperature: 0.3, // Lower temperature for consistent analysis
      });

      return this.parseResponse(response.text, patterns);
    } catch (error) {
      console.error('Error analyzing patterns with Claude:', error);
      // Return patterns without analysis on error
      return patterns.map(p => ({
        ...p,
        llm_analysis: {
          is_meaningful: false,
          actionability_score: 0,
          why_it_works: 'Analysis failed',
          best_use_cases: [],
          semantic_category: 'unknown',
          confidence: 0
        }
      }));
    }
  }

  private buildAnalysisPrompt(patterns: PatternCandidate[], videoContext?: any): string {
    const contextInfo = videoContext ? `
Video Context:
- Topic/Niche: ${videoContext.topic || 'Unknown'}
- Total Videos Analyzed: ${videoContext.videoCount || 'Unknown'}
- Performance Baseline: ${videoContext.avgPerformance || '1.0'}x
` : '';

    return `You are analyzing YouTube video patterns to help creators improve their content. Your goal is to identify which patterns are truly meaningful and actionable vs generic/obvious patterns.

${contextInfo}

Analyze each pattern below and provide:
1. is_meaningful (boolean): Is this pattern actually useful or just statistical noise?
2. actionability_score (1-10): How actionable is this for creators?
3. why_it_works: Brief explanation of the psychology/mechanism
4. best_use_cases: Specific scenarios where this pattern excels
5. warnings: Any risks or caveats (optional)
6. semantic_category: Type of pattern (psychological/format/timing/emotional/structural)
7. confidence (0-1): Your confidence in this analysis

Reject patterns that are:
- Too generic (e.g., "contains common words")
- Obvious (e.g., "videos with more views perform better")
- Not actionable (e.g., "contains the letter 'a'")
- Statistical artifacts without real meaning

Patterns to analyze:
${patterns.map((p, i) => `
Pattern ${i + 1}:
- Type: ${p.pattern_type}
- Name: ${p.pattern_data.name}
- Template: ${p.pattern_data.template || 'N/A'}
- Performance: ${p.performance_stats.avg}x average (${p.performance_stats.count} videos)
- Evidence: ${p.pattern_data.evidence_count} examples
- Examples: ${(p.pattern_data.examples || []).slice(0, 3).join(', ')}
${p.context ? `- Context: ${JSON.stringify(p.context)}` : ''}
`).join('\n')}

Respond with a JSON array where each object contains the analysis fields listed above. Be harsh in filtering - only truly valuable patterns should pass.`;
  }

  private parseResponse(responseText: string, originalPatterns: PatternCandidate[]): InterpretedPattern[] {
    try {
      // Extract JSON from response (Claude might add explanation text)
      const jsonMatch = responseText.match(/\[[\s\S]*\]/);
      if (!jsonMatch) {
        throw new Error('No JSON array found in response');
      }

      const analyses = JSON.parse(jsonMatch[0]);
      
      return originalPatterns.map((pattern, index) => {
        const analysis = analyses[index] || {
          is_meaningful: false,
          actionability_score: 0,
          why_it_works: 'No analysis available',
          best_use_cases: [],
          semantic_category: 'unknown',
          confidence: 0
        };

        return {
          ...pattern,
          llm_analysis: analysis
        };
      });
    } catch (error) {
      console.error('Error parsing Claude response:', error);
      throw error;
    }
  }

  async generatePatternInsight(pattern: InterpretedPattern): Promise<string> {
    const prompt = `Based on this YouTube pattern analysis, write a concise, actionable insight for creators:

Pattern: ${pattern.pattern_data.name}
Performance: ${pattern.performance_stats.avg}x average
Why it works: ${pattern.llm_analysis.why_it_works}
Best for: ${pattern.llm_analysis.best_use_cases.join(', ')}

Write 2-3 sentences that:
1. Explain what to do
2. Why it works in simple terms
3. When to use it

Be specific and actionable. Avoid generic advice.`;

    const response = await this.anthropic.generateText({
      prompt,
      model: 'claude-3-5-sonnet-20241022',
      maxTokens: 200,
      temperature: 0.5,
    });

    return response.text.trim();
  }
}

// Example usage:
/*
const interpreter = new LLMPatternInterpreter();

const patterns = [
  {
    pattern_type: 'title',
    pattern_data: {
      name: 'Contains "a"',
      template: '*a*',
      evidence_count: 50000,
      confidence: 0.99,
      examples: ['How to make a cake', 'Building a house']
    },
    performance_stats: { avg: 1.1, count: 50000 }
  },
  {
    pattern_type: 'title',
    pattern_data: {
      name: 'Hashtag titles',
      template: '[Topic] #keyword #keyword',
      evidence_count: 47,
      confidence: 0.92,
      examples: ['Chocolate Cake Recipe #baking #dessert']
    },
    performance_stats: { avg: 10.3, count: 47 }
  }
];

const interpreted = await interpreter.analyzePatterns(patterns, {
  videoContext: { topic: 'cooking', videoCount: 1000 }
});

// Only the hashtag pattern should pass as meaningful
*/