/**
 * Video Processor Service
 * Manages the end-to-end process of retrieving YouTube data, generating embeddings,
 * and storing in Supabase pgvector
 */

import { getYoutubeTranscript } from "./youtube-transcript";
import { fetchYoutubeComments } from "./youtube-api";
import { getYoutubeVideoMetadata } from "./youtube-utils";
import { extractYouTubeId } from './utils';
import { processTranscript } from "./transcript-chunker";
import { storeVideoMetadata, storeVideoChunks, VideoChunk, VideoMetadata } from "./vector-db-service";
import { isPgvectorEnabled, getYouTubeApiKey, getOpenAIApiKey } from "./env-config";

// Types needed for processing
interface ProcessingOptions {
  maxChunkSize?: number;
  commentLimit?: number;
  userId: string;
  chunkingMethod?: 'standard' | 'enhanced';
}

interface ProcessingResult {
  success: boolean;
  videoId: string;
  totalChunks: number;
  error?: string;
}

// Define the expected YouTube metadata format with all possible properties
interface ExtendedYouTubeMetadata {
  title: string;
  channelTitle: string;
  thumbnailUrl: string;
  videoId: string;
  description?: string;
  publishTime?: string;
  publishedAt?: string; 
  viewCount?: number;
  likeCount?: number;
  commentCount?: number;
  duration?: string;
  channelAvgViews?: number;
  performanceRatio?: number;
  tags?: string[];
  categoryId?: string;
}

/**
 * Helper to clean HTML content and extract plain text
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
 * Convert HTML comments to plain text and chunk them
 */
async function processVideoComments(
  videoUrl: string, 
  commentLimit: number = 50
): Promise<VideoChunk[]> {
  try {
    console.log(`🔄 Processing comments for video: ${videoUrl}`);
    
    const videoId = extractYouTubeId(videoUrl);
    if (!videoId) throw new Error("Invalid YouTube URL");
    
    // Fetch comments using existing functionality
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
        authorName: comment.authorDisplayName,
        likeCount: comment.likeCount,
        publishedAt: comment.publishedAt
      }
    }));
    
    console.log(`✅ Processed ${commentChunks.length} comment chunks`);
    return commentChunks;
  } catch (error) {
    console.error("🚨 Error processing video comments:", error);
    return [];
  }
}

/**
 * Process a video description into chunks
 */
function processVideoDescription(
  videoMetadata: VideoMetadata
): VideoChunk[] {
  if (!videoMetadata.description || videoMetadata.description.trim() === '') {
    return [];
  }
  
  // For simplicity, we'll treat the entire description as one chunk
  return [{
    videoId: videoMetadata.id,
    content: videoMetadata.description,
    contentType: 'description',
    metadata: {
      title: videoMetadata.title,
      publishedAt: videoMetadata.publishedAt
    }
  }];
}

/**
 * Main function to process a YouTube video
 * Retrieves transcript, comments, metadata and stores vectorized chunks
 */
export async function processYoutubeVideo(
  videoUrl: string, 
  options: ProcessingOptions
): Promise<ProcessingResult> {
  try {
    console.log(`🎬 Starting processing for video: ${videoUrl}`);
    
    const videoId = extractYouTubeId(videoUrl);
    if (!videoId) {
      return { 
        success: false, 
        videoId: '', 
        totalChunks: 0, 
        error: "Invalid YouTube URL" 
      };
    }
    
    const { userId, maxChunkSize = 512, commentLimit = 50 } = options;
    
    // Check if OpenAI API key is available (replacing Anthropic check)
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
    const metadata = await getYoutubeVideoMetadata(videoUrl) as ExtendedYouTubeMetadata;
    
    if (!metadata) {
      return {
        success: false,
        videoId,
        totalChunks: 0,
        error: "Failed to fetch video metadata"
      };
    }
    
    // Calculate performance ratio if possible
    if (metadata.viewCount && metadata.channelAvgViews) {
      metadata.performanceRatio = metadata.viewCount / metadata.channelAvgViews;
    }
    
    // Step 2: Store video metadata
    console.log(`💾 Storing metadata for video ${videoId}`);
    const metadataStored = await storeVideoMetadata({
      id: videoId,
      channelId: metadata.channelTitle || 'unknown',
      title: metadata.title || 'Untitled Video',
      description: metadata.description || '',
      publishedAt: metadata.publishTime || metadata.publishedAt || new Date().toISOString(),
      viewCount: metadata.viewCount || 0,
      likeCount: metadata.likeCount,
      commentCount: metadata.commentCount,
      duration: metadata.duration,
      channelAvgViews: metadata.channelAvgViews,
      performanceRatio: metadata.performanceRatio,
      metadata: {
        tags: metadata.tags || [],
        categoryId: metadata.categoryId || ''
      }
    }, userId);
    
    if (!metadataStored) {
      console.error(`🚨 Failed to store metadata for video ${videoId}`);
      // Continue anyway - we'll still try to process chunks
    }
    
    // Step 3: Get transcript and process into chunks
    console.log(`📝 Fetching transcript for video ${videoId}`);
    let transcriptChunks: VideoChunk[] = [];
    
    try {
      const transcript = await getYoutubeTranscript(videoUrl);
      if (transcript) {
        const chunks = processTranscript(transcript, { 
          maxChunkSize,
          respectSentences: options.chunkingMethod === 'enhanced'
        });
        
        transcriptChunks = chunks.map(chunk => ({
          videoId,
          content: chunk.content,
          contentType: 'transcript',
          startTime: chunk.startTime,
          endTime: chunk.endTime,
          metadata: {
            title: metadata.title,
            section: 'transcript'
          }
        }));
        
        console.log(`✅ Processed transcript into ${transcriptChunks.length} chunks`);
      }
    } catch (transcriptError) {
      console.error(`🚨 Error processing transcript: ${transcriptError}`);
      // Continue with other content even if transcript fails
    }
    
    // Step 4: Process video description
    const descriptionChunks = processVideoDescription({
      id: videoId,
      channelId: metadata.channelTitle || 'unknown',
      title: metadata.title || 'Untitled Video',
      description: metadata.description || '',
      publishedAt: metadata.publishTime || metadata.publishedAt || new Date().toISOString(),
      viewCount: metadata.viewCount || 0
    });
    
    // Step 5: Process comments
    const commentChunks = await processVideoComments(videoUrl, commentLimit);
    
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
    let openaiApiKey = '';
    
    if (isPgvectorEnabled()) {
      console.log("🔍 Checking OpenAI API key availability...");
      openaiApiKey = getOpenAIApiKey();
      
      if (!openaiApiKey) {
        console.log("❌ OpenAI API key not configured");
        return {
          success: false,
          videoId,
          totalChunks: 0,
          error: "OpenAI API key not configured"
        };
      }
      
      console.log("✅ OpenAI API key verified");
    } else {
      console.log("ℹ️ Vector database functionality is disabled");
    }
    
    // Step 7: Store all chunks with embeddings
    console.log(`🧠 Generating embeddings and storing ${allChunks.length} chunks`);
    const chunksStored = await storeVideoChunks(allChunks, userId, openaiApiKey);
    
    if (!chunksStored) {
      return {
        success: false,
        videoId,
        totalChunks: allChunks.length,
        error: "Failed to store chunks with embeddings"
      };
    }
    
    console.log(`✅ Successfully processed video ${videoId} with ${allChunks.length} chunks`);
    
    return {
      success: true,
      videoId,
      totalChunks: allChunks.length
    };
  } catch (error) {
    console.error(`🚨 Error processing video:`, error);
    return {
      success: false,
      videoId: extractYouTubeId(videoUrl) || '',
      totalChunks: 0,
      error: error instanceof Error ? error.message : "Unknown error occurred"
    };
  }
} 