// Evaluation utilities for thread expansion quality

export interface TopicDistanceScore {
  level1_tooClose: number;      // Same exact topic (bad for Tier 2)
  level2_goodStart: number;     // Same category but broader
  level3_sweetSpot: number;     // Parent category (ideal)
  level4_wideNet: number;       // Adjacent categories
  level5_tooBroad: number;      // Lost connection
}

export interface ExpansionQuality {
  // Good indicators
  progressiveWidening: boolean;
  maintainsRelevance: boolean;
  exploresNewAudiences: boolean;
  smoothTransitions: boolean;
  
  // Bad indicators
  tooLiteral: number;
  stuckInCategory: number;
  lostConnection: number;
  repetitiveQueries: number;
}

export interface ThreadEvaluation {
  threadName: string;
  startingDistance: number;  // 1-5 scale
  endingDistance: number;    // 1-5 scale
  progressionScore: number;  // 0-1 scale
  uniqueContribution: string;
  queryDiversity: number;    // 0-1 scale
}

export interface OverallEvaluation {
  topicDistance: TopicDistanceScore;
  expansionQuality: ExpansionQuality;
  categoryCount: number;
  semanticDiversity: number;  // 0-1 scale
  estimatedVideoPool: number;
  threadEvaluations: ThreadEvaluation[];
  overallScore: number;       // 0-100
}

// Keywords that indicate staying too close to original topic
const PROXIMITY_INDICATORS = {
  tooClose: ['review', 'comparison', 'vs', 'best', 'top', 'buying guide'],
  goodExpansion: ['tutorial', 'projects', 'ideas', 'tips', 'how to'],
  wideExpansion: ['lifestyle', 'vlog', 'day in life', 'tour', 'story']
};

export function evaluateThreadExpansion(
  concept: string,
  threads: any[]
): OverallEvaluation {
  const conceptWords = concept.toLowerCase().split(' ');
  const allQueries = threads.flatMap(t => t.queries || []);
  
  // Calculate topic distance distribution
  const topicDistance = calculateTopicDistance(conceptWords, allQueries);
  
  // Evaluate expansion quality
  const expansionQuality = evaluateExpansionQuality(threads);
  
  // Count unique categories
  const categoryCount = countUniqueCategories(threads);
  
  // Calculate semantic diversity
  const semanticDiversity = calculateSemanticDiversity(allQueries);
  
  // Evaluate each thread
  const threadEvaluations = threads.map(thread => 
    evaluateIndividualThread(conceptWords, thread)
  );
  
  // Estimate video pool size
  const estimatedVideoPool = estimateVideoPool(topicDistance);
  
  // Calculate overall score
  const overallScore = calculateOverallScore(
    topicDistance,
    expansionQuality,
    categoryCount,
    semanticDiversity
  );
  
  return {
    topicDistance,
    expansionQuality,
    categoryCount,
    semanticDiversity,
    estimatedVideoPool,
    threadEvaluations,
    overallScore
  };
}

function calculateTopicDistance(
  conceptWords: string[],
  queries: string[]
): TopicDistanceScore {
  const scores = {
    level1_tooClose: 0,
    level2_goodStart: 0,
    level3_sweetSpot: 0,
    level4_wideNet: 0,
    level5_tooBroad: 0
  };
  
  // Filter out common words that shouldn't count as concept matches
  const meaningfulConceptWords = conceptWords.filter(word => 
    word.length > 3 && !['tutorial', 'guide', 'course', 'lesson', 'class'].includes(word)
  );
  
  queries.forEach(query => {
    const queryLower = query.toLowerCase();
    
    // Count meaningful concept matches
    const conceptMatches = meaningfulConceptWords.filter(word => 
      queryLower.includes(word)
    ).length;
    
    // Calculate semantic distance based on domain keywords
    const hasProgrammingKeywords = /\b(programming|coding|development|software|web|app|frontend|backend|javascript|typescript|node|database|api)\b/.test(queryLower);
    const hasGeneralTechKeywords = /\b(tech|technology|digital|computer|system|platform|tool|framework)\b/.test(queryLower);
    const hasLearningKeywords = /\b(learn|tutorial|course|education|skill|knowledge|master|beginner|advanced)\b/.test(queryLower);
    const hasBroadKeywords = /\b(lifestyle|life|living|personal|self|human|people|society|world|everything)\b/.test(queryLower);
    
    // More nuanced categorization
    if (conceptMatches >= 2) {
      scores.level1_tooClose++;
    } else if (conceptMatches === 1) {
      if (hasProgrammingKeywords) {
        scores.level2_goodStart++;
      } else {
        scores.level3_sweetSpot++;
      }
    } else if (conceptMatches === 0) {
      if (hasProgrammingKeywords && !hasBroadKeywords) {
        scores.level3_sweetSpot++; // Related programming topics
      } else if (hasGeneralTechKeywords || hasLearningKeywords) {
        scores.level4_wideNet++; // Broader tech/learning
      } else if (hasBroadKeywords) {
        scores.level5_tooBroad++; // Too general
      } else {
        // Default based on query complexity
        const wordCount = queryLower.split(' ').length;
        if (wordCount >= 3 && wordCount <= 6) {
          scores.level3_sweetSpot++; // Specific enough queries
        } else {
          scores.level4_wideNet++;
        }
      }
    }
  });
  
  return scores;
}

function evaluateExpansionQuality(threads: any[]): ExpansionQuality {
  let tooLiteral = 0;
  let stuckInCategory = 0;
  let lostConnection = 0;
  let repetitiveQueries = 0;
  
  const allQueries = threads.flatMap(t => t.queries || []);
  const uniqueQueries = new Set(allQueries.map(q => q.toLowerCase()));
  
  // Check for repetitive queries
  repetitiveQueries = allQueries.length - uniqueQueries.size;
  
  // Check each thread for quality issues
  threads.forEach(thread => {
    const queries = thread.queries || [];
    if (queries.length < 2) return;
    
    // Check if queries are too similar (too literal)
    const firstWords = new Set(queries[0].toLowerCase().split(' '));
    const lastWords = new Set(queries[queries.length - 1].toLowerCase().split(' '));
    const overlap = [...firstWords].filter(w => lastWords.has(w)).length;
    
    if (overlap / firstWords.size > 0.7) {
      tooLiteral++;
    }
    
    // Check if thread doesn't expand enough
    const uniqueWordsInThread = new Set(
      queries.flatMap(q => q.toLowerCase().split(' '))
    );
    if (uniqueWordsInThread.size < queries.length * 3) {
      stuckInCategory++;
    }
  });
  
  // Calculate quality indicators
  const progressiveWidening = threads.every((thread, i) => {
    if (i === 0) return true;
    const prevQueries = threads[i - 1].queries || [];
    const currQueries = thread.queries || [];
    return currQueries.some(q => 
      !prevQueries.some(pq => 
        pq.toLowerCase().includes(q.toLowerCase().split(' ')[0])
      )
    );
  });
  
  return {
    progressiveWidening,
    maintainsRelevance: lostConnection < threads.length * 0.2,
    exploresNewAudiences: uniqueQueries.size > allQueries.length * 0.8,
    smoothTransitions: tooLiteral < threads.length * 0.3,
    tooLiteral,
    stuckInCategory,
    lostConnection,
    repetitiveQueries
  };
}

function countUniqueCategories(threads: any[]): number {
  const categories = new Set<string>();
  
  threads.forEach(thread => {
    // Extract category from thread angle or intent
    const angle = thread.angle || thread.threadName || '';
    const intent = thread.intent || '';
    
    // Simple category extraction
    const words = (angle + ' ' + intent).toLowerCase().split(' ');
    words.forEach(word => {
      if (word.length > 4 && !['with', 'from', 'about', 'their'].includes(word)) {
        categories.add(word);
      }
    });
  });
  
  return categories.size;
}

function calculateSemanticDiversity(queries: string[]): number {
  if (queries.length < 2) return 0;
  
  // Simple semantic diversity based on unique words
  const allWords = new Set<string>();
  const wordCounts = new Map<string, number>();
  
  queries.forEach(query => {
    const words = query.toLowerCase().split(' ')
      .filter(w => w.length > 2 && !['the', 'and', 'for', 'with'].includes(w));
    
    words.forEach(word => {
      allWords.add(word);
      wordCounts.set(word, (wordCounts.get(word) || 0) + 1);
    });
  });
  
  // Calculate diversity score
  const uniqueWordRatio = allWords.size / (queries.length * 5);
  const repetitionPenalty = Array.from(wordCounts.values())
    .filter(count => count > queries.length * 0.3).length / allWords.size;
  
  return Math.min(1, Math.max(0, uniqueWordRatio - repetitionPenalty));
}

function evaluateIndividualThread(
  conceptWords: string[],
  thread: any
): ThreadEvaluation {
  const queries = thread.queries || [];
  if (queries.length === 0) {
    return {
      threadName: thread.angle || thread.threadName || 'Unknown',
      startingDistance: 1,
      endingDistance: 1,
      progressionScore: 0,
      uniqueContribution: 'No queries',
      queryDiversity: 0
    };
  }
  
  // Calculate starting and ending distance
  const startingDistance = calculateQueryDistance(conceptWords, queries[0]);
  const endingDistance = calculateQueryDistance(
    conceptWords,
    queries[queries.length - 1]
  );
  
  // Calculate progression score
  const progressionScore = queries.length > 1
    ? (endingDistance - startingDistance) / 4
    : 0;
  
  // Calculate query diversity within thread
  const uniqueWords = new Set(
    queries.flatMap(q => 
      q.toLowerCase().split(' ').filter(w => w.length > 3)
    )
  );
  const queryDiversity = Math.min(1, uniqueWords.size / (queries.length * 5));
  
  // Identify unique contribution
  const uniqueContribution = thread.angle || thread.intent || 'General expansion';
  
  return {
    threadName: thread.angle || thread.threadName || 'Thread',
    startingDistance,
    endingDistance,
    progressionScore: Math.max(0, Math.min(1, progressionScore)),
    uniqueContribution,
    queryDiversity
  };
}

function calculateQueryDistance(conceptWords: string[], query: string): number {
  const queryLower = query.toLowerCase();
  const matches = conceptWords.filter(word => queryLower.includes(word)).length;
  
  if (matches >= 2) return 1;      // Too close
  if (matches === 1) return 2;      // Starting to expand
  
  // Check for semantic distance based on keywords
  if (PROXIMITY_INDICATORS.goodExpansion.some(ind => queryLower.includes(ind))) {
    return 3; // Good expansion
  }
  if (PROXIMITY_INDICATORS.wideExpansion.some(ind => queryLower.includes(ind))) {
    return 4; // Wide expansion
  }
  
  return 3.5; // Default middle distance
}

function estimateVideoPool(topicDistance: TopicDistanceScore): number {
  // Rough estimates based on typical YouTube distribution
  const level1Videos = topicDistance.level1_tooClose * 100;
  const level2Videos = topicDistance.level2_goodStart * 500;
  const level3Videos = topicDistance.level3_sweetSpot * 2000;
  const level4Videos = topicDistance.level4_wideNet * 10000;
  const level5Videos = topicDistance.level5_tooBroad * 50000;
  
  return Math.round(
    level1Videos + level2Videos + level3Videos + level4Videos + level5Videos
  );
}

function calculateOverallScore(
  topicDistance: TopicDistanceScore,
  expansionQuality: ExpansionQuality,
  categoryCount: number,
  semanticDiversity: number
): number {
  let score = 0;
  
  // Topic distance scoring (40 points)
  const totalQueries = Object.values(topicDistance).reduce((a, b) => a + b, 0);
  if (totalQueries > 0) {
    const idealDistribution = {
      level1_tooClose: 0.05,
      level2_goodStart: 0.20,
      level3_sweetSpot: 0.40,
      level4_wideNet: 0.30,
      level5_tooBroad: 0.05
    };
    
    Object.entries(topicDistance).forEach(([key, value]) => {
      const actual = value / totalQueries;
      const ideal = idealDistribution[key as keyof typeof idealDistribution];
      const diff = Math.abs(actual - ideal);
      score += (1 - diff) * 8; // Max 8 points per level
    });
  }
  
  // Expansion quality scoring (30 points)
  if (expansionQuality.progressiveWidening) score += 7.5;
  if (expansionQuality.maintainsRelevance) score += 7.5;
  if (expansionQuality.exploresNewAudiences) score += 7.5;
  if (expansionQuality.smoothTransitions) score += 7.5;
  
  // Category diversity (15 points)
  score += Math.min(15, categoryCount * 1.5);
  
  // Semantic diversity (15 points)
  score += semanticDiversity * 15;
  
  return Math.round(Math.min(100, Math.max(0, score)));
}