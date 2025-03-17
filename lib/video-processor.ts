/**
 * Video Processor Service
 * Manages the end-to-end process of retrieving YouTube data, generating embeddings,
 * and storing in Supabase pgvector
 */

import { getYoutubeTranscript } from "./youtube-transcript";
import { fetchYoutubeComments, fetchAllYoutubeComments } from "./youtube-api";
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
  processMode?: 'full' | 'metadata';
}

interface ProcessingResult {
  success: boolean;
  videoId: string;
  totalChunks: number;
  error?: string;
  chunks?: VideoChunk[];
  wordCount?: number;
  commentCount?: number;
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
  commentLimit: number = 500,
  chunkingMethod: 'standard' | 'enhanced' = 'standard'
): Promise<VideoChunk[]> {
  try {
    console.log(`🔄 Processing comments for video: ${videoUrl} with limit: ${commentLimit}, method: ${chunkingMethod}`);
    
    const videoId = extractYouTubeId(videoUrl);
    if (!videoId) throw new Error("Invalid YouTube URL");
    
    // Use fetchAllYoutubeComments directly to get all comments
    console.log(`💬 Fetching comments directly with fetchAllYoutubeComments for video ID: ${videoId}`);
    const comments = await fetchAllYoutubeComments(videoUrl);
    
    if (!comments || comments.length === 0) {
      console.log(`⚠️ No comments found for video ID: ${videoId}`);
      return [];
    }
    
    console.log(`📊 Retrieved ${comments.length} real comments for video ID: ${videoId}`);
    
    // Limit the number of comments if needed
    const limitedComments = comments.slice(0, commentLimit);
    console.log(`📊 Using ${limitedComments.length} comments based on limit of ${commentLimit}`);
    
    // For enhanced mode, use OpenAI-powered comment clustering
    if (chunkingMethod === 'enhanced' && limitedComments.length > 10) {
      try {
        // Import the enhanced comment clustering functionality
        const { processCommentsEnhanced } = await import('./comment-chunker');
        
        // Convert to the expected format
        const formattedComments = limitedComments.map(comment => ({
          textDisplay: comment.textDisplay,
          authorDisplayName: comment.authorDisplayName,
          likeCount: comment.likeCount,
          publishedAt: comment.publishedAt
        }));
        
        // Process comments with OpenAI-powered clustering
        const commentClusters = await processCommentsEnhanced(formattedComments, {
          maxClusters: Math.min(20, Math.ceil(limitedComments.length / 5)),
          minCommentsPerCluster: 3,
          useEmbeddings: true // Use OpenAI embeddings for clustering
        });
        
        // Convert clusters to storage format
        const clusterChunks: VideoChunk[] = commentClusters.map(cluster => ({
          videoId,
          content: cluster.content,
          contentType: 'comment_cluster',
          metadata: {
            keywords: cluster.keywords,
            commentCount: cluster.commentCount,
            authorCount: cluster.authorCount,
            averageLikeCount: cluster.averageLikeCount,
            hasTimestampReferences: cluster.hasTimestampReferences,
            timestamps: cluster.timestamps
          }
        }));
        
        console.log(`✅ Processed ${limitedComments.length} comments into ${clusterChunks.length} semantic clusters using OpenAI`);
        return clusterChunks;
      } catch (clusterError) {
        console.error(`🚨 Error clustering comments with OpenAI: ${clusterError}`);
        console.log(`⚠️ Falling back to standard comment processing`);
        // Fall back to standard processing if clustering fails
      }
    }
    
    // Standard processing: each comment as a separate chunk
    const commentChunks: VideoChunk[] = limitedComments.map((comment: any) => ({
      videoId,
      content: cleanHtmlContent(comment.textDisplay),
      contentType: 'comment',
      metadata: {
        authorName: comment.authorDisplayName,
        likeCount: comment.likeCount,
        publishedAt: comment.publishedAt
      }
    }));
    
    console.log(`✅ Processed ${commentChunks.length} comment chunks for video ID: ${videoId}`);
    return commentChunks;
  } catch (error) {
    console.error(`🚨 Error processing video comments for ${videoUrl}:`, error);
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
 * Process a YouTube video end-to-end: fetch metadata, transcript, comments,
 * generate embeddings, and store in the database
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
    
    const { userId, maxChunkSize = 512, commentLimit = 500, processMode = 'full' } = options;
    
    // Check if OpenAI API key is available
    const openAIApiKey = getOpenAIApiKey();
    
    if (!openAIApiKey) {
      return {
        success: false,
        videoId,
        totalChunks: 0,
        error: "OpenAI API key not configured"
      };
    }
    
    // Check if YouTube API key is available
    const youtubeApiKey = getYouTubeApiKey();
    if (!youtubeApiKey) {
      console.warn('⚠️ No YouTube API key found - comments will be simulated');
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
    const commentChunks = await processVideoComments(videoUrl, commentLimit, options.chunkingMethod);
    console.log(`📊 Created ${commentChunks.length} comment chunks`);
    
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
    
    // Calculate word count from transcript and description chunks
    const wordCount = allChunks
      .filter(chunk => chunk.contentType === 'transcript' || chunk.contentType === 'description')
      .reduce((count, chunk) => count + (chunk.content?.split(/\s+/).length || 0), 0);

    // Calculate comment count
    const commentCount = commentChunks.length;
    
    return {
      success: true,
      videoId,
      totalChunks: allChunks.length,
      chunks: allChunks,
      wordCount,
      commentCount
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