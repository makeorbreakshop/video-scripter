/**
 * Enhanced Video Processor
 * Implements advanced chunking strategies for YouTube video content
 * using timestamp-based transcript chunking and keyword-based comment clustering
 */

import { getYoutubeTranscript } from "./youtube-transcript";
import { fetchYoutubeComments } from "./youtube-api";
import { getYoutubeVideoMetadata } from "./youtube-utils";
import { extractYouTubeId } from './utils';
import { processTranscriptAdvanced, AdvancedChunk, AdvancedChunkingOptions } from "./transcript-chunker-advanced";
import { processComments, YouTubeComment, CommentCluster } from "./comment-chunker";
import { storeVideoMetadata, storeVideoChunks, VideoChunk, VideoMetadata } from "./vector-db-service";
import { isPgvectorEnabled, getYouTubeApiKey, getOpenAIApiKey } from "./env-config";

// Define enhanced processing options
export interface EnhancedProcessingOptions {
  userId: string;
  maxChunkDuration?: number;    // Max duration in seconds per chunk (default: 120s)
  overlapDuration?: number;     // Overlap in seconds (default: 20s)
  minChunkDuration?: number;    // Min duration in seconds (default: 30s)
  commentLimit?: number;        // Max comments to process
  commentSimilarityThreshold?: number; // Threshold for comment clustering (0-1)
  maxCommentClusters?: number;  // Maximum number of comment clusters
  minCommentsPerCluster?: number; // Minimum comments per cluster
  detectPauses?: boolean;       // Whether to detect pauses for chunking
  respectTransitions?: boolean; // Whether to respect transition phrases
  processMode?: 'full' | 'metadata';
}

// Define enhanced processing result
export interface EnhancedProcessingResult {
  success: boolean;
  videoId: string;
  totalChunks: number;
  transcriptChunks?: number;
  commentClusters?: number;
  descriptionChunks?: number;
  error?: string;
  wordCount?: number;
  commentCount?: number;
}

/**
 * Clean HTML content and extract plain text
 */
function cleanHtmlContent(html: string): string {
  return html
    .replace(/<[^>]*>/g, '') // Remove HTML tags
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .trim();
}

/**
 * Process video description into chunks
 * Uses position information from transcript to contextualize
 */
function processVideoDescription(metadata: VideoMetadata): VideoChunk[] {
  if (!metadata.description || metadata.description.trim().length === 0) {
    return [];
  }
  
  // Split description into paragraphs
  const paragraphs = metadata.description.split(/\n\n+/).filter(p => p.trim().length > 0);
  
  if (paragraphs.length === 0) {
    return [];
  }
  
  // For short descriptions, treat as a single chunk
  if (paragraphs.length === 1 || metadata.description.length < 500) {
    return [{
      videoId: metadata.id,
      content: metadata.description,
      contentType: 'description',
      metadata: {
        title: metadata.title,
        section: 'description',
        position: 'intro' // Descriptions typically introduce the video
      }
    }];
  }
  
  // For longer descriptions, chunk by paragraph with appropriate positions
  return paragraphs.map((paragraph, index) => {
    // Determine position in content
    let position: 'intro' | 'middle' | 'conclusion';
    if (index === 0) position = 'intro';
    else if (index === paragraphs.length - 1) position = 'conclusion';
    else position = 'middle';
    
    return {
      videoId: metadata.id,
      content: paragraph,
      contentType: 'description',
      metadata: {
        title: metadata.title,
        section: 'description',
        position,
        paragraphNumber: index + 1,
        totalParagraphs: paragraphs.length
      }
    };
  });
}

/**
 * Convert advanced transcript chunks to storage format
 */
function convertTranscriptChunks(chunks: AdvancedChunk[], videoId: string, title: string): VideoChunk[] {
  return chunks.map(chunk => ({
    videoId,
    content: chunk.content,
    contentType: 'transcript',
    startTime: chunk.startTime,
    endTime: chunk.endTime,
    metadata: {
      title,
      position: chunk.position,
      section: 'transcript',
      durationSeconds: chunk.metadata?.durationSeconds,
      hasTransition: chunk.metadata?.hasTransition,
      hasPause: chunk.metadata?.hasPause,
      hasParagraphBreak: chunk.metadata?.hasParagraphBreak
    }
  }));
}

/**
 * Convert comment clusters to storage format
 */
function convertCommentClusters(clusters: CommentCluster[], videoId: string, title: string): VideoChunk[] {
  return clusters.map((cluster, index) => ({
    videoId,
    content: cluster.content,
    contentType: 'comment_cluster',
    metadata: {
      title,
      section: 'comments',
      keywords: cluster.keywords,
      commentCount: cluster.commentCount,
      authorCount: cluster.authorCount,
      averageLikeCount: cluster.averageLikeCount,
      hasTimestampReferences: cluster.hasTimestampReferences,
      timestamps: cluster.timestamps,
      representativeComments: cluster.representativeComments,
      clusterIndex: index + 1,
      totalClusters: clusters.length
    }
  }));
}

/**
 * Handles fallback comment processing if clustering fails
 */
async function processFallbackComments(
  videoUrl: string, 
  commentLimit: number = 50,
  videoId: string,
  title: string
): Promise<VideoChunk[]> {
  try {
    console.log(`🔄 Processing comments without clustering for video: ${videoUrl}`);
    
    if (!videoId) throw new Error("Invalid YouTube URL");
    
    // Fetch comments
    const comments = await fetchYoutubeComments(videoUrl, commentLimit);
    if (!comments || comments.length === 0) {
      console.log("⚠️ No comments found for video");
      return [];
    }
    
    // Process each comment as a separate chunk
    const commentChunks: VideoChunk[] = comments.map(comment => ({
      videoId,
      content: cleanHtmlContent(comment.textDisplay),
      contentType: 'comment',
      metadata: {
        title,
        section: 'comments',
        authorName: comment.authorDisplayName,
        likeCount: comment.likeCount,
        publishedAt: comment.publishedAt
      }
    }));
    
    console.log(`✅ Processed ${commentChunks.length} individual comment chunks`);
    return commentChunks;
  } catch (error) {
    console.error("🚨 Error processing video comments:", error);
    return [];
  }
}

/**
 * Main function to process a YouTube video with enhanced chunking
 */
export async function processYoutubeVideoEnhanced(
  videoUrl: string,
  options: EnhancedProcessingOptions
): Promise<EnhancedProcessingResult> {
  try {
    console.log(`🎬 Starting enhanced processing for video: ${videoUrl}`);
    
    const videoId = extractYouTubeId(videoUrl);
    if (!videoId) {
      return { 
        success: false, 
        videoId: '', 
        totalChunks: 0, 
        error: "Invalid YouTube URL" 
      };
    }
    
    const {
      userId,
      maxChunkDuration = 120,
      overlapDuration = 20,
      minChunkDuration = 30,
      commentLimit = 100,
      commentSimilarityThreshold = 0.3,
      maxCommentClusters = 10,
      minCommentsPerCluster = 3,
      detectPauses = true,
      respectTransitions = true,
      processMode = 'full'
    } = options;
    
    // Check if OpenAI API key is available for vector storage
    const openAIApiKey = getOpenAIApiKey();
    
    if (!openAIApiKey) {
      return {
        success: false,
        videoId,
        totalChunks: 0,
        error: "OpenAI API key not configured"
      };
    }
    
    // Step 1: Get video metadata
    console.log(`🔍 Fetching metadata for video ${videoId}`);
    const rawMetadata = await getYoutubeVideoMetadata(videoUrl);
    
    if (!rawMetadata) {
      return {
        success: false,
        videoId,
        totalChunks: 0,
        error: "Failed to fetch video metadata"
      };
    }
    
    // Calculate performance ratio if possible
    const metadata: VideoMetadata = {
      id: videoId,
      channelId: rawMetadata.channelTitle || 'unknown',
      title: rawMetadata.title || 'Untitled Video',
      description: rawMetadata.description || '',
      publishedAt: (rawMetadata as any).publishTime || (rawMetadata as any).publishedAt || new Date().toISOString(),
      viewCount: (rawMetadata as any).viewCount || 0,
      likeCount: (rawMetadata as any).likeCount,
      commentCount: (rawMetadata as any).commentCount,
      duration: (rawMetadata as any).duration,
      metadata: {
        tags: (rawMetadata as any).tags || [],
        categoryId: (rawMetadata as any).categoryId || ''
      }
    };
    
    // Calculate performance metrics if possible
    if ((rawMetadata as any).viewCount && (rawMetadata as any).channelAvgViews) {
      metadata.performanceRatio = (rawMetadata as any).viewCount / (rawMetadata as any).channelAvgViews;
      metadata.channelAvgViews = (rawMetadata as any).channelAvgViews;
    }
    
    // Step 2: Store video metadata
    console.log(`💾 Storing metadata for video ${videoId}`);
    const metadataStored = await storeVideoMetadata(metadata, userId);
    
    if (!metadataStored) {
      console.error(`🚨 Failed to store metadata for video ${videoId}`);
      // Continue anyway - we'll still try to process chunks
    }
    
    // If processMode is 'metadata', return early with just the metadata
    if (processMode === 'metadata') {
      return {
        success: true,
        videoId,
        totalChunks: 0,
        wordCount: 0,
        commentCount: 0
      };
    }
    
    // Step 3: Get transcript and process with advanced chunking
    console.log(`📝 Fetching transcript for video ${videoId}`);
    let transcriptChunks: VideoChunk[] = [];
    
    try {
      const transcript = await getYoutubeTranscript(videoUrl);
      if (transcript) {
        // Use advanced chunking with timestamp-based segmentation
        const advancedOptions: AdvancedChunkingOptions = {
          maxChunkDuration,
          overlapDuration,
          minChunkDuration,
          respectTransitions,
          detectPauses
        };
        
        const chunks = processTranscriptAdvanced(transcript, advancedOptions);
        
        // Convert to storage format with enhanced metadata
        transcriptChunks = convertTranscriptChunks(chunks, videoId, metadata.title);
        
        console.log(`✅ Processed transcript into ${transcriptChunks.length} enhanced chunks`);
      }
    } catch (transcriptError) {
      console.error(`🚨 Error processing transcript: ${transcriptError}`);
      // Continue with other content even if transcript fails
    }
    
    // Step 4: Process description with position awareness
    const descriptionChunks = processVideoDescription(metadata);
    console.log(`✅ Processed description into ${descriptionChunks.length} chunks`);
    
    // Step 5: Process comments with keyword clustering
    let commentChunks: VideoChunk[] = [];
    try {
      console.log(`🔄 Processing comments with clustering for video: ${videoUrl}`);
      
      const comments = await fetchYoutubeComments(videoUrl, commentLimit);
      if (comments && comments.length > 0) {
        // Use keyword-based clustering for comments
        const commentClusters = processComments(comments as YouTubeComment[], {
          similarityThreshold: commentSimilarityThreshold,
          maxClusters: maxCommentClusters,
          minCommentsPerCluster: minCommentsPerCluster
        });
        
        // Convert clusters to storage format
        commentChunks = convertCommentClusters(commentClusters, videoId, metadata.title);
        
        console.log(`✅ Processed ${comments.length} comments into ${commentChunks.length} clusters`);
      } else {
        console.log("⚠️ No comments found for video");
      }
    } catch (commentError) {
      console.error(`🚨 Error processing comments with clustering: ${commentError}`);
      
      // Fallback to simple comment processing if clustering fails
      commentChunks = await processFallbackComments(videoUrl, commentLimit, videoId, metadata.title);
    }
    
    // Step 6: Combine all chunks
    const allChunks = [
      ...transcriptChunks,
      ...descriptionChunks,
      ...commentChunks
    ];
    
    if (allChunks.length === 0) {
      return {
        success: false,
        videoId,
        totalChunks: 0,
        error: "No content chunks were generated from video"
      };
    }
    
    // Check if pgvector is enabled and required services are available
    if (!isPgvectorEnabled()) {
      console.log("ℹ️ Vector database functionality is disabled");
      return {
        success: false,
        videoId,
        totalChunks: allChunks.length,
        transcriptChunks: transcriptChunks.length,
        commentClusters: commentChunks.length,
        descriptionChunks: descriptionChunks.length,
        error: "Vector database functionality is disabled"
      };
    }
    
    // Step 7: Store all chunks with embeddings
    console.log(`🧠 Generating embeddings and storing ${allChunks.length} enhanced chunks`);
    const chunksStored = await storeVideoChunks(allChunks, userId, openAIApiKey);
    
    if (!chunksStored) {
      return {
        success: false,
        videoId,
        totalChunks: allChunks.length,
        transcriptChunks: transcriptChunks.length,
        commentClusters: commentChunks.length,
        descriptionChunks: descriptionChunks.length,
        error: "Failed to store chunks with embeddings"
      };
    }
    
    console.log(`✅ Successfully processed video ${videoId} with ${allChunks.length} enhanced chunks`);
    
    return {
      success: true,
      videoId,
      totalChunks: allChunks.length,
      transcriptChunks: transcriptChunks.length,
      commentClusters: commentChunks.length,
      descriptionChunks: descriptionChunks.length,
      wordCount: allChunks.reduce((total, chunk) => total + chunk.content.length, 0),
      commentCount: commentChunks.length
    };
  } catch (error) {
    console.error(`🚨 Error in enhanced video processing:`, error);
    return {
      success: false,
      videoId: extractYouTubeId(videoUrl) || '',
      totalChunks: 0,
      error: error instanceof Error ? error.message : "Unknown error occurred"
    };
  }
} 