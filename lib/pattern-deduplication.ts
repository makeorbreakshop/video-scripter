// Pattern type definition (avoiding circular import)
interface DiscoveredPattern {
  pattern: string;
  explanation: string;
  template: string;
  examples: string[];
  video_ids: string[];
  confidence: number;
  performance_multiplier: number;
}

interface PatternWithEmbedding extends DiscoveredPattern {
  embedding?: number[];
}

// Calculate Jaccard similarity between two sets of words
function jaccardSimilarity(set1: Set<string>, set2: Set<string>): number {
  const intersection = new Set([...set1].filter(x => set2.has(x)));
  const union = new Set([...set1, ...set2]);
  return intersection.size / union.size;
}

// Extract meaningful keywords from a pattern template
function extractPatternKeywords(pattern: string): Set<string> {
  // Remove placeholders and common words
  const cleanedPattern = pattern
    .toLowerCase()
    .replace(/\[.*?\]/g, '') // Remove placeholders
    .replace(/[^a-z0-9\s]/g, ' '); // Remove punctuation
  
  const stopWords = new Set([
    'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for',
    'of', 'with', 'by', 'from', 'up', 'about', 'into', 'through', 'during',
    'before', 'after', 'above', 'below', 'between', 'under', 'again',
    'further', 'then', 'once', 'that', 'this', 'these', 'those', 'your',
    'my', 'his', 'her', 'its', 'our', 'their', 'will', 'would', 'could',
    'should', 'may', 'might', 'must', 'can', 'do', 'does', 'did', 'doing',
    'have', 'has', 'had', 'having', 'be', 'am', 'is', 'are', 'was', 'were',
    'been', 'being'
  ]);
  
  const words = cleanedPattern
    .split(/\s+/)
    .filter(word => word.length > 2 && !stopWords.has(word));
  
  return new Set(words);
}

// Check if two patterns are semantically similar
function arePatternsSimilar(pattern1: DiscoveredPattern, pattern2: DiscoveredPattern): boolean {
  // 1. Check template similarity
  const keywords1 = extractPatternKeywords(pattern1.template);
  const keywords2 = extractPatternKeywords(pattern2.template);
  const templateSimilarity = jaccardSimilarity(keywords1, keywords2);
  
  // 2. Check pattern name similarity
  const nameKeywords1 = extractPatternKeywords(pattern1.pattern);
  const nameKeywords2 = extractPatternKeywords(pattern2.pattern);
  const nameSimilarity = jaccardSimilarity(nameKeywords1, nameKeywords2);
  
  // 3. Check if they share significant example overlap
  const examples1 = new Set(pattern1.examples.map(e => e.toLowerCase()));
  const examples2 = new Set(pattern2.examples.map(e => e.toLowerCase()));
  const exampleSimilarity = jaccardSimilarity(examples1, examples2);
  
  // 4. Check specific pattern types that are often duplicated
  const moneyPatterns = ['sell', 'money', 'profit', 'income', 'earn', 'revenue', 'business'];
  const isMoneyPattern1 = moneyPatterns.some(word => 
    pattern1.pattern.toLowerCase().includes(word) || 
    pattern1.template.toLowerCase().includes(word)
  );
  const isMoneyPattern2 = moneyPatterns.some(word => 
    pattern2.pattern.toLowerCase().includes(word) || 
    pattern2.template.toLowerCase().includes(word)
  );
  
  // If both are money-related patterns, they're likely similar
  if (isMoneyPattern1 && isMoneyPattern2) {
    return templateSimilarity > 0.3 || nameSimilarity > 0.4;
  }
  
  // Check project patterns
  const projectPatterns = ['project', 'idea', 'design', 'build', 'create', 'make'];
  const isProjectPattern1 = projectPatterns.some(word => 
    pattern1.pattern.toLowerCase().includes(word) || 
    pattern1.template.toLowerCase().includes(word)
  );
  const isProjectPattern2 = projectPatterns.some(word => 
    pattern2.pattern.toLowerCase().includes(word) || 
    pattern2.template.toLowerCase().includes(word)
  );
  
  if (isProjectPattern1 && isProjectPattern2) {
    return templateSimilarity > 0.3 || nameSimilarity > 0.4;
  }
  
  // General similarity check
  return templateSimilarity > 0.5 || nameSimilarity > 0.6 || exampleSimilarity > 0.3;
}

// Merge two similar patterns
function mergePatterns(pattern1: DiscoveredPattern, pattern2: DiscoveredPattern): DiscoveredPattern {
  // Keep the pattern with higher performance or confidence
  const primary = pattern1.performance_multiplier >= pattern2.performance_multiplier ? pattern1 : pattern2;
  const secondary = primary === pattern1 ? pattern2 : pattern1;
  
  // Merge examples (remove duplicates)
  const allExamples = [...primary.examples];
  const existingExamplesLower = new Set(primary.examples.map(e => e.toLowerCase()));
  
  secondary.examples.forEach(example => {
    if (!existingExamplesLower.has(example.toLowerCase())) {
      allExamples.push(example);
    }
  });
  
  // Merge video IDs
  const allVideoIds = [...new Set([...primary.video_ids, ...secondary.video_ids])];
  
  // Average the metrics
  const avgConfidence = (primary.confidence + secondary.confidence) / 2;
  const avgPerformance = (primary.performance_multiplier + secondary.performance_multiplier) / 2;
  
  return {
    ...primary,
    examples: allExamples.slice(0, 20), // Limit to 20 examples
    video_ids: allVideoIds.slice(0, 30), // Limit to 30 video IDs
    confidence: avgConfidence,
    performance_multiplier: avgPerformance,
    explanation: primary.explanation + " (Merged with similar pattern)"
  };
}

// Main deduplication function
export function deduplicatePatterns(patterns: DiscoveredPattern[]): DiscoveredPattern[] {
  console.log(`🔍 Deduplicating ${patterns.length} patterns...`);
  
  const deduplicatedPatterns: DiscoveredPattern[] = [];
  const processedIndices = new Set<number>();
  
  for (let i = 0; i < patterns.length; i++) {
    if (processedIndices.has(i)) continue;
    
    let mergedPattern = patterns[i];
    const similarPatterns: number[] = [];
    
    // Find all similar patterns
    for (let j = i + 1; j < patterns.length; j++) {
      if (processedIndices.has(j)) continue;
      
      if (arePatternsSimilar(mergedPattern, patterns[j])) {
        similarPatterns.push(j);
        mergedPattern = mergePatterns(mergedPattern, patterns[j]);
        processedIndices.add(j);
      }
    }
    
    if (similarPatterns.length > 0) {
      console.log(`✅ Merged pattern "${mergedPattern.pattern}" with ${similarPatterns.length} similar patterns`);
    }
    
    deduplicatedPatterns.push(mergedPattern);
    processedIndices.add(i);
  }
  
  console.log(`📊 Reduced from ${patterns.length} to ${deduplicatedPatterns.length} unique patterns`);
  
  // Sort by performance and confidence
  return deduplicatedPatterns.sort((a, b) => {
    const scoreA = a.performance_multiplier * a.confidence;
    const scoreB = b.performance_multiplier * b.confidence;
    return scoreB - scoreA;
  });
}

// Group patterns by semantic category
export function groupPatternsByCategory(patterns: DiscoveredPattern[]): Map<string, DiscoveredPattern[]> {
  const categories = new Map<string, DiscoveredPattern[]>();
  
  const categoryKeywords = {
    'money_making': ['sell', 'money', 'profit', 'income', 'earn', 'revenue', 'business', 'cash'],
    'project_ideas': ['project', 'idea', 'design', 'build', 'create', 'make', 'craft'],
    'beginner_friendly': ['beginner', 'easy', 'simple', 'start', 'first', 'basic', 'intro'],
    'advanced_techniques': ['advanced', 'pro', 'expert', 'master', 'professional', 'technique'],
    'comparison': ['vs', 'versus', 'compare', 'better', 'best', 'worst', 'review'],
    'tutorial': ['how to', 'guide', 'tutorial', 'step by step', 'learn', 'teach'],
    'tips_tricks': ['tips', 'tricks', 'hacks', 'secrets', 'mistakes', 'avoid'],
    'tools_equipment': ['tool', 'equipment', 'gear', 'setup', 'machine', 'device'],
    'home_decor': ['home', 'decor', 'furniture', 'interior', 'room', 'house'],
    'gift_ideas': ['gift', 'present', 'surprise', 'birthday', 'christmas', 'holiday']
  };
  
  patterns.forEach(pattern => {
    const patternText = (pattern.pattern + ' ' + pattern.template).toLowerCase();
    let assigned = false;
    
    for (const [category, keywords] of Object.entries(categoryKeywords)) {
      if (keywords.some(keyword => patternText.includes(keyword))) {
        if (!categories.has(category)) {
          categories.set(category, []);
        }
        categories.get(category)!.push(pattern);
        assigned = true;
        break; // Assign to first matching category only
      }
    }
    
    if (!assigned) {
      if (!categories.has('other')) {
        categories.set('other', []);
      }
      categories.get('other')!.push(pattern);
    }
  });
  
  return categories;
}

// Select diverse patterns across categories
export function selectDiversePatterns(
  patterns: DiscoveredPattern[], 
  maxPatterns: number = 8
): DiscoveredPattern[] {
  const categorized = groupPatternsByCategory(patterns);
  const selected: DiscoveredPattern[] = [];
  
  // First, take the best pattern from each category
  for (const [category, categoryPatterns] of categorized.entries()) {
    if (selected.length >= maxPatterns) break;
    
    // Sort by performance within category
    const sorted = categoryPatterns.sort((a, b) => 
      (b.performance_multiplier * b.confidence) - (a.performance_multiplier * a.confidence)
    );
    
    if (sorted.length > 0) {
      selected.push(sorted[0]);
      console.log(`✅ Selected top pattern from ${category}: "${sorted[0].pattern}"`);
    }
  }
  
  // If we need more patterns, add the highest performing ones regardless of category
  if (selected.length < maxPatterns) {
    const remaining = patterns
      .filter(p => !selected.includes(p))
      .sort((a, b) => 
        (b.performance_multiplier * b.confidence) - (a.performance_multiplier * a.confidence)
      );
    
    const toAdd = maxPatterns - selected.length;
    selected.push(...remaining.slice(0, toAdd));
  }
  
  return selected;
}