/**
 * Token counting utilities for more accurate token estimation
 * Helps manage token budgets for LLM interactions
 */

/**
 * More accurate token estimator using character-level heuristics
 * This is a better approximation than the simple 4 chars = 1 token
 */
export function estimateTokenCount(text: string): number {
  if (!text) return 0;
  
  // Count by token-relevant features
  const wordCount = text.split(/\s+/).length;
  const punctuationCount = (text.match(/[.,!?;:()[\]{}""''`]/g) || []).length;
  const numberCount = (text.match(/\d+/g) || []).length;
  const uppercaseCount = (text.match(/[A-Z]/g) || []).length;
  
  // This formula is based on GPT/Claude token encoding patterns
  // It's still an approximation but more accurate than character count / 4
  const estimatedTokens = Math.ceil(
    wordCount * 1.3 + 
    punctuationCount * 0.5 + 
    numberCount * 0.5 + 
    uppercaseCount * 0.3
  );
  
  return Math.max(1, estimatedTokens);
}

/**
 * Truncate text to fit within a token budget
 */
export function truncateToTokenBudget(text: string, maxTokens: number): string {
  if (estimateTokenCount(text) <= maxTokens) return text;
  
  // Simple approach: truncate by words
  const words = text.split(/\s+/);
  let result = '';
  let currentTokens = 0;
  
  for (const word of words) {
    const wordTokens = estimateTokenCount(word + ' ');
    if (currentTokens + wordTokens <= maxTokens) {
      result += word + ' ';
      currentTokens += wordTokens;
    } else {
      break;
    }
  }
  
  return result.trim() + '...';
}

/**
 * Select chunks to include based on a token budget
 * Prioritizes chunks with higher similarity scores
 */
export function selectChunksWithinBudget(
  chunks: any[], 
  maxTokens: number, 
  contentField: string = 'content'
): any[] {
  // Use minimum token budget of 2000 tokens or provided maxTokens
  const tokenBudget = Math.max(maxTokens, 2000);
  
  // Sort by similarity (highest first)
  const sortedChunks = [...chunks].sort((a, b) => b.similarity - a.similarity);
  
  const selectedChunks: any[] = [];
  let currentTokens = 0;
  
  // First pass: take highly relevant chunks (similarity > 0.8)
  for (const chunk of sortedChunks) {
    if (chunk.similarity < 0.8) continue;
    
    const chunkTokens = estimateTokenCount(chunk[contentField]);
    
    // Skip very long chunks (longer than 1500 tokens)
    if (chunkTokens > 1500) continue;
    
    if (currentTokens + chunkTokens <= tokenBudget) {
      selectedChunks.push(chunk);
      currentTokens += chunkTokens;
    }
  }
  
  // Second pass: take medium relevant chunks (0.7-0.8 similarity)
  for (const chunk of sortedChunks) {
    if (chunk.similarity < 0.7 || chunk.similarity > 0.8 || selectedChunks.includes(chunk)) continue;
    
    const chunkTokens = estimateTokenCount(chunk[contentField]);
    
    // Skip very long chunks (longer than 1000 tokens)
    if (chunkTokens > 1000) continue;
    
    if (currentTokens + chunkTokens <= tokenBudget) {
      selectedChunks.push(chunk);
      currentTokens += chunkTokens;
    }
  }
  
  // Third pass: take all remaining chunks by order of similarity
  for (const chunk of sortedChunks) {
    if (selectedChunks.includes(chunk)) continue;
    
    const chunkTokens = estimateTokenCount(chunk[contentField]);
    
    // Skip very long chunks (longer than 800 tokens)
    if (chunkTokens > 800) continue;
    
    if (currentTokens + chunkTokens <= tokenBudget) {
      selectedChunks.push(chunk);
      currentTokens += chunkTokens;
    } else {
      // Stop adding chunks when we exceed the budget
      break;
    }
  }
  
  // Sort by similarity score again (highest first)
  selectedChunks.sort((a, b) => b.similarity - a.similarity);
  
  return selectedChunks;
}

/**
 * Format chunks into a clean context string
 */
export function formatChunksAsContext(
  chunks: any[],
  includeMetadata: boolean = true
): string {
  return chunks.map(chunk => {
    // Basic content
    let formatted = chunk.content;
    
    // Add metadata if requested
    if (includeMetadata) {
      const videoTitle = chunk.metadata?.title || chunk.videoId;
      const timestamp = formatTimestamp(chunk.startTime);
      const similarity = chunk.similarity?.toFixed(4) || 'N/A';
      
      formatted = `[CONTENT FROM: "${videoTitle}" at ${timestamp}]
Type: ${chunk.contentType || 'unknown'}
Similarity: ${similarity}
---
${chunk.content}
---`;
    }
    
    return formatted;
  }).join('\n\n');
}

/**
 * Format seconds as a readable timestamp
 */
function formatTimestamp(seconds?: number): string {
  if (seconds === undefined || seconds === null) return 'N/A';
  
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, '0')}`;
} 