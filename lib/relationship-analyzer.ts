/**
 * Relationship Analyzer
 * 
 * Analyzes relationships between content chunks to help identify patterns
 * and connections across different videos
 */

import type { SearchResult } from './vector-db-service.ts';
import { estimateTokenCount } from './token-counter.ts';

/**
 * Interface for a detected relationship between content
 */
interface ContentRelationship {
  type: 'theme' | 'question' | 'technique' | 'product' | 'concept';
  name: string;
  description: string;
  videos: string[];
  confidence: number;
  relatedKeywords: string[];
}

/**
 * Analyzes relationships between content chunks
 * Identifies common themes, related topics, and patterns
 */
export function analyzeRelationships(chunks: SearchResult[]): {
  videoCount: number;
  topKeywords: string[];
  crossVideoThemes: ContentRelationship[];
} {
  // Skip if not enough chunks
  if (!chunks || chunks.length < 3) {
    return {
      videoCount: 0,
      topKeywords: [],
      crossVideoThemes: []
    };
  }
  
  // Group by video ID
  const videoGroups = new Map<string, SearchResult[]>();
  chunks.forEach(chunk => {
    if (!videoGroups.has(chunk.videoId)) {
      videoGroups.set(chunk.videoId, []);
    }
    videoGroups.get(chunk.videoId)!.push(chunk);
  });
  
  // Extract keywords from all chunks
  const keywords = extractKeywords(chunks);
  
  // Find themes that appear across multiple videos
  const crossVideoThemes = findCrossVideoThemes(chunks, keywords, videoGroups);
  
  return {
    videoCount: videoGroups.size,
    topKeywords: keywords.slice(0, 10),
    crossVideoThemes
  };
}

/**
 * Extract common keywords from chunks
 * Uses a simple frequency analysis
 */
function extractKeywords(chunks: SearchResult[]): string[] {
  const stopWords = new Set([
    'a', 'an', 'the', 'and', 'or', 'but', 'is', 'are', 'was', 'were',
    'in', 'on', 'at', 'to', 'for', 'with', 'by', 'about', 'like',
    'through', 'after', 'over', 'between', 'out', 'of', 'into', 'during',
    'this', 'that', 'these', 'those', 'it', 'its', 'he', 'she', 'they',
    'we', 'you', 'I', 'am', 'be', 'been', 'being', 'have', 'has', 'had',
    'do', 'does', 'did', 'will', 'would', 'can', 'could', 'should'
  ]);
  
  // Extract words from all chunks
  const wordFrequency: Record<string, number> = {};
  const wordVideos: Record<string, Set<string>> = {};
  
  chunks.forEach(chunk => {
    // Skip non-text chunks
    if (!chunk.content || typeof chunk.content !== 'string') return;
    
    // Extract words (3+ letters, ignore stop words)
    const words = chunk.content
      .toLowerCase()
      .replace(/[^\w\s]/g, ' ')
      .split(/\s+/)
      .filter(word => word.length > 3 && !stopWords.has(word));
    
    // Count frequency and track which videos each word appears in
    const seenInThisChunk = new Set<string>();
    
    words.forEach(word => {
      wordFrequency[word] = (wordFrequency[word] || 0) + 1;
      seenInThisChunk.add(word);
    });
    
    // Update video tracking for each unique word in this chunk
    seenInThisChunk.forEach(word => {
      if (!wordVideos[word]) {
        wordVideos[word] = new Set<string>();
      }
      wordVideos[word].add(chunk.videoId);
    });
  });
  
  // Sort keywords by frequency and cross-video appearance
  const keywordScores = Object.entries(wordFrequency).map(([word, frequency]) => {
    const videoCount = wordVideos[word]?.size || 0;
    // Score combines frequency and cross-video appearance
    const score = frequency * (videoCount > 1 ? videoCount : 0.5);
    return { word, frequency, videoCount, score };
  });
  
  // Sort by score (descending)
  keywordScores.sort((a, b) => b.score - a.score);
  
  // Return just the words
  return keywordScores.map(item => item.word);
}

/**
 * Find themes that appear across multiple videos
 */
function findCrossVideoThemes(
  chunks: SearchResult[], 
  keywords: string[], 
  videoGroups: Map<string, SearchResult[]>
): ContentRelationship[] {
  const relationships: ContentRelationship[] = [];
  const videoIds = Array.from(videoGroups.keys());
  
  // Only process if we have multiple videos
  if (videoIds.length < 2) return relationships;
  
  // Look at top keywords that appear in multiple videos
  const crossVideoKeywords = keywords.slice(0, 50).filter(keyword => {
    // Count videos containing this keyword
    let videoCount = 0;
    for (const videoId of videoIds) {
      const videoChunks = videoGroups.get(videoId) || [];
      const hasKeyword = videoChunks.some(chunk => 
        chunk.content?.toLowerCase().includes(keyword.toLowerCase())
      );
      if (hasKeyword) videoCount++;
    }
    // Lowered threshold from 2 to 1 to include more potential connections
    return videoCount >= 1;
  });
  
  // Group related keywords
  const themes: Record<string, string[]> = {};
  crossVideoKeywords.forEach(keyword => {
    let assigned = false;
    
    // See if keyword belongs to an existing theme
    for (const theme in themes) {
      const themeWords = themes[theme];
      const isRelated = themeWords.some(word => 
        // Simple relatedness: shared characters
        keyword.includes(word) || 
        word.includes(keyword) ||
        // Shared context (appear together in chunks)
        chunks.some(chunk => 
          chunk.content?.toLowerCase().includes(keyword) &&
          chunk.content?.toLowerCase().includes(word)
        )
      );
      
      if (isRelated) {
        themes[theme].push(keyword);
        assigned = true;
        break;
      }
    }
    
    // Create new theme if not assigned
    if (!assigned) {
      themes[keyword] = [keyword];
    }
  });
  
  // Convert themes to relationships
  for (const theme in themes) {
    const relatedKeywords = themes[theme];
    const themeVideos = new Set<string>();
    
    // Find which videos contain this theme
    for (const videoId of videoIds) {
      const videoChunks = videoGroups.get(videoId) || [];
      const hasTheme = videoChunks.some(chunk => 
        relatedKeywords.some(keyword => 
          chunk.content?.toLowerCase().includes(keyword.toLowerCase())
        )
      );
      if (hasTheme) themeVideos.add(videoId);
    }
    
    // Only include if it appears in multiple videos
    if (themeVideos.size > 1) {
      relationships.push({
        type: 'theme',
        name: formatThemeName(relatedKeywords),
        description: `Common theme across ${themeVideos.size} videos`,
        videos: Array.from(themeVideos),
        confidence: Math.min(0.5 + (themeVideos.size * 0.1), 0.9),
        relatedKeywords
      });
    }
  }
  
  // Sort by confidence
  relationships.sort((a, b) => b.confidence - a.confidence);
  
  return relationships;
}

/**
 * Create a readable theme name from related keywords
 */
function formatThemeName(keywords: string[]): string {
  if (keywords.length === 0) return 'Unknown Theme';
  if (keywords.length === 1) return keywords[0].charAt(0).toUpperCase() + keywords[0].slice(1);
  
  // Use the first and most different second keyword
  const first = keywords[0];
  let secondIndex = 1;
  let maxDifference = 0;
  
  for (let i = 1; i < Math.min(keywords.length, 5); i++) {
    const difference = levenshteinDistance(first, keywords[i]);
    if (difference > maxDifference) {
      maxDifference = difference;
      secondIndex = i;
    }
  }
  
  const mainWord = first.charAt(0).toUpperCase() + first.slice(1);
  // Only add second word if it's different enough
  if (maxDifference > 3) {
    const secondWord = keywords[secondIndex];
    return `${mainWord} & ${secondWord}`;
  }
  
  return mainWord;
}

/**
 * Calculate the Levenshtein distance between two strings
 * Used to measure how different two words are
 */
function levenshteinDistance(a: string, b: string): number {
  const matrix: number[][] = [];
  
  // Initialize matrix
  for (let i = 0; i <= b.length; i++) {
    matrix[i] = [i];
  }
  
  for (let j = 0; j <= a.length; j++) {
    matrix[0][j] = j;
  }
  
  // Fill matrix
  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      if (b.charAt(i - 1) === a.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1, // substitution
          matrix[i][j - 1] + 1,     // insertion
          matrix[i - 1][j] + 1      // deletion
        );
      }
    }
  }
  
  return matrix[b.length][a.length];
} 