/**
 * Advanced Transcript Chunker
 * Enhanced chunking for YouTube transcripts with intelligent boundary detection
 * and timestamp-based segmentation with overlap
 */

import { estimateTokenCount } from './transcript-chunker.ts';

// Types for advanced chunking
export interface AdvancedChunkingOptions {
  maxChunkDuration?: number;   // Maximum duration in seconds per chunk (default: 120s = 2min)
  overlapDuration?: number;    // Overlap duration in seconds (default: 20s)
  respectTransitions?: boolean; // Try to detect natural transitions (default: true)
  minChunkDuration?: number;   // Minimum duration in seconds (default: 30s)
  detectPauses?: boolean;      // Detect significant pauses (default: true)
  pauseThreshold?: number;     // Minimum seconds to consider a pause (default: 3s)
}

export interface TimedTranscriptSegment {
  text: string;
  startTime: number; // in seconds
  endTime: number;   // in seconds
}

export interface AdvancedChunk {
  content: string;
  startTime: number;
  endTime: number;
  position?: 'intro' | 'middle' | 'conclusion';
  metadata?: Record<string, any>;
}

// Transition phrases that might indicate natural segment boundaries
const TRANSITION_PHRASES = [
  'moving on to',
  'next point',
  'another important',
  'finally',
  'to conclude',
  'in summary',
  'let\'s talk about',
  'as we can see',
  'speaking of',
  'now let\'s discuss',
  'turning to',
  'switching gears',
  'let me explain',
  'firstly',
  'secondly',
  'lastly',
  'in conclusion',
];

/**
 * Detects if a segment contains transition phrases that might indicate
 * a natural boundary between topics
 */
function detectTransitionPhrases(text: string): boolean {
  const lowerText = text.toLowerCase();
  return TRANSITION_PHRASES.some(phrase => lowerText.includes(phrase));
}

/**
 * Detect significant pauses in the transcript based on timestamp gaps
 */
function detectSignificantPause(
  currentSegment: TimedTranscriptSegment,
  nextSegment: TimedTranscriptSegment,
  pauseThreshold: number
): boolean {
  return (nextSegment.startTime - currentSegment.endTime) >= pauseThreshold;
}

/**
 * Determine the position of a chunk in the overall video
 * @param startTime - Chunk start time in seconds
 * @param endTime - Chunk end time in seconds
 * @param totalDuration - Total video duration in seconds
 */
function determinePosition(
  startTime: number,
  endTime: number,
  totalDuration: number
): 'intro' | 'middle' | 'conclusion' {
  const INTRO_THRESHOLD = 0.2; // First 20% of video
  const CONCLUSION_THRESHOLD = 0.8; // Last 20% of video
  
  const midpoint = (startTime + endTime) / 2;
  const relativePosition = midpoint / totalDuration;
  
  if (relativePosition < INTRO_THRESHOLD) {
    return 'intro';
  } else if (relativePosition > CONCLUSION_THRESHOLD) {
    return 'conclusion';
  } else {
    return 'middle';
  }
}

/**
 * Check if a paragraph break is likely present based on punctuation and text patterns
 */
function detectParagraphBreak(text: string): boolean {
  // Check for multiple sentence endings and newlines
  const hasSentenceEndingsPattern = /[.!?]\s+[A-Z]/.test(text);
  const hasNewlines = text.includes('\n');
  
  return hasSentenceEndingsPattern || hasNewlines;
}

/**
 * Enhanced chunking for timestamps, using intelligent boundary detection
 * and overlap between chunks
 */
export function chunkTimedTranscriptAdvanced(
  timedSegments: TimedTranscriptSegment[],
  options: AdvancedChunkingOptions = {}
): AdvancedChunk[] {
  const {
    maxChunkDuration = 120,  // 2 minutes default
    overlapDuration = 20,    // 20 seconds overlap
    respectTransitions = true,
    minChunkDuration = 30,   // 30 seconds minimum
    detectPauses = true,
    pauseThreshold = 3       // 3 seconds pause threshold
  } = options;
  
  if (!timedSegments || timedSegments.length === 0) {
    return [];
  }
  
  const chunks: AdvancedChunk[] = [];
  const totalDuration = timedSegments[timedSegments.length - 1].endTime;
  
  let currentChunk: TimedTranscriptSegment[] = [];
  let chunkStartTime = timedSegments[0].startTime;
  let currentDuration = 0;
  
  for (let i = 0; i < timedSegments.length; i++) {
    const segment = timedSegments[i];
    const segmentDuration = segment.endTime - segment.startTime;
    
    // Add segment to current chunk
    currentChunk.push(segment);
    currentDuration += segmentDuration;
    
    // Check if we should end the current chunk
    const isLastSegment = i === timedSegments.length - 1;
    const nextSegment = !isLastSegment ? timedSegments[i + 1] : null;
    const hasSignificantPause = nextSegment && detectPauses && 
      detectSignificantPause(segment, nextSegment, pauseThreshold);
    const hasTransitionPhrase = respectTransitions && detectTransitionPhrases(segment.text);
    const hasParagraphBreak = detectParagraphBreak(segment.text);
    
    // Check if we have a natural boundary or reached max duration
    if (isLastSegment || 
        currentDuration >= maxChunkDuration ||
        (currentDuration >= minChunkDuration && (hasSignificantPause || hasTransitionPhrase || hasParagraphBreak))) {
      
      // Finalize current chunk
      const chunkText = currentChunk.map(seg => seg.text).join(' ');
      const chunkEndTime = currentChunk[currentChunk.length - 1].endTime;
      
      chunks.push({
        content: chunkText,
        startTime: chunkStartTime,
        endTime: chunkEndTime,
        position: determinePosition(chunkStartTime, chunkEndTime, totalDuration),
        metadata: {
          hasTransition: hasTransitionPhrase,
          hasPause: hasSignificantPause,
          hasParagraphBreak: hasParagraphBreak,
          durationSeconds: chunkEndTime - chunkStartTime
        }
      });
      
      // If not the last segment, start a new chunk with overlap
      if (!isLastSegment) {
        // Calculate how far back to go for overlap
        let overlapIndex = i;
        let overlapTime = 0;
        
        // Go backwards through segments until we have enough overlap time
        while (overlapIndex >= 0 && overlapTime < overlapDuration) {
          const prevSeg = timedSegments[overlapIndex];
          const prevDuration = prevSeg.endTime - prevSeg.startTime;
          
          if (overlapTime + prevDuration <= overlapDuration) {
            // This entire segment fits in the overlap window
            overlapTime += prevDuration;
            overlapIndex--;
          } else {
            // Only part of this segment fits, stop here
            break;
          }
        }
        
        // Ensure we have at least one segment in overlap
        overlapIndex = Math.max(overlapIndex, i - 3);
        
        // Reset for the new chunk with overlap
        const overlapStartSegment = timedSegments[overlapIndex + 1];
        chunkStartTime = overlapStartSegment.startTime;
        currentChunk = timedSegments.slice(overlapIndex + 1, i + 1);
        currentDuration = currentChunk.reduce((total, seg) => 
          total + (seg.endTime - seg.startTime), 0);
      }
    }
  }
  
  return chunks;
}

/**
 * Parse YouTube transcript format into timed segments
 * Handles both standard YouTube transcript and other formats
 */
export function parseYouTubeTranscript(transcript: string): TimedTranscriptSegment[] {
  // Check if this looks like the YouTube transcript format
  const isYouTubeFormat = transcript.includes('<text start=') || 
                        transcript.includes('"text":') ||
                        transcript.includes('start":');
  
  if (!isYouTubeFormat) {
    // Basic fallback parser for simpler formats
    return parseBasicTranscript(transcript);
  }
  
  const segments: TimedTranscriptSegment[] = [];
  
  try {
    // Try to parse as JSON first
    if (transcript.includes('"text":')) {
      try {
        const jsonData = JSON.parse(transcript);
        
        // Handle array format
        if (Array.isArray(jsonData)) {
          return jsonData.map((item: any) => ({
            text: item.text || '',
            startTime: parseFloat(item.start) || 0,
            endTime: (item.start + item.duration) || (parseFloat(item.end) || 0)
          }));
        }
        
        // Handle object with transcript property
        if (jsonData.transcript && Array.isArray(jsonData.transcript)) {
          return jsonData.transcript.map((item: any) => ({
            text: item.text || '',
            startTime: parseFloat(item.start) || 0,
            endTime: (parseFloat(item.start) + parseFloat(item.duration)) || parseFloat(item.end) || 0
          }));
        }
      } catch (e) {
        // Not valid JSON, continue with other parsing approaches
        console.log('Failed to parse transcript as JSON, trying other methods');
      }
    }
    
    // XML-style parsing
    if (transcript.includes('<text start=')) {
      const regex = /<text start="([\d.]+)" dur="([\d.]+)">(.*?)<\/text>/g;
      let match;
      
      while ((match = regex.exec(transcript)) !== null) {
        const startTime = parseFloat(match[1]);
        const duration = parseFloat(match[2]);
        const text = match[3].replace(/&amp;/g, '&')
                              .replace(/&lt;/g, '<')
                              .replace(/&gt;/g, '>')
                              .replace(/&quot;/g, '"')
                              .replace(/&#39;/g, "'");
        
        segments.push({
          text,
          startTime,
          endTime: startTime + duration
        });
      }
      
      return segments;
    }
  } catch (error) {
    console.error('Error parsing YouTube transcript:', error);
  }
  
  // Fallback to basic parsing
  return parseBasicTranscript(transcript);
}

/**
 * Parse a basic transcript without timestamps or with simple formatting
 */
function parseBasicTranscript(transcript: string): TimedTranscriptSegment[] {
  const lines = transcript.split(/\n+/).filter(line => line.trim().length > 0);
  const segments: TimedTranscriptSegment[] = [];
  
  // Estimate approximately 5 seconds per line
  for (let i = 0; i < lines.length; i++) {
    const startTime = i * 5;
    const endTime = (i + 1) * 5;
    
    segments.push({
      text: lines[i].trim(),
      startTime,
      endTime
    });
  }
  
  return segments;
}

/**
 * Main entry point for processing YouTube transcripts with advanced chunking
 */
export function processTranscriptAdvanced(
  transcript: string,
  options: AdvancedChunkingOptions = {}
): AdvancedChunk[] {
  const timedSegments = parseYouTubeTranscript(transcript);
  return chunkTimedTranscriptAdvanced(timedSegments, options);
} 