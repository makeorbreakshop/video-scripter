/**
 * Unified Video Import Service
 * Consolidates all video import mechanisms into a single, standardized service
 * Handles metadata extraction, embedding generation, storage, and exports
 */

import { createClient } from '@supabase/supabase-js';
import { batchGenerateTitleEmbeddings } from './title-embeddings.ts';
import { batchGenerateThumbnailEmbeddings, exportThumbnailEmbeddings } from './thumbnail-embeddings.ts';
import { pineconeService } from './pinecone-service.ts';
import { pineconeThumbnailService } from './pinecone-thumbnail-service.ts';
import { quotaTracker } from './youtube-quota-tracker.ts';
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
    batchSize?: number;
    forceReEmbed?: boolean;
    maxVideosPerChannel?: number;
    // Competitor-specific options
    timePeriod?: string; // 'all' or number of days
    excludeShorts?: boolean;
    userId?: string;
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
  // Channel stats cache to avoid redundant API calls
  private channelStatsCache = new Map<string, any>();
  // Job ID for quota tracking
  private jobId?: string;

  constructor() {
    this.openaiApiKey = process.env.OPENAI_API_KEY || '';
    this.youtubeApiKey = process.env.YOUTUBE_API_KEY || '';
    
    if (!this.openaiApiKey) {
      throw new Error('OPENAI_API_KEY environment variable is required');
    }
    if (!this.youtubeApiKey) {
      throw new Error('YOUTUBE_API_KEY environment variable is required');
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
    
    const result: VideoImportResult = {
      success: false,
      message: '',
      videosProcessed: 0,
      embeddingsGenerated: { titles: 0, thumbnails: 0 },
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

      // Step 3: Generate embeddings (if not skipped)
      let embeddingResults: EmbeddingResults | null = null;
      if (!request.options?.skipEmbeddings) {
        embeddingResults = await this.processVideoEmbeddings(videoMetadata, request.options);
        result.embeddingsGenerated.titles = embeddingResults.titleEmbeddings.filter(e => e.success).length;
        result.embeddingsGenerated.thumbnails = embeddingResults.thumbnailEmbeddings.filter(e => e.success).length;
      }

      // Step 4 & 5: Export and Upload in parallel
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

      result.success = true;
      result.message = `Successfully processed ${videoMetadata.length} videos`;
      
      console.log(`\n✅ IMPORT COMPLETE: ${result.videosProcessed} videos processed successfully`);
      if (result.embeddingsGenerated.titles > 0) {
        console.log(`📊 Generated ${result.embeddingsGenerated.titles} title embeddings, ${result.embeddingsGenerated.thumbnails} thumbnail embeddings`);
      }
      if (result.exportFiles.length > 0) {
        console.log(`📁 Exported to: ${result.exportFiles.join(', ')}`);
      }
      
      // Clear cache after successful processing
      this.clearChannelStatsCache();
      
      return result;

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      result.errors.push(errorMessage);
      result.message = `Import failed: ${errorMessage}`;
      console.error('❌ Unified video import failed:', error);
      
      // Clear cache even on error to prevent stale data
      this.clearChannelStatsCache();
      
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
          excludeShorts: request.options?.excludeShorts
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

    return results;
  }

  /**
   * Store video data in Supabase
   */
  async storeVideoData(videos: VideoMetadata[]): Promise<void> {
    console.log(`
💾 Storing ${videos.length} videos in database...`);
    
    const { error } = await supabase
      .from('videos')
      .upsert(videos, {
        onConflict: 'id',
        ignoreDuplicates: false
      });

    if (error) {
      console.error('❌ Failed to store video data:', error);
      throw new Error(`Failed to store video data: ${error.message}`);
    }
    
    console.log(`✅ Database storage complete`);
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
      
      await pineconeService.upsertEmbeddings(titleVectors as any);
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
   * OPTIMIZED: Fetch videos from channels using search API
   * More efficient than playlist API for large channels
   */
  private async fetchVideosFromChannels(
    channelIds: string[], 
    options?: {
      maxVideosPerChannel?: number;
      timePeriod?: string;
      excludeShorts?: boolean;
    }
  ): Promise<string[]> {
    console.log(`🚀 Starting optimized channel video fetch for ${channelIds.length} channels`);
    
    const allVideoIds: string[] = [];
    
    // Calculate date filter
    const isAllTime = !options?.timePeriod || options.timePeriod === 'all';
    const daysAgo = isAllTime ? 0 : parseInt(options.timePeriod) || 3650;
    const publishedAfter = isAllTime ? null : new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000);
    
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
    },
    publishedAfter?: Date | null
  ): Promise<string[]> {
    const videoIds: string[] = [];
    let nextPageToken: string | undefined;
    const pageSize = 50;
    const maxResults = options?.maxVideosPerChannel || 500; // Default limit
    
    console.log(`📺 Fetching videos from channel ${channelId}`);
    
    try {
      // First, get the channel's uploads playlist ID
      const channelUrl = `https://www.googleapis.com/youtube/v3/channels?` +
        `part=contentDetails&` +
        `id=${channelId}&` +
        `key=${this.youtubeApiKey}`;
      
      const channelResponse = await fetch(channelUrl);
      
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
        
        playlistUrl += `&key=${this.youtubeApiKey}`;
        
        const response = await fetch(playlistUrl);
        
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
    
    console.log(`✅ Retrieved ${videoIds.length} videos from channel ${channelId}`);
    return videoIds;
  }

  /**
   * Helper: Filter out YouTube Shorts from video IDs
   */
  private async filterOutShorts(videoIds: string[]): Promise<string[]> {
    if (videoIds.length === 0) return [];
    
    try {
      const response = await fetch(
        `https://www.googleapis.com/youtube/v3/videos?` +
        `part=contentDetails&` +
        `id=${videoIds.join(',')}&` +
        `key=${this.youtubeApiKey}`
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
        console.error(`❌ Feed ${index + 1}/${rssFeedUrls.length} error:`, error.message);
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
  private async fetchVideoDetailsBatch(videoIds: string[], source: string, userId?: string): Promise<VideoMetadata[]> {
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
        
        const response = await fetch(
          `https://www.googleapis.com/youtube/v3/videos?` +
          `part=snippet,statistics,contentDetails&` +
          `id=${videoIdsParam}&` +
          `key=${this.youtubeApiKey}`
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
    
    for (const [videoId, video] of videoDetailsMap) {
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
        data_source: source === 'owner' ? 'owner' : 'competitor',
        is_competitor: source !== 'owner',
        import_date: new Date().toISOString(),
        user_id: userId || '00000000-0000-0000-0000-000000000000',
        metadata: metadata
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
        
        const response = await fetch(
          `https://www.googleapis.com/youtube/v3/channels?` +
          `part=snippet,statistics&` +
          `id=${channelIdsParam}&` +
          `key=${this.youtubeApiKey}`
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
   * Helper: Fetch individual video details with channel statistics
   */
  private async fetchVideoDetails(videoId: string): Promise<Partial<VideoMetadata> | null> {
    try {
      const response = await fetch(
        `https://www.googleapis.com/youtube/v3/videos?part=snippet,statistics,contentDetails&id=${videoId}&key=${this.youtubeApiKey}`
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
      const channelResponse = await fetch(
        `https://www.googleapis.com/youtube/v3/channels?part=snippet,statistics&id=${snippet.channelId}&key=${this.youtubeApiKey}`
      );
      
      // Track quota usage
      await quotaTracker.trackAPICall('channels.list', {
        description: `Fetch channel stats for video ${videoId}`,
        jobId: this.jobId,
        count: 1
      });
      
      let channelStats = null;
      let channelHandle = null;
      let channelThumbnail = null;
      
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
          channelThumbnail = channelStats.channel_thumbnail;
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