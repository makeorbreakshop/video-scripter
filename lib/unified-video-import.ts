/**
 * Unified Video Import Service
 * Consolidates all video import mechanisms into a single, standardized service
 * Handles metadata extraction, embedding generation, storage, and exports
 */

import { createClient } from '@supabase/supabase-js';
import { generateTitleEmbedding, batchGenerateTitleEmbeddings } from './title-embeddings';
import { generateThumbnailEmbedding, batchGenerateThumbnailEmbeddings, exportThumbnailEmbeddings } from './thumbnail-embeddings';
import { pineconeService } from './pinecone-service';
import { pineconeThumbnailService } from './pinecone-thumbnail-service';
import * as fs from 'fs';
import * as path from 'path';

// Initialize Supabase client
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
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

      // Step 4: Export embeddings locally (if not skipped)
      if (!request.options?.skipExports && embeddingResults) {
        const exportFiles = await this.exportEmbeddings(videoMetadata, embeddingResults);
        result.exportFiles = exportFiles;
      }

      // Step 5: Upload to Pinecone (if embeddings were generated)
      if (embeddingResults && !request.options?.skipEmbeddings) {
        await this.uploadToPinecone(embeddingResults);
      }

      result.success = true;
      result.message = `Successfully processed ${videoMetadata.length} videos`;
      
      console.log(`✅ Unified video import completed: ${result.message}`);
      return result;

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      result.errors.push(errorMessage);
      result.message = `Import failed: ${errorMessage}`;
      console.error('❌ Unified video import failed:', error);
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
      const channelVideoIds = await this.fetchVideosFromChannels(request.channelIds);
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
        const batchResults = await this.fetchVideoDetailsBatch(batch, request.source);
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

    // Generate title embeddings (OpenAI 512D)
    if (!options?.skipTitleEmbeddings) {
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
    }

    // Generate thumbnail embeddings (Replicate CLIP 768D)
    if (!options?.skipThumbnailEmbeddings) {
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
    }

    return results;
  }

  /**
   * Store video data in Supabase
   */
  async storeVideoData(videos: VideoMetadata[]): Promise<void> {
    console.log(`💾 Storing ${videos.length} videos in Supabase`);
    
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
    
    console.log(`✅ Successfully stored ${videos.length} videos`);
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
   * Helper: Fetch videos from channel IDs
   */
  private async fetchVideosFromChannels(channelIds: string[]): Promise<string[]> {
    const apiKey = process.env.YOUTUBE_API_KEY;
    if (!apiKey) {
      throw new Error('YouTube API key not configured');
    }

    const allVideoIds: string[] = [];
    
    for (const channelId of channelIds) {
      try {
        console.log(`🔍 Fetching videos from channel: ${channelId}`);
        
        // Step 1: Get channel details to get uploads playlist
        const channelResponse = await fetch(
          `https://www.googleapis.com/youtube/v3/channels?part=contentDetails&id=${channelId}&key=${apiKey}`
        );
        const channelData = await channelResponse.json();

        if (!channelData.items || channelData.items.length === 0) {
          console.log(`⚠️ Channel ${channelId} not found`);
          continue;
        }

        const uploadsPlaylistId = channelData.items[0].contentDetails.relatedPlaylists.uploads;

        // Step 2: Get videos from uploads playlist (last 50 videos)
        const playlistResponse = await fetch(
          `https://www.googleapis.com/youtube/v3/playlistItems?part=snippet&playlistId=${uploadsPlaylistId}&maxResults=50&key=${apiKey}`
        );
        const playlistData = await playlistResponse.json();

        if (playlistData.items) {
          const videoIds = playlistData.items
            .map((item: any) => item.snippet.resourceId.videoId)
            .filter((id: string) => id); // Filter out any undefined values

          allVideoIds.push(...videoIds);
          console.log(`✅ Found ${videoIds.length} videos from channel ${channelId}`);
        }

      } catch (error) {
        console.error(`❌ Error fetching videos from channel ${channelId}:`, error);
        // Continue with other channels even if one fails
      }
    }

    console.log(`📊 Total videos found from ${channelIds.length} channels: ${allVideoIds.length}`);
    return allVideoIds;
  }

  /**
   * Helper: Fetch videos from RSS feeds
   */
  private async fetchVideosFromRSS(rssFeedUrls: string[]): Promise<string[]> {
    const allVideoIds: string[] = [];
    
    for (const feedUrl of rssFeedUrls) {
      try {
        console.log(`🔍 Fetching videos from RSS feed: ${feedUrl}`);
        
        // Support both direct RSS URLs and channel IDs
        let actualFeedUrl = feedUrl;
        if (feedUrl.startsWith('UC') && feedUrl.length === 24) {
          // This looks like a channel ID, convert to RSS URL
          actualFeedUrl = `https://www.youtube.com/feeds/videos.xml?channel_id=${feedUrl}`;
        }
        
        const response = await fetch(actualFeedUrl, {
          headers: {
            'User-Agent': 'Unified-Video-Import/1.0'
          }
        });

        if (!response.ok) {
          console.error(`❌ Failed to fetch RSS feed ${actualFeedUrl}: ${response.status}`);
          continue;
        }

        const xmlText = await response.text();
        
        // Simple XML parsing to extract video IDs
        // Look for patterns like <yt:videoId>VIDEO_ID</yt:videoId> or entry IDs
        const videoIdMatches = xmlText.match(/<yt:videoId>([\w-]+)<\/yt:videoId>/g);
        if (videoIdMatches) {
          const videoIds = videoIdMatches.map(match => 
            match.replace('<yt:videoId>', '').replace('</yt:videoId>', '')
          );
          allVideoIds.push(...videoIds);
          console.log(`✅ Found ${videoIds.length} videos from RSS feed`);
        } else {
          // Fallback: look for entry IDs with format yt:video:VIDEO_ID
          const entryIdMatches = xmlText.match(/<id>yt:video:([\w-]+)<\/id>/g);
          if (entryIdMatches) {
            const videoIds = entryIdMatches.map(match => 
              match.replace('<id>yt:video:', '').replace('</id>', '')
            );
            allVideoIds.push(...videoIds);
            console.log(`✅ Found ${videoIds.length} videos from RSS feed (fallback method)`);
          }
        }

      } catch (error) {
        console.error(`❌ Error fetching RSS feed ${feedUrl}:`, error);
        // Continue with other feeds even if one fails
      }
    }

    console.log(`📊 Total videos found from ${rssFeedUrls.length} RSS feeds: ${allVideoIds.length}`);
    return allVideoIds;
  }

  /**
   * Helper: Fetch video details in batches
   */
  private async fetchVideoDetailsBatch(videoIds: string[], source: string): Promise<VideoMetadata[]> {
    const videos: VideoMetadata[] = [];
    
    for (const videoId of videoIds) {
      try {
        const details = await this.fetchVideoDetails(videoId);
        if (details && details.id && details.title && details.channel_id) {
          videos.push({
            id: details.id,
            title: details.title,
            channel_id: details.channel_id,
            channel_name: details.channel_name || '',
            view_count: details.view_count || 0,
            published_at: details.published_at || new Date().toISOString(),
            performance_ratio: details.performance_ratio || 1,
            thumbnail_url: details.thumbnail_url || '',
            description: details.description || '',
            data_source: source === 'owner' ? 'owner' : 'competitor',
            is_competitor: source !== 'owner',
            import_date: new Date().toISOString(),
            user_id: '00000000-0000-0000-0000-000000000000', // Default user ID
            metadata: details.metadata || {}
          });
        }
      } catch (error) {
        console.error(`❌ Failed to fetch details for video ${videoId}:`, error);
      }
    }
    
    return videos;
  }

  /**
   * Helper: Fetch individual video details
   */
  private async fetchVideoDetails(videoId: string): Promise<Partial<VideoMetadata> | null> {
    try {
      const response = await fetch(
        `https://www.googleapis.com/youtube/v3/videos?part=snippet,statistics&id=${videoId}&key=${this.youtubeApiKey}`
      );
      
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
      
      // Calculate performance ratio (views / subscriber count, defaulting to 1.0)
      const viewCount = parseInt(statistics.viewCount || '0');
      const performance_ratio = viewCount > 0 ? Math.min(viewCount / 1000000, 2.0) : 1.0;
      
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
        description: snippet.description || ''
      };
    } catch (error) {
      console.error(`❌ Failed to fetch video details for ${videoId}:`, error);
      return null;
    }
  }
}

// Export singleton instance
export const videoImportService = new VideoImportService();