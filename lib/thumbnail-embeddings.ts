/**
 * Thumbnail embedding service for YouTube video visual similarity search
 * Handles Replicate CLIP embedding generation specifically for video thumbnails
 */

import Replicate from 'replicate';
import { embeddingCache } from './embedding-cache.ts';
import { AdaptiveRateLimiter } from './adaptive-rate-limiter.ts';
import fs from 'fs';

interface VideoThumbnailData {
  id: string;
  title: string;
  thumbnail_url: string;
  channel_id: string;
  channel_name?: string;
  view_count: number;
  published_at: string;
  performance_ratio: number;
}

interface ThumbnailEmbeddingResult {
  id: string;
  success: boolean;
  error?: string;
  embedding?: number[];
}

interface BatchProgress {
  processed: number;
  total: number;
  success: number;
  failed: number;
  currentBatch: number;
  totalBatches: number;
}

/**
 * Initialize Replicate client
 */
function getReplicateClient(): Replicate {
  const apiToken = process.env.REPLICATE_API_TOKEN;
  if (!apiToken) {
    throw new Error('REPLICATE_API_TOKEN environment variable is required');
  }
  
  return new Replicate({
    auth: apiToken,
  });
}

/**
 * Generate CLIP embedding for a single thumbnail URL with caching
 */
export async function generateThumbnailEmbedding(
  thumbnailUrl: string,
  videoId?: string
): Promise<number[]> {
  if (!thumbnailUrl || thumbnailUrl.trim().length === 0) {
    throw new Error('Thumbnail URL cannot be empty');
  }

  // Check cache first if videoId provided
  if (videoId) {
    const cached = await embeddingCache.getCachedEmbedding(videoId);
    if (cached) {
      return cached;
    }
  }

  try {
    const replicate = getReplicateClient();
    
    console.log(`🔄 Calling Replicate with URL: ${thumbnailUrl}`);
    
    // Add retry logic for rate limits
    let retries = 3;
    let output: any;
    
    while (retries > 0) {
      try {
        // Use the CLIP embeddings model we researched
        output = await replicate.run(
          "krthr/clip-embeddings:1c0371070cb827ec3c7f2f28adcdde54b50dcd239aa6faea0bc98b174ef03fb4",
          {
            input: {
              image: thumbnailUrl
            }
          }
        );
        break; // Success, exit retry loop
      } catch (error: any) {
        retries--;
        if (error.message?.includes('rate limit') || error.status === 429) {
          console.log(`⏳ Rate limited, retrying in ${4 - retries} seconds... (${retries} retries left)`);
          await new Promise(resolve => setTimeout(resolve, (4 - retries) * 1000));
          if (retries === 0) throw error;
        } else {
          throw error; // Non-rate-limit error, don't retry
        }
      }
    }

    console.log(`🔍 Replicate output type: ${typeof output}`);
    console.log(`🔍 Replicate output keys:`, Object.keys(output || {}));
    console.log(`🔍 Replicate full output:`, JSON.stringify(output).slice(0, 200));
    
    // Handle different response formats
    let embedding: number[];
    
    if (Array.isArray(output)) {
      // Sometimes the response is directly an array
      embedding = output as number[];
    } else if (output && typeof output === 'object' && 'embedding' in output) {
      // Standard response format
      const embeddingData = (output as any).embedding;
      if (!Array.isArray(embeddingData)) {
        throw new Error(`Embedding is not an array. Got: ${typeof embeddingData}`);
      }
      embedding = embeddingData as number[];
    } else {
      throw new Error(`No valid embedding returned from Replicate. Got: ${typeof output}, Keys: ${Object.keys(output || {}).join(', ')}`);
    }
    
    if (!embedding || embedding.length === 0) {
      throw new Error('Empty embedding returned from Replicate');
    }
    
    console.log(`✅ Generated thumbnail embedding: ${embedding.length} dimensions`);
    
    // Cache the result if videoId provided
    if (videoId) {
      await embeddingCache.cacheEmbedding(videoId, thumbnailUrl, embedding, 0.00098);
    }
    
    return embedding;
    
  } catch (error) {
    console.error('❌ Failed to generate thumbnail embedding:', error);
    throw error;
  }
}

/**
 * Generate embeddings for multiple thumbnail URLs in batches with caching
 */
export async function batchGenerateThumbnailEmbeddings(
  videoData: Array<{ id: string; thumbnailUrl: string }>,
  batchSize: number = 75,
  onProgress?: (progress: BatchProgress) => void,
  useAdaptiveRateLimit: boolean = false
): Promise<ThumbnailEmbeddingResult[]> {
  if (!videoData || videoData.length === 0) {
    return [];
  }

  console.log(`\n🚀 Starting batch thumbnail embedding generation for ${videoData.length} videos`);
  console.log(`┌${'─'.repeat(60)}┐`);
  console.log(`│ Batch Processing Started - ${new Date().toLocaleTimeString()}${' '.repeat(18)}│`);
  console.log(`└${'─'.repeat(60)}┘`);
  
  // Check cache first
  const videoIds = videoData.map(v => v.id);
  const { cached, missing } = await embeddingCache.getCachedEmbeddings(videoIds);
  
  console.log(`\n💾 Cache Status:`);
  console.log(`   └── Found: ${cached.length} cached embeddings`);
  console.log(`   └── Missing: ${missing.length} need processing`);
  console.log(`   └── Estimated cost: $${(missing.length * 0.00098).toFixed(2)}`);
  
  const results: ThumbnailEmbeddingResult[] = [];
  
  // Add cached results
  for (const cachedItem of cached) {
    results.push({
      id: cachedItem.videoId,
      success: true,
      embedding: cachedItem.embedding
    });
  }
  
  // Process missing items
  const missingData = videoData.filter(v => missing.includes(v.id));
  
  if (missingData.length === 0) {
    console.log('\n🎉 All embeddings found in cache! No API calls needed.');
    return results;
  }
  
  const totalBatches = Math.ceil(missingData.length / batchSize);
  
  // Initialize adaptive rate limiter if enabled
  const rateLimiter = useAdaptiveRateLimit ? new AdaptiveRateLimiter({
    maxRequestsPerSecond: 10, // Replicate's limit
    targetUtilization: 0.85, // Target 85% utilization
    minConcurrency: 1,
    maxConcurrency: 10,
    backoffMultiplier: 0.5,
    recoveryMultiplier: 1.2
  }) : null;
  
  // Process missing videos in batches to respect rate limits
  for (let i = 0; i < missingData.length; i += batchSize) {
    const batch = missingData.slice(i, i + batchSize);
    const currentBatch = Math.floor(i / batchSize) + 1;
    
    const startNum = i + 1;
    const endNum = Math.min(i + batchSize, missingData.length);
    
    console.log(`\n┌─ Batch ${currentBatch}/${totalBatches} ${'─'.repeat(45 - currentBatch.toString().length - totalBatches.toString().length)}┐`);
    console.log(`│ Processing thumbnails ${startNum}-${endNum} (${batch.length} videos)${' '.repeat(Math.max(0, 30 - startNum.toString().length - endNum.toString().length - batch.length.toString().length))}│`);
    console.log(`│ Started: ${new Date().toLocaleTimeString()}${' '.repeat(39)}│`);
    console.log(`└${'─'.repeat(60)}┘`);
    
    try {
      // Process with dynamic concurrency
      let processedInBatch = 0;
      
      while (processedInBatch < batch.length) {
        // Get current concurrency from rate limiter or use default
        const CONCURRENT_REQUESTS = rateLimiter ? rateLimiter.getConcurrency() : 5;
        
        const remainingInBatch = batch.length - processedInBatch;
        const currentBatchSize = Math.min(CONCURRENT_REQUESTS, remainingInBatch);
        const concurrentBatch = batch.slice(processedInBatch, processedInBatch + currentBatchSize);
        const batchStartTime = Date.now();
        
        // Process concurrent batch in parallel
        const concurrentPromises = concurrentBatch.map(async (video) => {
          const requestStartTime = Date.now();
          try {
            const embedding = await generateThumbnailEmbedding(video.thumbnailUrl, video.id);
            
            // Record successful request
            if (rateLimiter) {
              const duration = Date.now() - requestStartTime;
              rateLimiter.recordRequest(duration, true, false);
            }
            
            return {
              id: video.id,
              success: true,
              embedding: embedding
            };
          } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            const isRateLimit = errorMessage.includes('rate limit') || errorMessage.includes('429');
            
            // Record failed request
            if (rateLimiter) {
              const duration = Date.now() - requestStartTime;
              rateLimiter.recordRequest(duration, false, isRateLimit);
            }
            
            console.error(`❌ Failed to process ${video.id}:`, errorMessage);
            return {
              id: video.id,
              success: false,
              error: errorMessage
            };
          }
        });
        
        // Wait for all concurrent requests to complete
        const concurrentResults = await Promise.all(concurrentPromises);
        results.push(...concurrentResults);
        
        const batchDuration = Date.now() - batchStartTime;
        console.log(`⚡ Concurrent batch of ${concurrentBatch.length} processed in ${batchDuration}ms`);
        
        // Show rate limiter stats if enabled
        if (rateLimiter) {
          const stats = rateLimiter.getStats();
          const processed = Math.min(i + processedInBatch + currentBatchSize, missingData.length);
          console.log(`📊 Rate Limiter: Concurrency=${stats.currentConcurrency} | Rate=${stats.requestRate}/${stats.targetRate} req/s | Utilization=${stats.utilization}`);
        }
        
        // Update processed count
        processedInBatch += currentBatchSize;
        
        // Calculate delay based on rate limiter or use default
        if (processedInBatch < batch.length) {
          const delayTime = rateLimiter ? rateLimiter.getDelayMs() : 
            (batchDuration < 500 ? 500 - batchDuration : 0);
          
          if (delayTime > 0) {
            console.log(`⏱️  Rate limit delay: ${delayTime}ms`);
            await new Promise(resolve => setTimeout(resolve, delayTime));
          }
        }
      }
      
      const batchSuccessCount = results.filter(r => r.success && r.id && batch.find(b => b.id === r.id)).length;
      const batchFailCount = batch.length - batchSuccessCount;
      
      console.log(`✅ Batch ${currentBatch}/${totalBatches}: Completed! (${batchSuccessCount} success, ${batchFailCount} failed)`);
      
      // Update progress if callback provided
      if (onProgress) {
        const processed = Math.min(i + batchSize, missingData.length) + cached.length;
        const success = results.filter(r => r.success).length;
        const failed = results.filter(r => !r.success).length;
        
        onProgress({
          processed,
          total: videoData.length,
          success,
          failed,
          currentBatch,
          totalBatches
        });
      }
      
      // Progress bar for overall completion
      const overallProcessed = Math.min(i + batchSize, missingData.length) + cached.length;
      const overallPercent = Math.round((overallProcessed / videoData.length) * 100);
      const progressWidth = 40;
      const filledWidth = Math.round((overallPercent / 100) * progressWidth);
      const progressBar = '█'.repeat(filledWidth) + '░'.repeat(progressWidth - filledWidth);
      
      console.log(`\n📊 Overall Progress: [${progressBar}] ${overallPercent}% (${overallProcessed}/${videoData.length})`);
      
      // Persist cache after each batch
      await embeddingCache.persist();
      
      // Optimized delay between batches (500ms for API response time variability)
      if (i + batchSize < missingData.length) {
        const remainingBatches = totalBatches - currentBatch;
        const avgTime = 4; // Estimated minutes per batch
        const etaMinutes = remainingBatches * avgTime;
        console.log(`⏳ Waiting 500ms before next batch... (${remainingBatches} batches remaining, ETA: ${etaMinutes}m)`);
        await new Promise(resolve => setTimeout(resolve, 500));
      }
      
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error(`❌ Batch ${currentBatch}/${totalBatches}: Failed -`, errorMessage);
      
      // Mark all videos in this batch as failed
      batch.forEach(video => {
        results.push({
          id: video.id,
          success: false,
          error: errorMessage
        });
      });
    }
  }
  
  const successCount = results.filter(r => r.success).length;
  const failureCount = results.filter(r => !r.success).length;
  const actualCost = (successCount - cached.length) * 0.00098; // Don't count cached items in cost
  
  console.log(`\n┌${'─'.repeat(60)}┐`);
  console.log(`│ 🎯 BATCH PROCESSING COMPLETE${' '.repeat(27)}│`);
  console.log(`├${'─'.repeat(60)}┤`);
  console.log(`│ ✅ Success: ${successCount}/${videoData.length} thumbnails${' '.repeat(Math.max(0, 28 - successCount.toString().length - videoData.length.toString().length))}│`);
  console.log(`│ 💰 Cost: $${actualCost.toFixed(2)}${' '.repeat(Math.max(0, 46 - actualCost.toFixed(2).length))}│`);
  if (failureCount > 0) {
    console.log(`│ ⚠️  Failed: ${failureCount} thumbnails${' '.repeat(Math.max(0, 34 - failureCount.toString().length))}│`);
  }
  console.log(`│ 🕒 Completed: ${new Date().toLocaleTimeString()}${' '.repeat(32)}│`);
  console.log(`└${'─'.repeat(60)}┘`);
  
  // Final cache persist
  await embeddingCache.persist();
  
  return results;
}

/**
 * Process 2024 videos specifically (our initial batch)
 */
export async function process2024ThumbnailEmbeddings(
  onProgress?: (progress: BatchProgress) => void
): Promise<ThumbnailEmbeddingResult[]> {
  // This will be implemented to fetch from the videos_2024_unprocessed view
  // and process those thumbnails
  console.log('🎯 Starting 2024 thumbnail processing...');
  
  // TODO: Implement database fetch and processing
  // For now, return empty array
  return [];
}

/**
 * Test function to verify Replicate integration with a single thumbnail
 */
export async function testThumbnailEmbedding(
  thumbnailUrl: string = "https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg"
): Promise<ThumbnailEmbeddingResult> {
  console.log('🧪 Testing thumbnail embedding generation...');
  console.log(`📸 URL: ${thumbnailUrl}`);
  
  try {
    const embedding = await generateThumbnailEmbedding(thumbnailUrl);
    
    console.log(`✅ Test successful! Generated ${embedding.length}-dimensional embedding`);
    console.log(`💰 Cost: $0.00098`);
    
    return {
      id: 'test',
      success: true,
      embedding
    };
  } catch (error) {
    console.error('❌ Test failed:', error);
    return {
      id: 'test',
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    };
  }
}

/**
 * Get estimated cost for a batch of thumbnails
 */
export function getEstimatedCost(thumbnailCount: number): {
  cost: number;
  formattedCost: string;
} {
  const cost = thumbnailCount * 0.00098;
  return {
    cost,
    formattedCost: `$${cost.toFixed(2)}`
  };
}

/**
 * Validate thumbnail URL format
 */
export function isValidThumbnailUrl(url: string): boolean {
  if (!url) return false;
  
  // YouTube thumbnail URL patterns
  const youtubePatterns = [
    /^https:\/\/i\.ytimg\.com\/vi\/[a-zA-Z0-9_-]+\/[a-z0-9]+\.jpg$/,
    /^https:\/\/i\.ytimg\.com\/vi_webp\/[a-zA-Z0-9_-]+\/[a-z0-9]+\.webp$/
  ];
  
  return youtubePatterns.some(pattern => pattern.test(url));
}

/**
 * Get thumbnail quality from URL
 */
export function getThumbnailQuality(url: string): string {
  if (url.includes('maxresdefault')) return 'maxres';
  if (url.includes('hqdefault')) return 'hq';
  if (url.includes('mqdefault')) return 'mq';
  if (url.includes('default')) return 'default';
  return 'unknown';
}

/**
 * Export thumbnail embeddings to local files
 */
export async function exportThumbnailEmbeddings(
  videoData: VideoThumbnailData[],
  embeddings: number[][],
  exportPath: string = '/Users/brandoncullum/video-scripter/exports'
): Promise<{ jsonPath: string; csvPath: string; metadataPath: string }> {
  const timestamp = new Date().toISOString();
  const baseFilename = `thumbnail-embeddings-${timestamp}`;
  
  // Prepare export data
  const exportData = {
    export_info: {
      timestamp,
      total_vectors: videoData.length,
      dimension: embeddings[0]?.length || 768,
      index_name: 'video-thumbnails',
      batches_processed: 1,
      type: 'thumbnail_embeddings'
    },
    vectors: videoData.map((video, index) => ({
      id: video.id,
      values: embeddings[index],
      metadata: {
        title: video.title,
        channel_name: video.channel_name || '',
        channel_id: video.channel_id,
        view_count: video.view_count,
        published_at: video.published_at,
        performance_ratio: video.performance_ratio,
        thumbnail_url: video.thumbnail_url
      }
    }))
  };

  // Create file paths
  const jsonPath = `${exportPath}/${baseFilename}.json`;
  const csvPath = `${exportPath}/${baseFilename}.csv`;
  const metadataPath = `${exportPath}/${baseFilename}-metadata-only.json`;

  // Export full JSON
  fs.writeFileSync(jsonPath, JSON.stringify(exportData, null, 2));

  // Export CSV for analysis
  const csvHeaders = [
    'id', 'title', 'channel_name', 'channel_id', 'view_count', 'published_at', 
    'performance_ratio', 'thumbnail_url', ...Array.from({length: embeddings[0]?.length || 768}, (_, i) => `dim_${i}`)
  ];
  
  const csvRows = videoData.map((video, index) => [
    video.id,
    `"${video.title.replace(/"/g, '""')}"`,
    `"${video.channel_name?.replace(/"/g, '""') || ''}"`,
    video.channel_id,
    video.view_count,
    video.published_at,
    video.performance_ratio,
    video.thumbnail_url,
    ...embeddings[index]
  ]);

  const csvContent = [csvHeaders.join(','), ...csvRows.map(row => row.join(','))].join('\n');
  
  fs.writeFileSync(csvPath, csvContent);

  // Export metadata only
  const metadataOnly = {
    export_info: exportData.export_info,
    vectors: exportData.vectors.map(v => ({
      id: v.id,
      metadata: v.metadata
    }))
  };

  fs.writeFileSync(metadataPath, JSON.stringify(metadataOnly, null, 2));

  console.log(`\n📁 Local Export Complete:`);
  console.log(`   └── JSON: ${jsonPath}`);
  console.log(`   └── CSV: ${csvPath}`);
  console.log(`   └── Metadata: ${metadataPath}`);
  console.log(`   └── Total vectors: ${videoData.length}`);

  return { jsonPath, csvPath, metadataPath };
}