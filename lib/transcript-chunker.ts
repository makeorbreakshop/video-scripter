/**
 * Transcript Chunker
 * Utilities for breaking transcript text into semantically meaningful chunks for embedding
 */

interface ChunkingOptions {
  maxChunkSize?: number;  // Maximum tokens per chunk
  overlapSize?: number;   // Number of tokens to overlap between chunks
  respectSentences?: boolean; // Try to keep sentences intact
  minChunkSize?: number;  // Minimum tokens per chunk
}

interface Chunk {
  content: string;
  startTime?: number;
  endTime?: number;
  metadata?: Record<string, any>;
}

interface TimedTranscriptSegment {
  text: string;
  startTime: number;
  endTime: number;
}

/**
 * Approximates the number of tokens in a string
 * This is a simple approximation (1 token ≈ 4 characters)
 */
export function estimateTokenCount(text: string): number {
  return Math.ceil(text.length / 4);
}

/**
 * Finds sentence boundaries in text
 * Returns array of indices where sentences end
 */
function findSentenceBoundaries(text: string): number[] {
  const boundaries: number[] = [];
  const regex = /[.!?]\s+/g;
  let match;
  
  while ((match = regex.exec(text)) !== null) {
    boundaries.push(match.index + match[0].length);
  }
  
  return boundaries;
}

/**
 * Chunks plain text into approximately even chunks
 * Tries to respect sentence boundaries when possible
 */
export function chunkText(
  text: string, 
  options: ChunkingOptions = {}
): Chunk[] {
  const {
    maxChunkSize = 512,
    overlapSize = 50,
    respectSentences = true,
    minChunkSize = 100
  } = options;
  
  if (!text || text.length === 0) {
    return [];
  }
  
  const chunks: Chunk[] = [];
  const sentenceBoundaries = respectSentences ? findSentenceBoundaries(text) : [];
  
  let startIndex = 0;
  
  while (startIndex < text.length) {
    let endIndex = startIndex + estimateTokenCount(text.substring(startIndex)) > maxChunkSize
      ? startIndex + maxChunkSize * 4  // Convert tokens to approx chars
      : text.length;
    
    // Don't exceed text length
    endIndex = Math.min(endIndex, text.length);
    
    // Try to respect sentence boundaries if enabled
    if (respectSentences && endIndex < text.length) {
      // Find the closest sentence boundary before our calculated endpoint
      const closestBoundary = sentenceBoundaries.filter(b => b > startIndex && b < endIndex).pop();
      
      if (closestBoundary && estimateTokenCount(text.substring(startIndex, closestBoundary)) >= minChunkSize) {
        endIndex = closestBoundary;
      }
    }
    
    // Create the chunk
    const chunkText = text.substring(startIndex, endIndex).trim();
    if (chunkText.length > 0) {
      chunks.push({
        content: chunkText,
      });
    }
    
    // Move start position, incorporating overlap if we're not at the end
    startIndex = endIndex < text.length 
      ? endIndex - (overlapSize * 4) // Convert tokens to approx chars for overlap
      : endIndex;
    
    // Ensure we're making forward progress
    if (startIndex <= 0 || startIndex >= text.length) {
      break;
    }
  }
  
  return chunks;
}

/**
 * Chunks a YouTube transcript with timestamps into semantic sections
 * Preserves timestamp information for each chunk
 */
export function chunkTimedTranscript(
  timedSegments: TimedTranscriptSegment[],
  options: ChunkingOptions = {}
): Chunk[] {
  const {
    maxChunkSize = 512,
    minChunkSize = 100
  } = options;
  
  if (!timedSegments || timedSegments.length === 0) {
    return [];
  }
  
  const chunks: Chunk[] = [];
  let currentChunk: string[] = [];
  let currentTokenCount = 0;
  let chunkStartTime = timedSegments[0].startTime;
  
  for (const segment of timedSegments) {
    const segmentTokens = estimateTokenCount(segment.text);
    
    // If adding this segment would exceed max size, finish the current chunk
    if (currentTokenCount + segmentTokens > maxChunkSize && currentTokenCount >= minChunkSize) {
      // Finish current chunk
      chunks.push({
        content: currentChunk.join(' '),
        startTime: chunkStartTime,
        endTime: segment.startTime
      });
      
      // Start new chunk
      currentChunk = [segment.text];
      currentTokenCount = segmentTokens;
      chunkStartTime = segment.startTime;
    } else {
      // Add to current chunk
      currentChunk.push(segment.text);
      currentTokenCount += segmentTokens;
    }
  }
  
  // Don't forget the last chunk
  if (currentChunk.length > 0) {
    chunks.push({
      content: currentChunk.join(' '),
      startTime: chunkStartTime,
      endTime: timedSegments[timedSegments.length - 1].endTime
    });
  }
  
  return chunks;
}

/**
 * Parses YouTube transcript HTML into timed segments
 * Works with the transcript format returned by the YouTube API
 */
export function parseTranscriptHTML(html: string): TimedTranscriptSegment[] {
  // Simple regex to extract text content
  const cleanText = html
    .replace(/<[^>]*>/g, '') // Remove HTML tags
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
  
  // For this implementation, we'll just split by timestamps
  // In a real implementation, you'd parse actual YouTube transcript data with times
  const segments: TimedTranscriptSegment[] = [];
  const lines = cleanText.split('\n');
  
  // Create estimated timestamps (since we don't have real ones)
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (line.length === 0) continue;
    
    // Estimate approximately 5 seconds per line
    const startTime = i * 5;
    const endTime = (i + 1) * 5;
    
    segments.push({
      text: line,
      startTime,
      endTime
    });
  }
  
  return segments;
}

/**
 * Process a full YouTube transcript into chunks ready for embedding
 * Main entry point for processing transcripts
 */
export function processTranscript(
  transcript: string,
  options: ChunkingOptions = {}
): Chunk[] {
  // If the transcript is HTML (from your existing functions)
  if (transcript.includes('<p>') || transcript.includes('<br')) {
    const timedSegments = parseTranscriptHTML(transcript);
    return chunkTimedTranscript(timedSegments, options);
  } 
  
  // Otherwise treat it as plain text
  return chunkText(transcript, options);
} 