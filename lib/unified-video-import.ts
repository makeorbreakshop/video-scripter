/**
 * Unified Video Import Service
 * Consolidates all video import mechanisms into a single, standardized service
 * Handles metadata extraction, embedding generation, storage, and exports
 */

import { createClient } from '@supabase/supabase-js';
import { Pinecone } from '@pinecone-database/pinecone';
import { batchGenerateTitleEmbeddings } from './title-embeddings.ts';
import { batchGenerateThumbnailEmbeddings, exportThumbnailEmbeddings } from './thumbnail-embeddings.ts';
import { pineconeService } from './pinecone-service.ts';
import { pineconeThumbnailService } from './pinecone-thumbnail-service.ts';
import { PineconeSummaryService } from './pinecone-summary-service.ts';
import { quotaTracker } from './youtube-quota-tracker.ts';
import { TemporalBaselineProcessor } from './temporal-baseline-processor.ts';
import { llmFormatClassificationService } from './llm-format-classification-service.ts';
import { topicDetectionService } from './topic-detection-service.ts';
import { retryPineconeOperation, retrySupabaseOperation } from './utils/retry-with-backoff.ts';
import { BERTopicClassificationService } from './bertopic-classification-service.ts';
import { generateVideoSummaries, generateSummaryEmbeddings } from './unified-import-summary-integration.ts';
import * as fs from 'fs';
import * as path from 'path';

// Initialize Supabase client with service role for full database access
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// Types
export interface VideoImportRequest {
  source: 'competitor' | 'discovery' | 'rss' | 'owner' | 'sync';
  videoIds?: string[];
  channelIds?: string[];
  rssFeedUrls?: string[];
  options?: {
    skipEmbeddings?: boolean;
    skipExports?: boolean;
    skipThumbnailEmbeddings?: boolean;
    skipTitleEmbeddings?: boolean;
    skipClassification?: boolean;
    skipSummaries?: boolean;
    summaryModel?: string;
    batchSize?: number;
    forceReEmbed?: boolean;
    maxVideosPerChannel?: number;
    // Competitor-specific options
    timePeriod?: string; // 'all' or number of days
    excludeShorts?: boolean;
    userId?: string;
    // Date filtering options
    dateFilter?: 'all' | 'recent'; // Filter videos by date
    dateRange?: number; // Number of days to look back (default: 1095 for 3 years)
  };
}

export interface VideoImportResult {
  success: boolean;
  message: string;
  videosProcessed: number;
  embeddingsGenerated: {
    titles: number;
    thumbnails: number;
  };
  classificationsGenerated: number;
  summariesGenerated: number;
  summaryEmbeddingsGenerated: number;
  exportFiles: string[];
  errors: string[];
  processedVideoIds: string[];
}

export interface VideoMetadata {
  id: string;
  title: string;
  channel_id: string;
  channel_name: string;
  view_count: number;
  published_at: string;
  performance_ratio: number;
  thumbnail_url: string;
  description?: string;
  data_source: string;
  is_competitor: boolean;
  import_date: string;
  metadata?: Record<string, any>;
}

export interface EmbeddingResults {
  titleEmbeddings: Array<{
    videoId: string;
    embedding: number[];
    success: boolean;
    error?: string;
  }>;
  thumbnailEmbeddings: Array<{
    videoId: string;
    embedding: number[];
    success: boolean;
    error?: string;
  }>;
}

/**
 * Main Unified Video Import Service
 */
export class VideoImportService {
  private openaiApiKey: string;
  private youtubeApiKey: string;
  private youtubeAPIWithFallback: any = null;
  private fallbackInitialized: boolean = false;
  // Channel stats cache to avoid redundant API calls
  private channelStatsCache = new Map<string, any>();
  // Job ID for quota tracking
  private jobId?: string;
  // BERTopic classification service
  private bertopicService: BERTopicClassificationService;

  constructor() {
    this.openaiApiKey = process.env.OPENAI_API_KEY || '';
    this.youtubeApiKey = process.env.YOUTUBE_API_KEY || '';
    
    if (!this.openaiApiKey) {
      throw new Error('OPENAI_API_KEY environment variable is required');
    }
    if (!this.youtubeApiKey) {
      throw new Error('YOUTUBE_API_KEY environment variable is required');
    }
    
    // Initialize BERTopic service
    this.bertopicService = new BERTopicClassificationService();
    
    // Initialize fallback system if backup key exists (async)
    this.initializeFallbackSystem();
  }

  private async initializeFallbackSystem(): Promise<void> {
    if (this.fallbackInitialized) {
      return; // Already initialized
    }
    
    if (process.env.YOUTUBE_API_KEY_BACKUP) {
      try {
        const { youtubeAPIWithFallback } = await import('./youtube-api-with-fallback.ts');
        this.youtubeAPIWithFallback = youtubeAPIWithFallback;
        this.youtubeApiKey = youtubeAPIWithFallback.getCurrentKey() || this.youtubeApiKey;
        const status = youtubeAPIWithFallback.getStatus();
        if (status.usingBackup) {
          console.log('🔄 Using BACKUP YouTube API key for import');
        }
        this.fallbackInitialized = true;
      } catch (error) {
        console.error('Failed to load YouTube API fallback system:', error);
      }
    }
  }

  /**
   * Make a YouTube API request with automatic failover support
   */
  private async makeYouTubeRequest(url: string): Promise<Response> {
    if (this.youtubeAPIWithFallback) {
      // Remove any existing key from URL since makeRequest will add it
      const urlWithoutKey = url.replace(/[?&]key=[^&]*/, '');
      return this.youtubeAPIWithFallback.makeRequest(urlWithoutKey);
    } else {
      // Fallback to direct fetch with single key
      const urlWithKey = url.includes('key=') ? url : 
        (url.includes('?') ? `${url}&key=${this.youtubeApiKey}` : `${url}?key=${this.youtubeApiKey}`);
      return fetch(urlWithKey);
    }
  }

  /**
   * Set job ID for quota tracking
   */
  setJobId(jobId: string): void {
    this.jobId = jobId;
  }

  /**
   * Clear the channel stats cache
   */
  private clearChannelStatsCache(): void {
    this.channelStatsCache.clear();
    console.log('🧹 Cleared channel stats cache');
  }

  /**
   * Main entry point for video import processing
   */
  async processVideos(request: VideoImportRequest): Promise<VideoImportResult> {
    console.log(`🚀 Starting unified video import for source: ${request.source}`);
    
    // Ensure fallback system is initialized
    await this.initializeFallbackSystem();
    
    const result: VideoImportResult = {
      success: false,
      message: '',
      videosProcessed: 0,
      embeddingsGenerated: { titles: 0, thumbnails: 0 },
      classificationsGenerated: 0,
      summariesGenerated: 0,
      summaryEmbeddingsGenerated: 0,
      exportFiles: [],
      errors: [],
      processedVideoIds: []
    };

    try {
      // Step 1: Extract video metadata
      const videoMetadata = await this.processVideoMetadata(request);
      
      if (videoMetadata.length === 0) {
        result.message = 'No videos found to process';
        result.success = true;
        return result;
      }

      result.videosProcessed = videoMetadata.length;
      result.processedVideoIds = videoMetadata.map(v => v.id);

      // Step 2: Store video data in Supabase
      await this.storeVideoData(videoMetadata);

      // Prepare parallel operations
      const parallelOperations: Promise<any>[] = [];
      
      // Step 3a: Generate LLM summaries (new)
      let summaryResults: Array<{videoId: string; summary: string | null; success: boolean; error?: string}> = [];
      if (!request.options?.skipSummaries) {
        const summaryPromise = (async () => {
          summaryResults = await generateVideoSummaries(videoMetadata, {
            skipSummaries: request.options?.skipSummaries,
            summaryModel: request.options?.summaryModel
          });
          result.summariesGenerated = summaryResults.filter(r => r.success).length;
        })();
        parallelOperations.push(summaryPromise);
      }
      
      // Step 3b: Generate embeddings (existing, but now in parallel)
      let embeddingResults: EmbeddingResults | null = null;
      if (!request.options?.skipEmbeddings) {
        const embeddingPromise = (async () => {
          embeddingResults = await this.processVideoEmbeddings(videoMetadata, request.options);
          result.embeddingsGenerated.titles = embeddingResults.titleEmbeddings.filter(e => e.success).length;
          result.embeddingsGenerated.thumbnails = embeddingResults.thumbnailEmbeddings.filter(e => e.success).length;
        })();
        parallelOperations.push(embeddingPromise);
      }
      
      // Run summaries and embeddings in parallel
      if (parallelOperations.length > 0) {
        console.log(`⚡ Running ${parallelOperations.length} operations in parallel (summaries + embeddings)...`);
        await Promise.all(parallelOperations);
      }

      // Step 4 & 5: Export and Upload in parallel (moved before classification)
      const postProcessingPromises: Promise<void>[] = [];
      
      // Export embeddings locally (if not skipped)
      if (!request.options?.skipExports && embeddingResults) {
        const exportPromise = (async () => {
          const exportFiles = await this.exportEmbeddings(videoMetadata, embeddingResults);
          result.exportFiles = exportFiles;
        })();
        postProcessingPromises.push(exportPromise);
      }

      // Upload to Pinecone (if embeddings were generated)
      if (embeddingResults && !request.options?.skipEmbeddings) {
        const uploadPromise = this.uploadToPinecone(embeddingResults);
        postProcessingPromises.push(uploadPromise);
      }
      
      // Run export and upload in parallel
      if (postProcessingPromises.length > 0) {
        console.log(`⚡ Running post-processing in parallel (${postProcessingPromises.length} operations)...`);
        await Promise.all(postProcessingPromises);
      }
      
      // Step 3c: Generate summary embeddings (after summaries complete)
      let summaryEmbeddingResults: Array<{ videoId: string; embedding: number[]; success: boolean; error?: string }> = [];
      if (summaryResults.length > 0 && !request.options?.skipEmbeddings) {
        console.log(`🔄 Generating embeddings for ${summaryResults.filter(r => r.success).length} summaries...`);
        summaryEmbeddingResults = await generateSummaryEmbeddings(summaryResults);
        result.summaryEmbeddingsGenerated = summaryEmbeddingResults.filter(e => e.success).length;
        
        // Upload summary embeddings to Pinecone
        if (summaryEmbeddingResults.filter(e => e.success).length > 0) {
          await this.uploadSummaryEmbeddingsToPinecone(summaryEmbeddingResults);
        }
      }

      // Step 6: Classify videos AFTER we have both title and summary embeddings
      console.log(`🔍 Classification check: skipClassification=${request.options?.skipClassification}, embeddingResults=${!!embeddingResults}, titleEmbeddings=${embeddingResults?.titleEmbeddings?.length || 0}, summaryEmbeddings=${summaryEmbeddingResults.length}`);
      if (!request.options?.skipClassification && embeddingResults && embeddingResults.titleEmbeddings.length > 0) {
        console.log(`🏷️ Starting classification for ${videoMetadata.length} videos...`);
        const classificationCount = await this.classifyVideos(videoMetadata, embeddingResults, summaryEmbeddingResults);
        console.log(`✅ Classification complete: ${classificationCount} videos classified`);
        result.classificationsGenerated = classificationCount;
      } else {
        console.log(`⚠️ Skipping classification: conditions not met`);
      }

      result.success = true;
      result.message = `Successfully processed ${videoMetadata.length} videos`;
      
      console.log(`\n✅ IMPORT COMPLETE: ${result.videosProcessed} videos processed successfully`);
      if (result.embeddingsGenerated.titles > 0) {
        console.log(`📊 Generated ${result.embeddingsGenerated.titles} title embeddings, ${result.embeddingsGenerated.thumbnails} thumbnail embeddings`);
      }
      if (result.summariesGenerated > 0) {
        console.log(`📝 Generated ${result.summariesGenerated} summaries, ${result.summaryEmbeddingsGenerated} summary embeddings`);
      }
      if (result.exportFiles.length > 0) {
        console.log(`📁 Exported to: ${result.exportFiles.join(', ')}`);
      }
      
      // Trigger baseline processing for newly imported videos using fast direct database approach
      let baselineProcessingSuccess = false;
      if (result.videosProcessed > 0) {
        try {
          console.log(`🔄 Triggering temporal baseline processing for ${result.videosProcessed} new videos...`);
          
          const baselineProcessor = new TemporalBaselineProcessor();
          const baselineResult = await baselineProcessor.processRecentVideos(result.videosProcessed);
          await baselineProcessor.close();
          
          if (baselineResult.success) {
            console.log(`✅ Temporal baseline processing complete: ${baselineResult.processedVideos} videos processed`);
            baselineProcessingSuccess = true;
          } else {
            console.error('⚠️ Baseline processing failed:', baselineResult.error);
            result.errors.push(`Baseline processing failed: ${baselineResult.error}`);
          }
        } catch (error) {
          console.error('⚠️ Error triggering baseline processing:', error);
          const errorMessage = error instanceof Error ? error.message : String(error);
          result.errors.push(`Baseline processing trigger failed: ${errorMessage}`);
        }
      } else {
        baselineProcessingSuccess = true; // No videos to process
      }
      
      // Only clear cache after ALL processing (including baseline) is successful
      if (baselineProcessingSuccess) {
        this.clearChannelStatsCache();
        console.log(`✅ All processing complete, cache cleared`);
      } else {
        console.log(`⚠️ Keeping cache due to baseline processing issues - will retry on next import`);
      }
      
      return result;

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      result.errors.push(errorMessage);
      result.message = `Import failed: ${errorMessage}`;
      console.error('❌ Unified video import failed:', error);
      
      // Only clear cache on non-recoverable errors to preserve work for retry
      const isRecoverableError = errorMessage.includes('timeout') || 
                                 errorMessage.includes('57014') ||
                                 errorMessage.includes('ECONNRESET') ||
                                 errorMessage.includes('ENOTFOUND');
      
      if (isRecoverableError) {
        console.log('⚠️ Keeping cache for potential retry due to recoverable error');
      } else {
        console.log('🧹 Clearing cache due to non-recoverable error');
        this.clearChannelStatsCache();
      }
      
      return result;
    }
  }

  /**
   * Extract and validate video metadata from various sources
   */
  async processVideoMetadata(request: VideoImportRequest): Promise<VideoMetadata[]> {
    console.log(`📊 Processing video metadata for ${request.source}`);
    
    const videoIds: string[] = [];
    
    // Collect video IDs from different sources
    if (request.videoIds) {
      videoIds.push(...request.videoIds);
    }
    
    if (request.channelIds) {
      // For channel IDs, we need to fetch recent videos
      const channelVideoIds = await this.fetchVideosFromChannels(
        request.channelIds, 
        {
          maxVideosPerChannel: request.options?.maxVideosPerChannel,
          timePeriod: request.options?.timePeriod,
          excludeShorts: request.options?.excludeShorts,
          dateFilter: request.options?.dateFilter,
          dateRange: request.options?.dateRange
        }
      );
      videoIds.push(...channelVideoIds);
    }
    
    if (request.rssFeedUrls) {
      // For RSS feeds, parse and extract video IDs
      const rssVideoIds = await this.fetchVideosFromRSS(request.rssFeedUrls);
      videoIds.push(...rssVideoIds);
    }

    // Remove duplicates
    const uniqueVideoIds = Array.from(new Set(videoIds));
    
    if (uniqueVideoIds.length === 0) {
      return [];
    }

    // Fetch video details from YouTube API
    const videoMetadata: VideoMetadata[] = [];
    const batchSize = 50; // YouTube API allows up to 50 IDs per request
    
    for (let i = 0; i < uniqueVideoIds.length; i += batchSize) {
      const batch = uniqueVideoIds.slice(i, i + batchSize);
      
      try {
        const batchResults = await this.fetchVideoDetailsBatch(batch, request.source, request.options?.userId);
        videoMetadata.push(...batchResults);
      } catch (error) {
        console.error(`❌ Failed to fetch batch ${i / batchSize + 1}:`, error);
      }
    }

    // Filter out shorts and invalid videos
    const validVideos = videoMetadata.filter(video => {
      // Basic validation
      if (!video.id || !video.title || !video.channel_id) {
        return false;
      }
      
      // Skip YouTube Shorts (typically have #shorts in title or very short duration)
      if (video.title.toLowerCase().includes('#shorts') || video.title.toLowerCase().includes('#short')) {
        return false;
      }
      
      return true;
    });


    console.log(`📊 Processed ${validVideos.length}/${uniqueVideoIds.length} valid videos`);
    return validVideos;
  }

  /**
   * Generate embeddings for video titles and thumbnails
   */
  async processVideoEmbeddings(
    videos: VideoMetadata[], 
    options?: VideoImportRequest['options']
  ): Promise<EmbeddingResults> {
    console.log(`🔄 Generating embeddings for ${videos.length} videos`);
    
    const results: EmbeddingResults = {
      titleEmbeddings: [],
      thumbnailEmbeddings: []
    };

    // Prepare embedding generation promises
    const embeddingPromises: Promise<void>[] = [];

    // Generate title embeddings (OpenAI 512D)
    if (!options?.skipTitleEmbeddings) {
      const titlePromise = (async () => {
        try {
          const titles = videos.map(v => v.title);
          const titleEmbeddings = await batchGenerateTitleEmbeddings(titles, this.openaiApiKey);
          
          results.titleEmbeddings = videos.map((video, index) => ({
            videoId: video.id,
            embedding: titleEmbeddings[index] || [],
            success: titleEmbeddings[index] ? true : false,
            error: titleEmbeddings[index] ? undefined : 'Failed to generate title embedding'
          }));
          
          console.log(`✅ Generated ${results.titleEmbeddings.filter(e => e.success).length} title embeddings`);
        } catch (error) {
          console.error('❌ Title embedding generation failed:', error);
          // Mark all as failed
          results.titleEmbeddings = videos.map(video => ({
            videoId: video.id,
            embedding: [],
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error'
          }));
        }
      })();
      embeddingPromises.push(titlePromise);
    }

    // Generate thumbnail embeddings (Replicate CLIP 768D)
    if (!options?.skipThumbnailEmbeddings) {
      const thumbnailPromise = (async () => {
        try {
          const thumbnailData = videos.map(v => ({
            id: v.id,
            thumbnailUrl: v.thumbnail_url
          }));
          
          const thumbnailResults = await batchGenerateThumbnailEmbeddings(thumbnailData);
          
          results.thumbnailEmbeddings = thumbnailResults.map(result => ({
            videoId: result.id,
            embedding: result.embedding || [],
            success: result.success,
            error: result.error
          }));
          
          console.log(`✅ Generated ${results.thumbnailEmbeddings.filter(e => e.success).length} thumbnail embeddings`);
        } catch (error) {
          console.error('❌ Thumbnail embedding generation failed:', error);
          // Mark all as failed
          results.thumbnailEmbeddings = videos.map(video => ({
            videoId: video.id,
            embedding: [],
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error'
          }));
        }
      })();
      embeddingPromises.push(thumbnailPromise);
    }

    // Run both embedding generations in parallel
    if (embeddingPromises.length > 0) {
      console.log(`⚡ Generating embeddings in parallel (${embeddingPromises.length} operations)...`);
      await Promise.all(embeddingPromises);
    }

    // Update database to track which videos have embeddings
    await this.updateEmbeddingVersions(videos, results);

    return results;
  }

  /**
   * Update embedding version fields in database
   */
  private async updateEmbeddingVersions(
    videos: VideoMetadata[], 
    embeddings: EmbeddingResults
  ): Promise<void> {
    console.log(`🔄 Updating embedding version tracking...`);
    
    // Collect successful video IDs for batch updates
    const titleVideoIds = embeddings.titleEmbeddings
      .filter(e => e.success)
      .map(e => e.videoId);
    
    const thumbnailVideoIds = embeddings.thumbnailEmbeddings
      .filter(e => e.success)
      .map(e => e.videoId);
    
    // Batch update title embedding versions in chunks
    const BATCH_SIZE = 100; // Update 100 videos at a time
    
    // Update title embedding versions in batches
    for (let i = 0; i < titleVideoIds.length; i += BATCH_SIZE) {
      const batch = titleVideoIds.slice(i, i + BATCH_SIZE);
      const { error } = await supabase
        .from('videos')
        .update({ pinecone_embedding_version: 'v1' })
        .in('id', batch);
      
      if (error) {
        console.error(`Failed to update title embedding versions for batch ${i / BATCH_SIZE + 1}:`, error);
      }
    }
    
    // Update thumbnail embedding versions in batches
    for (let i = 0; i < thumbnailVideoIds.length; i += BATCH_SIZE) {
      const batch = thumbnailVideoIds.slice(i, i + BATCH_SIZE);
      const { error } = await supabase
        .from('videos')
        .update({ thumbnail_embedding_version: 'v1' })
        .in('id', batch);
      
      if (error) {
        console.error(`Failed to update thumbnail embedding versions for batch ${i / BATCH_SIZE + 1}:`, error);
      }
    }
    
    console.log(`✅ Updated ${titleVideoIds.length} title versions, ${thumbnailVideoIds.length} thumbnail versions`);
  }

  /**
   * Store video data in Supabase with chunked processing and timeout fallback
   */
  async storeVideoData(videos: VideoMetadata[]): Promise<void> {
    console.log(`💾 Storing ${videos.length} videos in database...`);
    
    // For large batches, use chunked storage to avoid timeouts
    const CHUNK_SIZE = 500; // Process 500 videos at a time
    const TIMEOUT_THRESHOLD = 1000; // Use chunking for 1000+ videos
    
    if (videos.length >= TIMEOUT_THRESHOLD) {
      console.log(`📦 Large batch detected (${videos.length} videos), using chunked storage...`);
      await this.storeVideoDataChunked(videos, CHUNK_SIZE);
    } else {
      // For smaller batches, try normal storage first
      try {
        const { error } = await supabase
          .from('videos')
          .upsert(videos, {
            onConflict: 'id',
            ignoreDuplicates: false
          });

        if (error) {
          // If we get a timeout error, fall back to chunked storage
          if (error.code === '57014') { // statement timeout
            console.log(`⚠️ Timeout detected, falling back to chunked storage...`);
            await this.storeVideoDataChunked(videos, CHUNK_SIZE);
            return;
          }
          
          console.error('❌ Failed to store video data:', error);
          throw new Error(`Failed to store video data: ${error.message}`);
        }
        
        console.log(`✅ Database storage complete (${videos.length} videos)`);
      } catch (error) {
        // Check if it's a timeout-related error
        const errorMessage = error instanceof Error ? error.message : String(error);
        if (errorMessage.includes('timeout') || errorMessage.includes('57014')) {
          console.log(`⚠️ Timeout error detected, falling back to chunked storage...`);
          await this.storeVideoDataChunked(videos, CHUNK_SIZE);
        } else {
          throw error;
        }
      }
    }
  }

  /**
   * Store video data in chunks to avoid database timeouts
   */
  private async storeVideoDataChunked(videos: VideoMetadata[], chunkSize: number): Promise<void> {
    console.log(`📦 Processing ${videos.length} videos in chunks of ${chunkSize}...`);
    
    const totalChunks = Math.ceil(videos.length / chunkSize);
    let successCount = 0;
    let failureCount = 0;
    
    for (let i = 0; i < videos.length; i += chunkSize) {
      const chunk = videos.slice(i, i + chunkSize);
      const chunkNumber = Math.floor(i / chunkSize) + 1;
      
      try {
        console.log(`📦 Processing chunk ${chunkNumber}/${totalChunks} (${chunk.length} videos)...`);
        
        const { error } = await retrySupabaseOperation(
          async () => {
            const result = await supabase
              .from('videos')
              .upsert(chunk, {
                onConflict: 'id',
                ignoreDuplicates: false
              });
            
            if (result.error) {
              // Check if it's a retryable error
              if (result.error.code === '57014' || 
                  result.error.message?.includes('fetch failed') ||
                  result.error.message?.includes('ETIMEDOUT')) {
                throw result.error; // This will trigger retry
              }
              // Non-retryable errors should be returned
              return result;
            }
            return result;
          },
          `store chunk ${chunkNumber}/${totalChunks}`
        );

        if (error) {
          console.error(`❌ Chunk ${chunkNumber} failed after retries:`, error);
          failureCount += chunk.length;
          
          // For persistent timeout errors on chunks, try even smaller sub-chunks
          if (error.code === '57014' && chunk.length > 50) {
            console.log(`⚠️ Chunk timeout even after retries, trying smaller sub-chunks...`);
            await this.storeVideoDataSubChunks(chunk, 50);
            successCount += chunk.length;
            failureCount -= chunk.length;
          } else {
            throw new Error(`Chunk ${chunkNumber} failed: ${error.message}`);
          }
        } else {
          successCount += chunk.length;
          console.log(`✅ Chunk ${chunkNumber}/${totalChunks} complete (${chunk.length} videos)`);
        }
        
        // Add small delay between chunks to avoid overwhelming the database
        if (i + chunkSize < videos.length) {
          await new Promise(resolve => setTimeout(resolve, 100));
        }
        
      } catch (error) {
        console.error(`❌ Chunk ${chunkNumber} error:`, error);
        failureCount += chunk.length;
        
        // Continue with remaining chunks instead of failing entirely
        console.log(`⚠️ Continuing with remaining chunks...`);
      }
    }
    
    console.log(`✅ Chunked storage complete: ${successCount} successful, ${failureCount} failed`);
    
    if (failureCount > 0) {
      throw new Error(`Failed to store ${failureCount} videos out of ${videos.length}`);
    }
  }

  /**
   * Store video data in very small sub-chunks for timeout recovery
   */
  private async storeVideoDataSubChunks(videos: VideoMetadata[], subChunkSize: number): Promise<void> {
    console.log(`📦 Processing ${videos.length} videos in sub-chunks of ${subChunkSize}...`);
    
    for (let i = 0; i < videos.length; i += subChunkSize) {
      const subChunk = videos.slice(i, i + subChunkSize);
      const subChunkNum = Math.floor(i / subChunkSize) + 1;
      const totalSubChunks = Math.ceil(videos.length / subChunkSize);
      
      try {
        const { error } = await retrySupabaseOperation(
          async () => {
            const result = await supabase
              .from('videos')
              .upsert(subChunk, {
                onConflict: 'id',
                ignoreDuplicates: false
              });
            
            if (result.error) {
              // Check if it's a retryable error
              if (result.error.code === '57014' || 
                  result.error.message?.includes('fetch failed') ||
                  result.error.message?.includes('ETIMEDOUT')) {
                throw result.error; // This will trigger retry
              }
              // Non-retryable errors should be returned
              return result;
            }
            return result;
          },
          `store sub-chunk ${subChunkNum}/${totalSubChunks}`
        );

        if (error) {
          throw new Error(`Sub-chunk failed after retries: ${error.message}`);
        }
        
        // Small delay between sub-chunks
        await new Promise(resolve => setTimeout(resolve, 50));
        
      } catch (error) {
        console.error(`❌ Sub-chunk starting at index ${i} failed after all retries:`, error);
        throw error;
      }
    }
  }


  /**
   * Export embeddings to local files
   */
  async exportEmbeddings(videos: VideoMetadata[], embeddings: EmbeddingResults): Promise<string[]> {
    console.log(`📁 Exporting embeddings for ${videos.length} videos`);
    
    const exportFiles: string[] = [];
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const exportDir = path.join(process.cwd(), 'exports');
    
    // Ensure exports directory exists
    if (!fs.existsSync(exportDir)) {
      fs.mkdirSync(exportDir, { recursive: true });
    }

    // Export title embeddings
    if (embeddings.titleEmbeddings.length > 0) {
      const titleExportData = {
        export_info: {
          timestamp,
          total_vectors: embeddings.titleEmbeddings.filter(e => e.success).length,
          dimension: 512,
          index_name: 'youtube-titles-prod',
          batches_processed: 1,
          type: 'title_embeddings'
        },
        vectors: embeddings.titleEmbeddings
          .filter(e => e.success)
          .map(e => {
            const video = videos.find(v => v.id === e.videoId);
            return {
              id: e.videoId,
              values: e.embedding,
              metadata: {
                title: video?.title || '',
                channel_id: video?.channel_id || '',
                channel_name: video?.channel_name || '',
                view_count: video?.view_count || 0,
                published_at: video?.published_at || '',
                performance_ratio: video?.performance_ratio || 0,
                embedding_version: 'v1'
              }
            };
          })
      };
      
      const titleJsonPath = path.join(exportDir, `title-embeddings-${timestamp}.json`);
      const titleMetadataPath = path.join(exportDir, `title-embeddings-metadata-only-${timestamp}.json`);
      
      fs.writeFileSync(titleJsonPath, JSON.stringify(titleExportData, null, 2));
      fs.writeFileSync(titleMetadataPath, JSON.stringify({
        export_info: titleExportData.export_info,
        metadata: titleExportData.vectors.map(v => ({
          id: v.id,
          metadata: v.metadata
        }))
      }, null, 2));
      
      exportFiles.push(titleJsonPath, titleMetadataPath);
    }

    // Export thumbnail embeddings
    if (embeddings.thumbnailEmbeddings.length > 0) {
      const thumbnailVideoData = videos
        .filter(v => embeddings.thumbnailEmbeddings.some(e => e.videoId === v.id && e.success))
        .map(v => ({
          id: v.id,
          title: v.title,
          thumbnail_url: v.thumbnail_url,
          channel_id: v.channel_id,
          channel_name: v.channel_name,
          view_count: v.view_count,
          published_at: v.published_at,
          performance_ratio: v.performance_ratio
        }));
      
      const thumbnailEmbeddingValues = embeddings.thumbnailEmbeddings
        .filter(e => e.success)
        .map(e => e.embedding);
      
      if (thumbnailVideoData.length > 0) {
        const { jsonPath, csvPath, metadataPath } = await exportThumbnailEmbeddings(
          thumbnailVideoData,
          thumbnailEmbeddingValues
        );
        exportFiles.push(jsonPath, csvPath, metadataPath);
      }
    }

    console.log(`✅ Exported ${exportFiles.length} files`);
    return exportFiles;
  }

  /**
   * Upload embeddings to Pinecone vector databases
   */
  async uploadToPinecone(embeddings: EmbeddingResults): Promise<void> {
    console.log(`🚀 Uploading embeddings to Pinecone`);
    
    // Upload title embeddings (512D to main index)
    const successfulTitleEmbeddings = embeddings.titleEmbeddings.filter(e => e.success);
    if (successfulTitleEmbeddings.length > 0) {
      const titleVectors = successfulTitleEmbeddings.map(e => ({
        id: e.videoId,
        values: e.embedding,
        metadata: {
          embedding_version: 'v1'
        }
      }));
      
      await retryPineconeOperation(
        async () => await pineconeService.upsertEmbeddings(titleVectors as any),
        `upload ${titleVectors.length} title embeddings`
      );
      console.log(`✅ Uploaded ${titleVectors.length} title embeddings to Pinecone`);
    }

    // Upload thumbnail embeddings (768D to thumbnail index)
    const successfulThumbnailEmbeddings = embeddings.thumbnailEmbeddings.filter(e => e.success);
    if (successfulThumbnailEmbeddings.length > 0) {
      const thumbnailVectors = successfulThumbnailEmbeddings.map(e => ({
        id: e.videoId,
        values: e.embedding,
        metadata: {
          embedding_version: 'clip-vit-large-patch14'
        }
      }));
      
      await pineconeThumbnailService.upsertThumbnailEmbeddings(thumbnailVectors as any);
      console.log(`✅ Uploaded ${thumbnailVectors.length} thumbnail embeddings to Pinecone`);
    }
  }

  /**
   * Upload summary embeddings to Pinecone llm-summaries namespace
   */
  async uploadSummaryEmbeddingsToPinecone(
    summaryEmbeddings: Array<{ videoId: string; embedding: number[]; success: boolean; error?: string }>
  ): Promise<void> {
    console.log(`🚀 Uploading summary embeddings to Pinecone`);
    
    const successfulEmbeddings = summaryEmbeddings.filter(e => e.success && e.embedding.length > 0);
    if (successfulEmbeddings.length === 0) {
      console.log('⚠️ No successful summary embeddings to upload');
      return;
    }
    
    // Extract video IDs before try block so it's available for the update
    const videoIds = successfulEmbeddings.map(e => e.videoId);

    try {
      // Get video metadata for the embeddings
      const { data: videos } = await supabase
        .from('videos')
        .select('id, title, channel_name, llm_summary, view_count')
        .in('id', videoIds);
      
      if (!videos || videos.length === 0) {
        console.error('❌ Failed to fetch video metadata for embeddings');
        return;
      }
      
      // Create vectors with metadata
      const vectors = successfulEmbeddings.map(embedding => {
        const video = videos.find(v => v.id === embedding.videoId);
        return {
          id: embedding.videoId,
          values: embedding.embedding,
          metadata: {
            title: video?.title || '',
            channel_name: video?.channel_name || '',
            summary: video?.llm_summary?.substring(0, 200) || '',
            view_count: video?.view_count || 0,
            embedding_version: 'v1'
          }
        };
      });
      
      // Use the same Pinecone index as titles but with llm-summaries namespace
      const pinecone = new Pinecone({
        apiKey: process.env.PINECONE_API_KEY!,
      });
      const index = pinecone.index(process.env.PINECONE_INDEX_NAME!);
      const namespace = index.namespace('llm-summaries');
      const batchSize = 100;
      
      // Upload to Pinecone in batches with retry
      for (let i = 0; i < vectors.length; i += batchSize) {
        const batch = vectors.slice(i, i + batchSize);
        const batchNum = Math.floor(i / batchSize) + 1;
        const totalBatches = Math.ceil(vectors.length / batchSize);
        
        await retryPineconeOperation(
          async () => await namespace.upsert(batch),
          `upload summary batch ${batchNum}/${totalBatches}`
        );
        console.log(`📦 Uploaded batch ${batchNum}/${totalBatches}`);
      }
      
      // Update database to mark embeddings as synced
      const { error } = await supabase
        .from('videos')
        .update({ llm_summary_embedding_synced: true })
        .in('id', videoIds);
      
      if (error) {
        console.error('❌ Failed to update sync status:', error);
      } else {
        console.log(`✅ Uploaded ${vectors.length} summary embeddings to Pinecone (llm-summaries namespace) and updated sync status`);
      }
      
    } catch (error) {
      console.error('❌ Error uploading summary embeddings to Pinecone:', error);
      // Don't throw - we don't want to fail the entire import
    }
  }

  /**
   * OPTIMIZED: Fetch videos from channels using search API
   * More efficient than playlist API for large channels
   */
  private async fetchVideosFromChannels(
    channelIds: string[], 
    options?: {
      maxVideosPerChannel?: number;
      timePeriod?: string;
      excludeShorts?: boolean;
      dateFilter?: 'all' | 'recent';
      dateRange?: number;
    }
  ): Promise<string[]> {
    console.log(`🚀 Starting optimized channel video fetch for ${channelIds.length} channels`);
    
    const allVideoIds: string[] = [];
    
    // Calculate date filter - prioritize new dateFilter over legacy timePeriod
    let publishedAfter: Date | null = null;
    
    if (options?.dateFilter === 'recent') {
      // Use new dateFilter approach
      const daysToLookBack = options.dateRange || 1095; // Default to 3 years (1095 days)
      publishedAfter = new Date(Date.now() - daysToLookBack * 24 * 60 * 60 * 1000);
      console.log(`📅 Filtering to videos from last ${daysToLookBack} days (after ${publishedAfter.toISOString().split('T')[0]})`);
    } else if (options?.timePeriod && options.timePeriod !== 'all') {
      // Legacy timePeriod support
      const daysAgo = parseInt(options.timePeriod) || 3650;
      publishedAfter = new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000);
      console.log(`📅 Legacy filter: videos from last ${daysAgo} days`);
    }
    
    // Process channels in parallel (but limit concurrency to avoid rate limits)
    const concurrencyLimit = 3;
    const channelPromises = [];
    
    for (let i = 0; i < channelIds.length; i += concurrencyLimit) {
      const channelBatch = channelIds.slice(i, i + concurrencyLimit);
      
      const batchPromise = Promise.all(
        channelBatch.map(channelId => 
          this.fetchChannelVideosOptimized(channelId, options, publishedAfter)
        )
      );
      
      channelPromises.push(batchPromise);
    }
    
    // Wait for all batches
    const results = await Promise.all(channelPromises);
    
    // Flatten results
    for (const batchResults of results) {
      for (const channelVideoIds of batchResults) {
        allVideoIds.push(...channelVideoIds);
      }
    }
    
    console.log(`✅ Retrieved ${allVideoIds.length} total videos from ${channelIds.length} channels`);
    return allVideoIds;
  }

  /**
   * OPTIMIZED: Fetch videos from a single channel
   * Uses playlist API for lower quota cost (1 unit vs 100 units per call)
   */
  private async fetchChannelVideosOptimized(
    channelId: string,
    options?: {
      maxVideosPerChannel?: number;
      timePeriod?: string;
      excludeShorts?: boolean;
      dateFilter?: 'all' | 'recent';
      dateRange?: number;
    },
    publishedAfter?: Date | null
  ): Promise<string[]> {
    const videoIds: string[] = [];
    let nextPageToken: string | undefined;
    const pageSize = 50;
    const maxResults = options?.maxVideosPerChannel || 500; // Default limit
    const minVideosTarget = 50; // Fallback target if date filtering yields too few videos
    
    console.log(`📺 Fetching videos from channel ${channelId}`);
    
    try {
      // First, get the channel's uploads playlist ID
      const channelUrl = `https://www.googleapis.com/youtube/v3/channels?` +
        `part=contentDetails&` +
        `id=${channelId}`;
      
      const channelResponse = await this.makeYouTubeRequest(channelUrl);
      
      // Track quota usage
      await quotaTracker.trackAPICall('channels.list', {
        description: `Get uploads playlist for channel ${channelId}`,
        jobId: this.jobId,
        count: 1
      });
      
      if (!channelResponse.ok) {
        console.error(`❌ Channel API error for ${channelId}: ${channelResponse.status}`);
        return videoIds;
      }
      
      const channelData = await channelResponse.json();
      const uploadsPlaylistId = channelData.items?.[0]?.contentDetails?.relatedPlaylists?.uploads;
      
      if (!uploadsPlaylistId) {
        console.error(`❌ No uploads playlist found for channel ${channelId}`);
        return videoIds;
      }
      
      // Use playlistItems API to fetch videos (1 unit per call instead of 100)
      do {
        let playlistUrl = `https://www.googleapis.com/youtube/v3/playlistItems?` +
          `part=snippet&` +
          `playlistId=${uploadsPlaylistId}&` +
          `maxResults=${pageSize}`;
        
        if (nextPageToken) {
          playlistUrl += `&pageToken=${nextPageToken}`;
        }
        
        const response = await this.makeYouTubeRequest(playlistUrl);
        
        // Track quota usage
        await quotaTracker.trackAPICall('playlistItems.list', {
          description: `Fetch videos from channel ${channelId}`,
          jobId: this.jobId,
          count: 1
        });
        
        if (!response.ok) {
          console.error(`❌ Playlist API error for channel ${channelId}: ${response.status}`);
          break;
        }
        
        const data = await response.json();
        
        if (data.items && data.items.length > 0) {
          // Filter by publishedAfter if specified
          const filteredItems = publishedAfter 
            ? data.items.filter((item: any) => 
                new Date(item.snippet.publishedAt) > publishedAfter
              )
            : data.items;
          
          const batchVideoIds = filteredItems.map((item: any) => item.snippet.resourceId.videoId);
          
          // If excluding shorts, batch check durations
          if (options?.excludeShorts && batchVideoIds.length > 0) {
            const nonShortIds = await this.filterOutShorts(batchVideoIds);
            videoIds.push(...nonShortIds);
          } else {
            videoIds.push(...batchVideoIds);
          }
          
          if (videoIds.length >= maxResults) {
            // Trim to exact limit
            videoIds.splice(maxResults);
            break;
          }
          
          // If we filtered by date and got fewer items than page size, we're done
          if (publishedAfter && filteredItems.length < data.items.length) {
            break;
          }
          
          nextPageToken = data.nextPageToken;
        } else {
          break;
        }
      } while (nextPageToken && videoIds.length < maxResults);
      
    } catch (error) {
      console.error(`❌ Error fetching videos from channel ${channelId}:`, error);
    }
    
    // Fallback logic: if we have date filtering and got less than 50 videos, try without date filter
    if (publishedAfter && videoIds.length < minVideosTarget && videoIds.length > 0) {
      console.log(`⚠️ Channel ${channelId}: Only found ${videoIds.length} videos in date range. Fetching older videos to reach ${minVideosTarget} minimum...`);
      
      try {
        // Reset and fetch without date filter to get at least 50 total videos
        const additionalVideoIds: string[] = [];
        let fallbackNextPageToken: string | undefined;
        
        // Get channel uploads playlist ID (we should have it cached from above)
        const channelResponse = await this.makeYouTubeRequest(
          `https://www.googleapis.com/youtube/v3/channels?` +
          `part=contentDetails&` +
          `id=${channelId}`
        );
        
        if (channelResponse.ok) {
          const channelData = await channelResponse.json();
          const uploadsPlaylistId = channelData.items?.[0]?.contentDetails?.relatedPlaylists?.uploads;
          
          if (uploadsPlaylistId) {
            // Fetch without date filter until we have at least 50 total
            const targetTotal = Math.max(minVideosTarget, videoIds.length);
            
            do {
              const playlistUrl = `https://www.googleapis.com/youtube/v3/playlistItems?` +
                `part=snippet&` +
                `playlistId=${uploadsPlaylistId}&` +
                `maxResults=${pageSize}` +
                (fallbackNextPageToken ? `&pageToken=${fallbackNextPageToken}` : '');

              const response = await this.makeYouTubeRequest(playlistUrl);
              
              if (!response.ok) break;
              
              const data = await response.json();
              
              if (data.items && data.items.length > 0) {
                // Don't re-add videos we already have
                const existingVideoIds = new Set(videoIds);
                const newVideoIds = data.items
                  .map((item: any) => item.snippet.resourceId.videoId)
                  .filter((id: string) => !existingVideoIds.has(id));
                
                // Filter shorts if requested
                if (options?.excludeShorts && newVideoIds.length > 0) {
                  const nonShortIds = await this.filterOutShorts(newVideoIds);
                  additionalVideoIds.push(...nonShortIds);
                } else {
                  additionalVideoIds.push(...newVideoIds);
                }
                
                const totalVideos = videoIds.length + additionalVideoIds.length;
                if (totalVideos >= targetTotal) {
                  // Trim to exact target
                  const needed = targetTotal - videoIds.length;
                  additionalVideoIds.splice(needed);
                  break;
                }
                
                fallbackNextPageToken = data.nextPageToken;
              } else {
                break;
              }
            } while (fallbackNextPageToken && (videoIds.length + additionalVideoIds.length) < targetTotal);
            
            videoIds.push(...additionalVideoIds);
            console.log(`✅ Fallback: Added ${additionalVideoIds.length} older videos. Total: ${videoIds.length} videos`);
          }
        }
      } catch (fallbackError) {
        console.error(`❌ Fallback fetch failed for channel ${channelId}:`, fallbackError);
      }
    }
    
    console.log(`✅ Retrieved ${videoIds.length} videos from channel ${channelId}`);
    return videoIds;
  }

  /**
   * Helper: Filter out YouTube Shorts from video IDs
   */
  private async filterOutShorts(videoIds: string[]): Promise<string[]> {
    if (videoIds.length === 0) return [];
    
    try {
      const response = await this.makeYouTubeRequest(
        `https://www.googleapis.com/youtube/v3/videos?` +
        `part=contentDetails&` +
        `id=${videoIds.join(',')}`
      );
      
      // Track quota usage
      await quotaTracker.trackAPICall('videos.list', {
        description: `Filter shorts from ${videoIds.length} videos`,
        jobId: this.jobId,
        count: 1
      });
      
      if (!response.ok) return videoIds; // Return all if API fails
      
      const data = await response.json();
      
      return data.items
        ?.filter((video: any) => {
          const duration = video.contentDetails?.duration || '';
          const match = duration.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
          if (!match) return true;
          
          const hours = parseInt(match[1] || '0');
          const minutes = parseInt(match[2] || '0');
          const seconds = parseInt(match[3] || '0');
          const totalSeconds = hours * 3600 + minutes * 60 + seconds;
          
          return totalSeconds >= 60; // Keep videos 60 seconds or longer
        })
        .map((video: any) => video.id) || [];
        
    } catch (error) {
      console.error('Error filtering shorts:', error);
      return videoIds; // Return all on error
    }
  }

  /**
   * Helper: Fetch videos from RSS feeds (OPTIMIZED)
   * Processes all RSS feeds in parallel and deduplicates before YouTube API calls
   */
  private async fetchVideosFromRSS(rssFeedUrls: string[]): Promise<string[]> {
    console.log(`🚀 Starting optimized RSS processing for ${rssFeedUrls.length} feeds`);
    const startTime = Date.now();
    
    // Parallel RSS feed processing
    const rssPromises = rssFeedUrls.map(async (feedUrl, index) => {
      try {
        // Support both direct RSS URLs and channel IDs
        let actualFeedUrl = feedUrl;
        if (feedUrl.startsWith('UC') && feedUrl.length === 24) {
          actualFeedUrl = `https://www.youtube.com/feeds/videos.xml?channel_id=${feedUrl}`;
        }
        
        const response = await fetch(actualFeedUrl, {
          headers: {
            'User-Agent': 'Unified-Video-Import/1.0'
          }
        });

        if (!response.ok) {
          console.error(`❌ Feed ${index + 1}/${rssFeedUrls.length} failed: ${response.status}`);
          return [];
        }

        const xmlText = await response.text();
        
        // Parse entries with both video IDs and published dates
        const entryPattern = /<entry>(.*?)<\/entry>/gs;
        const entries = xmlText.match(entryPattern) || [];
        
        const recentVideoIds: string[] = [];
        const cutoffDate = new Date();
        cutoffDate.setDate(cutoffDate.getDate() - 7); // Only videos from last 7 days
        
        for (const entry of entries) {
          // Extract video ID
          const videoIdMatch = entry.match(/<yt:videoId>([\w-]+)<\/yt:videoId>/);
          if (!videoIdMatch) continue;
          
          const videoId = videoIdMatch[1];
          
          // Extract published date
          const publishedMatch = entry.match(/<published>([^<]+)<\/published>/);
          if (!publishedMatch) continue;
          
          const publishedDate = new Date(publishedMatch[1]);
          
          // Only include videos from last 7 days
          if (publishedDate >= cutoffDate) {
            recentVideoIds.push(videoId);
          }
        }
        
        console.log(`✅ Feed ${index + 1}/${rssFeedUrls.length}: ${recentVideoIds.length} recent videos (last 7 days)`);
        return recentVideoIds;
      } catch (error) {
        console.error(`❌ Feed ${index + 1}/${rssFeedUrls.length} error:`, error instanceof Error ? error.message : String(error));
        return [];
      }
    });

    // Wait for all RSS feeds to complete
    const allResults = await Promise.all(rssPromises);
    const allVideoIds = allResults.flat();
    
    // Deduplicate video IDs
    const uniqueVideoIds = Array.from(new Set(allVideoIds));
    const rssTime = Date.now() - startTime;
    
    console.log(`📊 RSS Discovery Complete:`);
    console.log(`   • Feeds processed: ${rssFeedUrls.length}`);
    console.log(`   • Total videos found: ${allVideoIds.length}`);
    console.log(`   • Unique videos: ${uniqueVideoIds.length}`);
    console.log(`   • Duplicates removed: ${allVideoIds.length - uniqueVideoIds.length}`);
    console.log(`   • Processing time: ${rssTime}ms`);
    
    // Filter out videos that already exist in database
    if (uniqueVideoIds.length > 0) {
      console.log(`🔍 Checking for existing videos in database...`);
      
      // Process in batches to avoid PostgreSQL query size limits
      const batchSize = 1000;
      const existingIds = new Set<string>();
      
      for (let i = 0; i < uniqueVideoIds.length; i += batchSize) {
        const batch = uniqueVideoIds.slice(i, i + batchSize);
        const { data: existingVideos, error } = await supabase
          .from('videos')
          .select('id')
          .in('id', batch);
        
        if (error) {
          console.error(`❌ Database filter error for batch ${i / batchSize + 1}:`, error);
          console.error(`   Query: SELECT id FROM videos WHERE id IN (${batch.slice(0, 3).join(', ')}...)`);
          continue;
        }
        
        existingVideos?.forEach(v => existingIds.add(v.id));
        console.log(`✅ Batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(uniqueVideoIds.length / batchSize)}: ${existingVideos?.length || 0} existing found`);
      }
      
      const newVideoIds = uniqueVideoIds.filter(id => !existingIds.has(id));
      
      console.log(`📊 Database Filter Results:`);
      console.log(`   • Videos already in DB: ${existingIds.size}`);
      console.log(`   • New videos to process: ${newVideoIds.length}`);
      console.log(`   • Filter efficiency: ${((existingIds.size / uniqueVideoIds.length) * 100).toFixed(1)}% already existed`);
      
      return newVideoIds;
    }
    
    return uniqueVideoIds;
  }

  /**
   * OPTIMIZED: Fetch video details with batched channel statistics
   * Reduces API calls from O(n*2) to O(n/50 + m/50) where n=videos, m=unique channels
   */
  private async fetchVideoDetailsBatch(videoIds: string[], source: string, _userId?: string): Promise<VideoMetadata[]> {
    console.log(`🚀 Starting optimized video metadata fetch for ${videoIds.length} videos`);
    
    // Step 1: Fetch all video details in batches
    const videoDetailsMap = new Map<string, any>();
    const channelIds = new Set<string>();
    
    const videoBatchSize = 50; // YouTube API limit
    for (let i = 0; i < videoIds.length; i += videoBatchSize) {
      const batch = videoIds.slice(i, i + videoBatchSize);
      const videoIdsParam = batch.join(',');
      
      try {
        console.log(`📹 Fetching video batch ${Math.floor(i/videoBatchSize) + 1}/${Math.ceil(videoIds.length/videoBatchSize)}`);
        
        const response = await this.makeYouTubeRequest(
          `https://www.googleapis.com/youtube/v3/videos?` +
          `part=snippet,statistics,contentDetails&` +
          `id=${videoIdsParam}`
        );
        
        // Track quota usage
        await quotaTracker.trackAPICall('videos.list', {
          description: `Fetch video details for ${batch.length} videos`,
          jobId: this.jobId,
          count: 1
        });
        
        if (response.ok) {
          const data = await response.json();
          
          for (const video of data.items || []) {
            videoDetailsMap.set(video.id, video);
            channelIds.add(video.snippet.channelId);
          }
        }
      } catch (error) {
        console.error(`❌ Failed to fetch video batch:`, error);
      }
    }
    
    console.log(`✅ Fetched ${videoDetailsMap.size} videos from ${channelIds.size} unique channels`);
    
    // Step 2: Fetch all unique channel statistics in batches
    const channelStatsMap = await this.fetchChannelStatsBatch(Array.from(channelIds));
    
    // Step 3: Combine video and channel data
    const videos: VideoMetadata[] = [];
    
    for (const [videoId, video] of Array.from(videoDetailsMap.entries())) {
      const snippet = video.snippet;
      const statistics = video.statistics;
      const channelData = channelStatsMap.get(snippet.channelId);
      
      const metadata: Record<string, any> = {
        channel_name: snippet.channelTitle,
        channel_title: channelData?.title || snippet.channelTitle,
        youtube_channel_id: snippet.channelId,
        channel_handle: channelData?.handle || null,
        duration: video.contentDetails?.duration || null,
        tags: snippet.tags || [],
        category_id: snippet.categoryId || null,
        live_broadcast_content: snippet.liveBroadcastContent || null,
        default_language: snippet.defaultLanguage || null,
        default_audio_language: snippet.defaultAudioLanguage || null,
        // Add channel statistics
        channel_stats: channelData?.stats || null
      };
      
      videos.push({
        id: videoId,
        title: snippet.title,
        channel_id: snippet.channelId,
        channel_name: snippet.channelTitle,
        view_count: parseInt(statistics.viewCount || '0'),
        published_at: snippet.publishedAt,
        performance_ratio: 1, // Database calculates this
        thumbnail_url: snippet.thumbnails?.maxresdefault?.url || 
                      snippet.thumbnails?.high?.url || 
                      snippet.thumbnails?.medium?.url || 
                      snippet.thumbnails?.default?.url || '',
        description: snippet.description || '',
        duration: video.contentDetails?.duration || null, // Extract duration to dedicated column
        data_source: source === 'owner' ? 'owner' : 'competitor',
        is_competitor: source !== 'owner',
        import_date: new Date().toISOString(),
        metadata: metadata,
        user_id: _userId || '00000000-0000-0000-0000-000000000000',
      });
    }
    
    console.log(`📊 Processed ${videos.length} videos with complete metadata`);
    return videos;
  }

  /**
   * OPTIMIZED: Batch fetch channel statistics
   * Fetches up to 50 channels per API call
   */
  private async fetchChannelStatsBatch(channelIds: string[]): Promise<Map<string, any>> {
    console.log(`📺 Fetching statistics for ${channelIds.length} unique channels`);
    const channelStatsMap = new Map();
    
    // Remove duplicates
    const uniqueChannelIds = Array.from(new Set(channelIds));
    
    // Check cache first and separate cached vs uncached channels
    const uncachedChannelIds: string[] = [];
    for (const channelId of uniqueChannelIds) {
      if (this.channelStatsCache.has(channelId)) {
        const cachedData = this.channelStatsCache.get(channelId);
        channelStatsMap.set(channelId, cachedData);
      } else {
        uncachedChannelIds.push(channelId);
      }
    }
    
    if (uncachedChannelIds.length === 0) {
      console.log(`✅ All ${uniqueChannelIds.length} channels found in cache`);
      return channelStatsMap;
    }
    
    console.log(`📊 ${channelStatsMap.size} channels from cache, fetching ${uncachedChannelIds.length} from API`);
    
    // YouTube API allows up to 50 channel IDs per request
    const batchSize = 50;
    
    for (let i = 0; i < uncachedChannelIds.length; i += batchSize) {
      const batch = uncachedChannelIds.slice(i, i + batchSize);
      const channelIdsParam = batch.join(',');
      
      try {
        console.log(`📊 Fetching channel batch ${Math.floor(i/batchSize) + 1}/${Math.ceil(uniqueChannelIds.length/batchSize)}`);
        
        const response = await this.makeYouTubeRequest(
          `https://www.googleapis.com/youtube/v3/channels?` +
          `part=snippet,statistics&` +
          `id=${channelIdsParam}`
        );
        
        // Track quota usage
        await quotaTracker.trackAPICall('channels.list', {
          description: `Fetch channel stats for ${batch.length} channels`,
          jobId: this.jobId,
          count: 1
        });
        
        if (response.ok) {
          const data = await response.json();
          
          for (const channel of data.items || []) {
            const channelStats = {
              subscriber_count: channel.statistics?.subscriberCount || '0',
              view_count: channel.statistics?.viewCount || '0',
              video_count: channel.statistics?.videoCount || '0',
              channel_thumbnail: channel.snippet?.thumbnails?.high?.url || 
                               channel.snippet?.thumbnails?.default?.url || null,
            };
            
            const channelData = {
              stats: channelStats,
              handle: channel.snippet?.customUrl || null,
              title: channel.snippet?.title || null
            };
            
            channelStatsMap.set(channel.id, channelData);
            // Add to cache for future requests
            this.channelStatsCache.set(channel.id, channelData);
          }
        }
      } catch (error) {
        console.error(`❌ Failed to fetch channel stats for batch:`, error);
      }
    }
    
    console.log(`✅ Retrieved stats for ${channelStatsMap.size} channels`);
    return channelStatsMap;
  }

  /**
   * Classify videos based on their embeddings
   */
  private async classifyVideos(
    videos: VideoMetadata[],
    embeddingResults: EmbeddingResults,
    summaryEmbeddingResults: Array<{ videoId: string; embedding: number[]; success: boolean; error?: string }>
  ): Promise<number> {
    console.log(`🏷️ Starting classification for ${videos.length} videos...`);
    
    try {
      let classifiedCount = 0;
      
      // Step 1: Format Classification using LLM service
      console.log(`📝 Classifying video formats...`);
      const videosForFormatClassification = videos.map(v => ({
        id: v.id,
        title: v.title,
        channel: v.channel_name,
        description: v.description
      }));
      
      const formatResult = await llmFormatClassificationService.classifyBatch(videosForFormatClassification);
      if (formatResult.classifications.length > 0) {
        await llmFormatClassificationService.storeClassifications(formatResult.classifications);
        console.log(`✅ Format classification complete: ${formatResult.classifications.length} videos, ${formatResult.totalTokens.toLocaleString()} tokens used`);
        classifiedCount = formatResult.classifications.length;
      }
      
      // Step 2: Topic Classification using BERTopic model from August 1st
      console.log(`🎯 Classifying video topics using BERTopic model...`);
      
      // Initialize BERTopic service
      await this.bertopicService.initialize();
      
      // Process videos that have successful embeddings
      // Use blended embeddings when both title and summary are available
      console.log(`🎯 Using blended embeddings (30% title + 70% summary) for BERTopic classification`);
      const videosWithEmbeddings = videos
        .map(video => {
          const titleEmbedding = embeddingResults.titleEmbeddings.find(e => e.videoId === video.id);
          const summaryEmbedding = summaryEmbeddingResults.find(e => e.videoId === video.id);
          
          // Skip if no title embedding (minimum requirement)
          if (!titleEmbedding || !titleEmbedding.success || !titleEmbedding.embedding.length) {
            return null;
          }
          
          // Prepare classification input with support for blended embeddings
          const classificationInput: any = {
            id: video.id
          };
          
          if (summaryEmbedding && summaryEmbedding.success && summaryEmbedding.embedding.length) {
            // Use blended embeddings when both are available
            classificationInput.titleEmbedding = titleEmbedding.embedding;
            classificationInput.summaryEmbedding = summaryEmbedding.embedding;
            classificationInput.blendWeights = { title: 0.3, summary: 0.7 };
          } else {
            // Fall back to title-only
            classificationInput.embedding = titleEmbedding.embedding;
          }
          
          return classificationInput;
        })
        .filter(v => v !== null);
      
      if (videosWithEmbeddings.length > 0) {
        // Process in batches to avoid memory issues
        const topicBatchSize = 100;
        let topicUpdateCount = 0;
        
        for (let i = 0; i < videosWithEmbeddings.length; i += topicBatchSize) {
          const batch = videosWithEmbeddings.slice(i, i + topicBatchSize);
          
          // Classify topics for batch using new BERTopic service
          const topicAssignments = await this.bertopicService.classifyVideos(batch);
          
          // Store topic assignments in database
          for (const { id, assignment } of topicAssignments) {
            const { error } = await supabase
              .from('videos')
              .update({
                topic_cluster_id: assignment.clusterId,
                topic_domain: assignment.domain,
                topic_niche: assignment.niche,
                topic_micro: assignment.microTopic,
                topic_confidence: assignment.confidence,
                bertopic_version: 'v1_2025-08-01',
                classified_at: new Date().toISOString()
              })
              .eq('id', id);
            
            if (!error) {
              topicUpdateCount++;
            } else {
              console.error(`❌ Failed to update topic for video ${id}:`, error.message);
            }
          }
          
          console.log(`   📊 Topic batch ${Math.floor(i / topicBatchSize) + 1}/${Math.ceil(videosWithEmbeddings.length / topicBatchSize)}: ${topicUpdateCount} videos updated`);
        }
        
        console.log(`✅ Topic classification complete: ${topicUpdateCount} videos classified with BERTopic v1_2025-08-01`);
      }
      
      return classifiedCount;
    } catch (error) {
      console.error('❌ Classification failed:', error);
      // Don't fail the entire import if classification fails
      return 0;
    }
    
    /* Original commented code kept for reference
    console.log(`🏷️ [classifyVideos] Starting video classification for ${videos.length} videos`);
    console.log(`🏷️ [classifyVideos] Embedding results: ${embeddingResults.titleEmbeddings.length} title embeddings`);
    
    try {
      // Load BERTopic clusters if not already loaded
      console.log(`🏷️ [classifyVideos] Loading BERTopic clusters...`);
      await videoClassificationService.topicService.loadClusters();
      
      // Prepare data for classification
      const videosWithEmbeddings = videos
        .map(video => {
          const embedding = embeddingResults.titleEmbeddings.find(e => e.videoId === video.id);
          if (!embedding || !embedding.success || !embedding.embedding.length) {
            return null;
          }
          
          return {
            id: video.id,
            title: video.title,
            titleEmbedding: embedding.embedding,
            channel: video.channel_name,
            description: video.description
          };
        })
        .filter(v => v !== null) as Array<{
          id: string;
          title: string;
          titleEmbedding: number[];
          channel?: string;
          description?: string;
        }>;
      
      if (videosWithEmbeddings.length === 0) {
        console.log('⚠️ No videos with valid embeddings to classify');
        return 0;
      }
      
      // Classify in batches
      const batchSize = 50;
      const classifications = await videoClassificationService.classifyBatch(
        videosWithEmbeddings,
        { batchSize, logLowConfidence: true }
      );
      
      // Store classifications in database
      await videoClassificationService.storeClassifications(classifications);
      
      // Log statistics
      const stats = videoClassificationService.getStatistics();
      console.log(`✅ Classified ${classifications.length} videos`);
      console.log(`   • LLM calls: ${stats.llmCallCount}`);
      console.log(`   • Low confidence cases: ${stats.lowConfidenceCount}`);
      console.log(`   • Average confidence - Topic: ${stats.averageConfidence.topic.toFixed(2)}, Format: ${stats.averageConfidence.format.toFixed(2)}`);
      
      // Export low confidence cases for analysis
      if (stats.lowConfidenceCount > 0) {
        const lowConfidenceCases = videoClassificationService.exportLowConfidenceCases();
        const exportPath = path.join(process.cwd(), 'exports', `low-confidence-classifications-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
        fs.writeFileSync(exportPath, JSON.stringify(lowConfidenceCases, null, 2));
        console.log(`📊 Exported ${stats.lowConfidenceCount} low confidence cases to ${exportPath}`);
      }
      
      // Reset statistics for next run
      videoClassificationService.resetStatistics();
      
      return classifications.length;
    } catch (error) {
      console.error('❌ Classification failed:', error);
      return 0;
    }
    */
  }

  /**
   * Helper: Fetch individual video details with channel statistics
   */
  private async _fetchVideoDetails(videoId: string): Promise<Partial<VideoMetadata> | null> {
    try {
      const response = await this.makeYouTubeRequest(
        `https://www.googleapis.com/youtube/v3/videos?part=snippet,statistics,contentDetails&id=${videoId}`
      );
      
      // Track quota usage
      await quotaTracker.trackAPICall('videos.list', {
        description: `Fetch individual video details for ${videoId}`,
        jobId: this.jobId,
        count: 1
      });
      
      if (!response.ok) {
        throw new Error(`YouTube API error: ${response.status}`);
      }
      
      const data = await response.json();
      
      if (!data.items || data.items.length === 0) {
        return null;
      }
      
      const video = data.items[0];
      const snippet = video.snippet;
      const statistics = video.statistics;
      
      // Now fetch channel statistics
      const channelResponse = await this.makeYouTubeRequest(
        `https://www.googleapis.com/youtube/v3/channels?part=snippet,statistics&id=${snippet.channelId}`
      );
      
      // Track quota usage
      await quotaTracker.trackAPICall('channels.list', {
        description: `Fetch channel stats for video ${videoId}`,
        jobId: this.jobId,
        count: 1
      });
      
      let channelStats = null;
      let channelHandle = null;
      let _channelThumbnail = null;
      
      if (channelResponse.ok) {
        const channelData = await channelResponse.json();
        if (channelData.items && channelData.items.length > 0) {
          const channel = channelData.items[0];
          channelStats = {
            subscriber_count: channel.statistics?.subscriberCount || '0',
            view_count: channel.statistics?.viewCount || '0',
            video_count: channel.statistics?.videoCount || '0',
            channel_thumbnail: channel.snippet?.thumbnails?.high?.url || 
                             channel.snippet?.thumbnails?.default?.url || null,
          };
          channelHandle = channel.snippet?.customUrl || null;
          _channelThumbnail = channelStats.channel_thumbnail;
        }
      }
      
      // Calculate performance ratio (views / subscriber count, defaulting to 1.0)
      const viewCount = parseInt(statistics.viewCount || '0');
      const performance_ratio = 1; // Database calculates this via rolling_baseline_views
      
      // Build metadata object with channel stats
      const metadata: Record<string, any> = {
        channel_name: snippet.channelTitle,
        channel_title: snippet.channelTitle,
        youtube_channel_id: snippet.channelId,
        channel_handle: channelHandle,
        duration: video.contentDetails?.duration || null,
        tags: snippet.tags || [],
        category_id: snippet.categoryId || null,
        live_broadcast_content: snippet.liveBroadcastContent || null,
        default_language: snippet.defaultLanguage || null,
        default_audio_language: snippet.defaultAudioLanguage || null,
        // Add channel statistics
        channel_stats: channelStats
      };
      
      return {
        id: videoId,
        title: snippet.title,
        channel_id: snippet.channelId,
        channel_name: snippet.channelTitle,
        view_count: viewCount,
        published_at: snippet.publishedAt,
        performance_ratio,
        thumbnail_url: snippet.thumbnails?.maxresdefault?.url || 
                      snippet.thumbnails?.high?.url || 
                      snippet.thumbnails?.medium?.url || 
                      snippet.thumbnails?.default?.url || '',
        description: snippet.description || '',
        metadata: metadata
      };
    } catch (error) {
      console.error(`❌ Failed to fetch video details for ${videoId}:`, error);
      return null;
    }
  }
}

// Export singleton instance
export const videoImportService = new VideoImportService();