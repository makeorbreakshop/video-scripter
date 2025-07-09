/**
 * Title embedding service for YouTube video semantic search
 * Handles OpenAI embedding generation specifically for video titles
 */

import { createEmbeddings, batchCreateEmbeddings } from './server/openai-embeddings.ts';
import { pineconeService } from './pinecone-service.ts';

interface VideoData {
  id: string;
  title: string;
  channel_id: string;
  channel_name?: string;
  view_count: number;
  published_at: string;
  performance_ratio: number;
}

interface EmbeddingResult {
  id: string;
  success: boolean;
  error?: string;
}

/**
 * Generate embedding for a single video title
 */
export async function generateTitleEmbedding(
  title: string,
  apiKey: string
): Promise<number[]> {
  if (!title || title.trim().length === 0) {
    throw new Error('Title cannot be empty');
  }

  try {
    // Use 512 dimensions for our Pinecone index
    const embeddings = await createEmbeddings(
      [title], 
      apiKey, 
      "text-embedding-3-small"
    );
    
    // OpenAI's text-embedding-3-small supports dimension reduction
    // We need to truncate to 512 dimensions to match our Pinecone index
    const fullEmbedding = embeddings[0];
    const truncatedEmbedding = fullEmbedding.slice(0, 512);
    
    return truncatedEmbedding;
  } catch (error) {
    console.error('❌ Failed to generate title embedding:', error);
    throw error;
  }
}

/**
 * Generate embeddings for multiple video titles
 */
export async function batchGenerateTitleEmbeddings(
  titles: string[],
  apiKey: string,
  batchSize: number = 10
): Promise<number[][]> {
  if (!titles || titles.length === 0) {
    return [];
  }

  try {
    
    // Generate embeddings using existing batch function
    const embeddings = await batchCreateEmbeddings(
      titles,
      apiKey,
      batchSize,
      "text-embedding-3-small"
    );
    
    // Truncate all embeddings to 512 dimensions
    const truncatedEmbeddings = embeddings.map(embedding => 
      embedding.slice(0, 512)
    );
    
    return truncatedEmbeddings;
  } catch (error) {
    console.error('❌ Failed to generate batch title embeddings:', error);
    throw error;
  }
}

/**
 * Sync a single video to Pinecone
 */
export async function syncVideoToPinecone(
  videoData: VideoData,
  apiKey: string
): Promise<EmbeddingResult> {
  try {
    // Validate that videoData has required fields
    if (!videoData.id) {
      throw new Error('Video data missing required id field');
    }
    
    
    // Generate embedding for the title
    const embedding = await generateTitleEmbedding(videoData.title, apiKey);
    
    // Prepare vector for Pinecone
    // Fix: Ensure ID is properly set
    const videoId = videoData.id || 'KZGy7Q_jLXE'; // fallback for debugging
    
    const vector = {
      id: String(videoId),
      values: embedding,
      metadata: {
        title: String(videoData.title || ''),
        channel_id: String(videoData.channel_id || ''),
        channel_name: String(videoData.channel_name || ''),
        view_count: Number(videoData.view_count || 0),
        published_at: String(videoData.published_at || ''),
        performance_ratio: Number(videoData.performance_ratio || 0),
        embedding_version: 'v1',
      },
    };
    
    
    // Upsert to Pinecone
    await pineconeService.upsertEmbeddings([vector]);
    
    return {
      id: videoData.id,
      success: true,
    };
  } catch (error) {
    console.error(`❌ Failed to sync video ${videoData.id}:`, error);
    return {
      id: videoData.id,
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Batch sync multiple videos to Pinecone
 */
export async function batchSyncVideosToPinecone(
  videos: VideoData[],
  apiKey: string,
  batchSize: number = 50
): Promise<EmbeddingResult[]> {
  if (!videos || videos.length === 0) {
    return [];
  }

  console.log(`🔄 Batch syncing ${videos.length} videos to Pinecone`);
  
  const results: EmbeddingResult[] = [];
  
  // Process videos in batches
  for (let i = 0; i < videos.length; i += batchSize) {
    const batch = videos.slice(i, i + batchSize);
    
    try {
      const batchNum = Math.floor(i / batchSize) + 1;
      const totalBatches = Math.ceil(videos.length / batchSize);
      console.log(`📦 Batch ${batchNum}/${totalBatches}: Processing videos ${i + 1}-${Math.min(i + batchSize, videos.length)}`);
      
      // Generate embeddings for batch
      const titles = batch.map(video => video.title);
      const embeddings = await batchGenerateTitleEmbeddings(titles, apiKey, batchSize);
      
      // Prepare vectors for Pinecone
      const vectors = batch.map((video, index) => ({
        id: video.id,
        values: embeddings[index],
        metadata: {
          title: video.title,
          channel_id: video.channel_id,
          channel_name: video.channel_name || '',
          view_count: video.view_count,
          published_at: video.published_at,
          performance_ratio: video.performance_ratio,
          embedding_version: 'v1',
        },
      }));
      
      // Upsert batch to Pinecone
      await pineconeService.upsertEmbeddings(vectors);
      
      // Mark all as successful
      batch.forEach(video => {
        results.push({
          id: video.id,
          success: true,
        });
      });
      
      console.log(`✅ Batch ${batchNum}/${totalBatches}: Completed successfully`);
      
      // Brief delay between batches
      if (i + batchSize < videos.length) {
        await new Promise(resolve => setTimeout(resolve, 200));
      }
    } catch (error) {
      console.error(`❌ Batch ${Math.floor(i / batchSize) + 1}: Failed -`, error.message || error);
      
      // Mark all videos in this batch as failed
      batch.forEach(video => {
        results.push({
          id: video.id,
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      });
    }
  }
  
  const successCount = results.filter(r => r.success).length;
  const failureCount = results.filter(r => !r.success).length;
  
  console.log(`🎯 BATCH COMPLETE: ${successCount}/${videos.length} videos successfully embedded${failureCount > 0 ? `, ${failureCount} failed` : ''}`);
  
  return results;
}

/**
 * Generate embedding for a search query
 */
export async function generateQueryEmbedding(
  query: string,
  apiKey: string
): Promise<number[]> {
  if (!query || query.trim().length === 0) {
    throw new Error('Query cannot be empty');
  }

  try {
    
    const embedding = await generateTitleEmbedding(query, apiKey);
    
    return embedding;
  } catch (error) {
    console.error('❌ Failed to generate query embedding:', error);
    throw error;
  }
}