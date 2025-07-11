interface FormatKeywords {
  strong: string[];
  medium: string[];
  weak: string[];
}

interface FormatScore {
  format: VideoFormat;
  score: number;
  matchedKeywords: {
    strong: string[];
    medium: string[];
    weak: string[];
  };
}

export interface FormatDetectionResult {
  format: VideoFormat;
  confidence: number;
  scores: FormatScore[];
  reasoning: string;
  requiresLLM: boolean;
}

export const VideoFormat = {
  TUTORIAL: 'tutorial',
  LISTICLE: 'listicle',
  EXPLAINER: 'explainer',
  CASE_STUDY: 'case_study',
  NEWS_ANALYSIS: 'news_analysis',
  PERSONAL_STORY: 'personal_story',
  PRODUCT_FOCUS: 'product_focus'
} as const;

export type VideoFormat = typeof VideoFormat[keyof typeof VideoFormat];

export class FormatDetectionService {
  private formatKeywords: Map<VideoFormat, FormatKeywords> = new Map();
  private confidenceThreshold: number = 0.6;
  private ambiguityThreshold: number = 0.15; // If second format is within 15% of first

  constructor(confidenceThreshold: number = 0.6) {
    this.confidenceThreshold = confidenceThreshold;
    this.initializeKeywords();
  }

  private initializeKeywords(): void {
    // Tutorial keywords
    this.formatKeywords.set(VideoFormat.TUTORIAL, {
      strong: [
        'how to', 'tutorial', 'guide', 'step by step', 'learn', 'teach',
        'walkthrough', 'setup', 'install', 'configure', 'build', 'create',
        'make', 'diy', 'instructions', 'demonstration'
      ],
      medium: [
        'show', 'explain', 'process', 'method', 'technique', 'way to',
        'steps', 'beginner', 'advanced', 'master', 'course', 'lesson'
      ],
      weak: [
        'easy', 'simple', 'quick', 'fast', 'complete', 'full', 'using',
        'with', 'from scratch', 'like a pro'
      ]
    });

    // Listicle keywords
    this.formatKeywords.set(VideoFormat.LISTICLE, {
      strong: [
        'top', 'best', 'worst', 'list', 'things', 'reasons', 'ways',
        'tips', 'tricks', 'hacks', 'mistakes', 'facts', 'myths',
        'ranked', 'ranking'
      ],
      medium: [
        'must', 'should', 'need to know', 'essential', 'important',
        'amazing', 'incredible', 'shocking', 'surprising', 'hidden',
        'ideas', 'projects' // Added based on tracking data
      ],
      weak: [
        'every', 'all', 'most', 'common', 'popular', 'favorite',
        'ultimate', 'definitive', 'complete'
      ]
    });

    // Explainer keywords
    this.formatKeywords.set(VideoFormat.EXPLAINER, {
      strong: [
        'what is', 'why', 'how does', 'explained', 'explanation', 
        'understanding', 'meaning', 'definition', 'introduction to',
        'basics', 'fundamentals', 'science of', 'theory'
      ],
      medium: [
        'concept', 'overview', 'summary', 'breakdown', 'deep dive',
        'analysis', 'behind', 'works', 'happens', 'causes'
      ],
      weak: [
        'simple', 'easy', 'complex', 'detailed', 'comprehensive',
        'everything about', 'all about', 'truth about'
      ]
    });

    // Case Study keywords
    this.formatKeywords.set(VideoFormat.CASE_STUDY, {
      strong: [
        'case study', 'success story', 'failure', 'results', 'experiment',
        'tested', 'tried', 'journey', 'transformation', 'before after',
        'went from', 'achieved', 'built', 'grew'
      ],
      medium: [
        'story', 'experience', 'lessons', 'learned', 'insights', 
        'strategy', 'tactics', 'approach', 'method', 'system'
      ],
      weak: [
        'my', 'our', 'real', 'actual', 'honest', 'truth', 'behind the scenes',
        'documentary', 'inside look'
      ]
    });

    // News Analysis keywords
    this.formatKeywords.set(VideoFormat.NEWS_ANALYSIS, {
      strong: [
        'breaking', 'news', 'update', 'announced', 'leaked', 'confirmed',
        'revealed', 'report', 'latest', 'just in', 'happening now',
        'statement', 'response', 'reaction'
      ],
      medium: [
        'analysis', 'opinion', 'thoughts', 'take', 'perspective',
        'implications', 'impact', 'means', 'changes', 'affects'
      ],
      weak: [
        'new', 'recent', 'current', 'today', 'yesterday', 'this week',
        'trending', 'viral', 'hot', 'discussion'
      ]
    });

    // Personal Story keywords
    this.formatKeywords.set(VideoFormat.PERSONAL_STORY, {
      strong: [
        'my story', 'my journey', 'personal', 'confession', 'storytime',
        'life', 'experience', 'i quit', 'i tried', 'i failed', 'i succeeded',
        'truth about my', 'opening up', 'vulnerable', 'honest',
        'conversation with', 'interview' // Added based on tracking data
      ],
      medium: [
        'story', 'journey', 'path', 'struggle', 'challenge', 'overcame',
        'dealing with', 'living with', 'surviving', 'thriving',
        'episode' // Added for podcast-style content
      ],
      weak: [
        'my', 'me', 'i', 'personal', 'own', 'self', 'life', 'real',
        'raw', 'unfiltered', 'candid'
      ]
    });

    // Product Focus keywords
    this.formatKeywords.set(VideoFormat.PRODUCT_FOCUS, {
      strong: [
        'review', 'unboxing', 'first look', 'hands on', 'comparison',
        'vs', 'versus', 'alternatives', 'worth it', 'waste of money',
        'buying guide', 'should you buy', 'tested', 'benchmarks'
      ],
      medium: [
        'product', 'device', 'gadget', 'tool', 'software', 'app',
        'features', 'specs', 'performance', 'quality', 'price',
        'giveaway' // Added based on tracking data
      ],
      weak: [
        'new', 'latest', 'best', 'top', 'premium', 'budget', 'cheap',
        'expensive', 'value', 'deal'
      ]
    });
  }

  /**
   * Detect video format based on title keywords
   */
  detectFormat(title: string, channel?: string, description?: string): FormatDetectionResult {
    const normalizedTitle = title.toLowerCase();
    const scores: FormatScore[] = [];

    // Calculate scores for each format
    for (const [format, keywords] of this.formatKeywords.entries()) {
      const score = this.calculateFormatScore(normalizedTitle, keywords);
      scores.push(score);
    }

    // Sort by score descending
    scores.sort((a, b) => b.score - a.score);

    // Calculate confidence
    const topScore = scores[0].score;
    const secondScore = scores[1]?.score || 0;
    const maxPossibleScore = this.getMaxPossibleScore(normalizedTitle);
    
    let confidence = topScore / maxPossibleScore;
    
    // Reduce confidence if scores are close
    if (secondScore > 0 && (topScore - secondScore) / topScore < this.ambiguityThreshold) {
      confidence *= 0.8; // Reduce confidence by 20%
    }

    // Reduce confidence for very short titles
    const wordCount = normalizedTitle.split(/\s+/).length;
    if (wordCount < 3) {
      confidence *= 0.9;
    }

    // Check if LLM is needed
    const requiresLLM = confidence < this.confidenceThreshold || 
                       (topScore > 0 && secondScore / topScore > 0.8);

    const reasoning = this.generateReasoning(
      scores[0],
      confidence,
      requiresLLM,
      scores.slice(0, 3)
    );

    return {
      format: scores[0].format,
      confidence: Math.round(confidence * 100) / 100,
      scores: scores.slice(0, 3), // Top 3 formats
      reasoning,
      requiresLLM
    };
  }

  /**
   * Calculate score for a specific format
   */
  private calculateFormatScore(title: string, keywords: FormatKeywords): FormatScore {
    const matchedKeywords = {
      strong: [] as string[],
      medium: [] as string[],
      weak: [] as string[]
    };

    let score = 0;

    // Check strong keywords (3 points each)
    for (const keyword of keywords.strong) {
      if (title.includes(keyword)) {
        score += 3;
        matchedKeywords.strong.push(keyword);
      }
    }

    // Check medium keywords (2 points each)
    for (const keyword of keywords.medium) {
      if (title.includes(keyword)) {
        score += 2;
        matchedKeywords.medium.push(keyword);
      }
    }

    // Check weak keywords (1 point each)
    for (const keyword of keywords.weak) {
      if (title.includes(keyword)) {
        score += 1;
        matchedKeywords.weak.push(keyword);
      }
    }

    // Bonus for multiple keyword matches
    const totalMatches = matchedKeywords.strong.length + 
                        matchedKeywords.medium.length + 
                        matchedKeywords.weak.length;
    if (totalMatches > 3) {
      score *= 1.2; // 20% bonus for multiple matches
    }

    return {
      format: Array.from(this.formatKeywords.keys()).find(
        f => this.formatKeywords.get(f) === keywords
      )!,
      score,
      matchedKeywords
    };
  }

  /**
   * Calculate maximum possible score for a title
   */
  private getMaxPossibleScore(title: string): number {
    const wordCount = title.split(/\s+/).length;
    // Assume best case: multiple strong keywords could match
    return Math.max(15, wordCount * 2); // At least 15 or 2 points per word
  }

  /**
   * Generate reasoning for the format detection
   */
  private generateReasoning(
    topScore: FormatScore,
    confidence: number,
    requiresLLM: boolean,
    topFormats: FormatScore[]
  ): string {
    let reasoning = `Detected format: ${topScore.format} with score ${topScore.score}. `;
    
    if (topScore.matchedKeywords.strong.length > 0) {
      reasoning += `Strong signals: ${topScore.matchedKeywords.strong.join(', ')}. `;
    }
    
    if (topScore.matchedKeywords.medium.length > 0) {
      reasoning += `Medium signals: ${topScore.matchedKeywords.medium.join(', ')}. `;
    }

    if (confidence < 0.6) {
      reasoning += 'Low confidence - ambiguous format. ';
    } else if (confidence < 0.8) {
      reasoning += 'Moderate confidence. ';
    } else {
      reasoning += 'High confidence match. ';
    }

    if (requiresLLM) {
      reasoning += 'Recommending LLM verification due to ';
      if (confidence < this.confidenceThreshold) {
        reasoning += 'low confidence. ';
      } else {
        reasoning += 'competing format signals. ';
      }
    }

    // Add competing formats if close
    const competitors = topFormats.slice(1).filter(f => f.score > topScore.score * 0.5);
    if (competitors.length > 0) {
      reasoning += `Other possible formats: ${competitors.map(f => 
        `${f.format} (${f.score})`
      ).join(', ')}.`;
    }

    return reasoning;
  }

  /**
   * Batch detect formats for multiple videos
   */
  async detectFormatsBatch(
    videos: Array<{ id: string; title: string; channel?: string; description?: string }>
  ): Promise<Map<string, FormatDetectionResult>> {
    const results = new Map<string, FormatDetectionResult>();

    for (const video of videos) {
      const result = this.detectFormat(video.title, video.channel, video.description);
      results.set(video.id, result);
    }

    return results;
  }

  /**
   * Update confidence threshold
   */
  setConfidenceThreshold(threshold: number): void {
    this.confidenceThreshold = Math.max(0, Math.min(1, threshold));
  }

  /**
   * Get current configuration
   */
  getConfiguration(): {
    confidenceThreshold: number;
    ambiguityThreshold: number;
    formats: VideoFormat[];
  } {
    return {
      confidenceThreshold: this.confidenceThreshold,
      ambiguityThreshold: this.ambiguityThreshold,
      formats: Array.from(this.formatKeywords.keys())
    };
  }

  /**
   * Add or update keywords for a format
   */
  updateFormatKeywords(
    format: VideoFormat,
    keywords: Partial<FormatKeywords>
  ): void {
    const existing = this.formatKeywords.get(format) || {
      strong: [],
      medium: [],
      weak: []
    };

    this.formatKeywords.set(format, {
      strong: keywords.strong || existing.strong,
      medium: keywords.medium || existing.medium,
      weak: keywords.weak || existing.weak
    });
  }
}

// Export singleton instance
export const formatDetectionService = new FormatDetectionService();

// Export for CommonJS compatibility (for scripts)
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { FormatDetectionService, VideoFormat, formatDetectionService };
}