/**
 * Vector Database Service
 * Handles all interactions with Supabase for vector storage and retrieval
 */

import { SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "./supabase.ts";
import { batchCreateEmbeddings } from "./server/openai-embeddings.ts";

// Define the Chunk interface since we can't import from transcript-chunker yet
interface Chunk {
  content: string;
  startTime?: number;
  endTime?: number;
  metadata?: Record<string, any>;
}

export interface VideoMetadata {
  id: string;
  channelId: string;
  title: string;
  description?: string;
  publishedAt: string;
  viewCount: number;
  likeCount?: number;
  commentCount?: number;
  duration?: string;
  channelAvgViews?: number;
  performanceRatio?: number;
  metadata?: Record<string, any>;
  updated_at?: string;
}

export interface SearchResult {
  id: string;
  videoId: string;
  content: string;
  contentType: string;
  startTime?: number;
  endTime?: number;
  similarity: number;
  metadata?: Record<string, any>;
}

export interface VideoChunk extends Chunk {
  videoId: string;
  contentType: string;
}

/**
 * Stores a YouTube video's metadata in the database
 */
export async function storeVideoMetadata(
  videoMetadata: VideoMetadata,
  userId: string,
  client: SupabaseClient = supabase
): Promise<boolean> {
  try {
    console.log(`💾 Storing metadata for video ${videoMetadata.id}`);
    
    const { error } = await client
      .from('videos')
      .upsert({
        id: videoMetadata.id,
        channel_id: videoMetadata.channelId,
        title: videoMetadata.title,
        description: videoMetadata.description || "",
        published_at: videoMetadata.publishedAt,
        view_count: videoMetadata.viewCount,
        like_count: videoMetadata.likeCount,
        comment_count: videoMetadata.commentCount,
        duration: videoMetadata.duration,
        channel_avg_views: videoMetadata.channelAvgViews,
        performance_ratio: videoMetadata.performanceRatio,
        metadata: videoMetadata.metadata || {},
        user_id: userId,
        updated_at: new Date().toISOString()
      }, {
        onConflict: 'id'
      });
    
    if (error) {
      console.error("🚨 Error storing video metadata:", error);
      return false;
    }
    
    console.log(`✅ Successfully stored metadata for video ${videoMetadata.id}`);
    return true;
  } catch (error) {
    console.error("🚨 Error in storeVideoMetadata:", error);
    return false;
  }
}

/**
 * Processes and stores chunks with their embeddings
 */
export async function storeVideoChunks(
  chunks: VideoChunk[],
  userId: string,
  openaiApiKey: string,
  client: SupabaseClient = supabase
): Promise<boolean> {
  try {
    if (!chunks || chunks.length === 0) {
      console.log("⚠️ No chunks to store");
      return false;
    }
    
    console.log(`💾 Processing and storing ${chunks.length} chunks for embedding`);
    
    // Generate embeddings for all chunks
    const chunkTexts = chunks.map(chunk => chunk.content);
    const embeddings = await batchCreateEmbeddings(chunkTexts, openaiApiKey);
    
    if (embeddings.length !== chunks.length) {
      console.error(`🚨 Mismatch between chunks (${chunks.length}) and embeddings (${embeddings.length})`);
      return false;
    }
    
    // Prepare batch of records for insertion
    const records = chunks.map((chunk, index) => ({
      video_id: chunk.videoId,
      content: chunk.content,
      content_type: chunk.contentType,
      start_time: chunk.startTime,
      end_time: chunk.endTime,
      embedding: embeddings[index],
      metadata: chunk.metadata || {},
      user_id: userId
    }));
    
    // Insert in batches to avoid size limitations
    const batchSize = 50;
    for (let i = 0; i < records.length; i += batchSize) {
      const batch = records.slice(i, i + batchSize);
      console.log(`🔄 Storing batch ${Math.floor(i/batchSize) + 1}/${Math.ceil(records.length/batchSize)}`);
      
      const { error } = await client
        .from('chunks')
        .insert(batch);
      
      if (error) {
        console.error(`🚨 Error storing chunk batch ${i/batchSize + 1}:`, error);
        return false;
      }
    }
    
    console.log(`✅ Successfully stored ${chunks.length} chunks with embeddings`);
    return true;
  } catch (error) {
    console.error("🚨 Error in storeVideoChunks:", error);
    return false;
  }
}

/**
 * Search for similar video content across all videos
 */
export async function searchVideoContent(
  query: string,
  queryEmbedding: number[],
  options: {
    limit?: number;
    threshold?: number;
    userId: string;
    videoIds?: string[];
  },
  client: SupabaseClient = supabase
): Promise<SearchResult[]> {
  try {
    const { limit = 25, threshold = 0.72, userId } = options;
    
    console.log(`🔍 Searching for content similar to: "${query.substring(0, 50)}..."${userId ? ` for user ${userId}` : ''}`);
    
    // Try the no-auth function first if it exists (ignores user_id)
    try {
      const { data: noAuthData, error: noAuthError } = await client.rpc('search_video_chunks_no_auth', {
        query_embedding: queryEmbedding,
        match_threshold: threshold,
        match_count: limit
      });
      
      if (!noAuthError && noAuthData && noAuthData.length > 0) {
        console.log(`✅ Found ${noAuthData.length} matching chunks using no-auth function`);
        
        // Map the results to a more friendly format
        return noAuthData.map((item: any) => ({
          id: item.id,
          videoId: item.video_id,
          content: item.content,
          contentType: item.content_type,
          startTime: item.start_time,
          endTime: item.end_time,
          similarity: item.similarity,
          metadata: item.metadata
        }));
      }
    } catch (noAuthError) {
      // No-auth function probably doesn't exist, continue with regular search
      console.log("ℹ️ No-auth search function not available, using regular search");
    }
    
    // Use regular RPC function for vector search (with user_id filter)
    const { data, error } = await client.rpc('search_video_chunks', {
      query_embedding: queryEmbedding,
      match_threshold: threshold,
      match_count: limit,
      p_user_id: userId
    });
    
    if (error) {
      console.error("🚨 Error searching video content:", error);
      return [];
    }
    
    if (!data || data.length === 0) {
      console.log("🔍 No matching content found");
      return [];
    }
    
    console.log(`✅ Found ${data.length} matching chunks`);
    
    // Map the results to a more friendly format
    return data.map((item: any) => ({
      id: item.id,
      videoId: item.video_id,
      content: item.content,
      contentType: item.content_type,
      startTime: item.start_time,
      endTime: item.end_time,
      similarity: item.similarity,
      metadata: item.metadata
    }));
  } catch (error) {
    console.error("🚨 Error in searchVideoContent:", error);
    
    // Last resort: try a direct query bypassing RPC functions
    try {
      console.log("🔄 Attempting direct database query as fallback");
      
      // Get random chunks as a fallback
      const { data: directData, error: directError } = await client
        .from('chunks')
        .select('*')
        .limit(options.limit || 5);  // Reduced from 10 to 5
        
      if (directError) throw directError;
      if (!directData || directData.length === 0) return [];
      
      console.log(`✅ Found ${directData.length} chunks via direct query`);
      
      // Map the results to a more friendly format (but without similarity scores)
      return directData.map((item: any) => ({
        id: item.id,
        videoId: item.video_id,
        content: item.content,
        contentType: item.content_type || 'unknown',
        startTime: item.start_time,
        endTime: item.end_time,
        similarity: 0.5, // Placeholder since we can't do vector comparison in direct query
        metadata: item.metadata || {}
      }));
    } catch (directError) {
      console.error("🚨 Even direct query failed:", directError);
      return [];
    }
  }
}

/**
 * Search for similar content within a specific video
 */
export async function searchVideoById(
  videoId: string,
  queryEmbedding: number[],
  options: {
    limit?: number;
    threshold?: number;
    userId: string;
  },
  client: SupabaseClient = supabase
): Promise<SearchResult[]> {
  try {
    const { limit = 5, threshold = 0.7, userId } = options;
    
    console.log(`🔍 Searching for content in video ${videoId}`);
    
    // Use RPC function for vector search within a video
    const { data, error } = await client.rpc('search_video_by_id', {
      video_id: videoId,
      query_embedding: queryEmbedding,
      match_threshold: threshold,
      match_count: limit,
      p_user_id: userId
    });
    
    if (error) {
      console.error(`🚨 Error searching video ${videoId}:`, error);
      return [];
    }
    
    if (!data || data.length === 0) {
      console.log(`🔍 No matching content found in video ${videoId}`);
      return [];
    }
    
    console.log(`✅ Found ${data.length} matching chunks in video ${videoId}`);
    
    // Map the results
    return data.map((item: any) => ({
      id: item.id,
      videoId: videoId,
      content: item.content,
      contentType: item.content_type,
      startTime: item.start_time,
      endTime: item.end_time,
      similarity: item.similarity,
      metadata: item.metadata
    }));
  } catch (error) {
    console.error(`🚨 Error in searchVideoById:`, error);
    return [];
  }
}

/**
 * Get video metadata by ID
 */
export async function getVideoMetadata(
  videoId: string,
  userId: string,
  client: SupabaseClient = supabase
): Promise<VideoMetadata | null> {
  try {
    console.log(`🔍 Retrieving metadata for video ${videoId}`);
    
    const { data, error } = await client
      .from('videos')
      .select('*')
      .eq('id', videoId)
      .eq('user_id', userId)
      .single();
    
    if (error) {
      console.error(`🚨 Error retrieving video ${videoId}:`, error);
      return null;
    }
    
    if (!data) {
      console.log(`🔍 Video ${videoId} not found`);
      return null;
    }
    
    // Map from database format to our interface
    return {
      id: data.id,
      channelId: data.channel_id,
      title: data.title,
      description: data.description,
      publishedAt: data.published_at,
      viewCount: data.view_count,
      likeCount: data.like_count,
      commentCount: data.comment_count,
      duration: data.duration,
      channelAvgViews: data.channel_avg_views,
      performanceRatio: data.performance_ratio,
      metadata: data.metadata,
      updated_at: data.updated_at
    };
  } catch (error) {
    console.error(`🚨 Error in getVideoMetadata:`, error);
    return null;
  }
}

/**
 * Get a list of all videos for a user
 */
export async function getUserVideos(
  userId: string,
  client: SupabaseClient = supabase
): Promise<VideoMetadata[]> {
  try {
    console.log(`🔍 Retrieving videos for user ${userId}`);
    
    // Performance optimization: Remove the order by performance_ratio
    // and add an index hint (user_id is likely indexed)
    const { data, error } = await client
      .from('videos')
      .select('*')
      .eq('user_id', userId)
      .order('updated_at', { ascending: false }); // Order by updated_at instead for newest videos first
    
    if (error) {
      console.error(`🚨 Error retrieving videos:`, error);
      return [];
    }
    
    if (!data || data.length === 0) {
      console.log(`🔍 No videos found for user ${userId}`);
      return [];
    }
    
    console.log(`✅ Found ${data.length} videos for user ${userId}`);
    
    // Map from database format to our interface
    return data.map(item => ({
      id: item.id,
      channelId: item.channel_id,
      title: item.title,
      description: item.description,
      publishedAt: item.published_at,
      viewCount: item.view_count,
      likeCount: item.like_count,
      commentCount: item.comment_count,
      duration: item.duration,
      channelAvgViews: item.channel_avg_views,
      performanceRatio: item.performance_ratio,
      metadata: item.metadata,
      updated_at: item.updated_at
    }));
  } catch (error) {
    console.error(`🚨 Error in getUserVideos:`, error);
    return [];
  }
}

/**
 * Hybrid search combining vector similarity with keyword matching
 * This improves recall when vector search alone doesn't find good matches
 */
export async function hybridSearchVideoContent(
  query: string,
  queryEmbedding: number[],
  options: {
    limit?: number;
    threshold?: number;
    userId: string;
    videoIds?: string[];
  },
  client: SupabaseClient = supabase
): Promise<SearchResult[]> {
  try {
    const { limit = 30, threshold = 0.7, userId } = options;
    const combinedResults: Map<string, SearchResult> = new Map(); // Use Map to deduplicate by ID
    
    console.log(`🔍 Performing hybrid search for: "${query.substring(0, 50)}..."`);
    
    // 1. First try vector search
    try {
      const vectorResults = await searchVideoContent(query, queryEmbedding, {
        ...options,
        threshold: threshold, // Use higher threshold
        limit: limit // Limit returned results
      }, client);
      
      // Add vector results to combined results
      vectorResults.forEach(result => {
        combinedResults.set(result.id, {
          ...result,
          similarity: result.similarity * 1.2 // Boost vector matches slightly
        });
      });
      
      console.log(`✅ Vector search found ${vectorResults.length} matches`);
    } catch (error) {
      console.error("Error in vector search part of hybrid search:", error);
    }
    
    // 2. Then try text search ONLY if we don't have enough results
    if (combinedResults.size < 5) {
      try {
        // Extract key terms from query (simple approach)
        const terms = query
          .toLowerCase()
          .replace(/[^\w\s]/g, '')
          .split(/\s+/)
          .filter(term => term.length > 3); // Only terms longer than 3 chars
        
        if (terms.length > 0) {
          // Prepare search conditions
          const searchConditions = terms.map(term => `content.ilike.%${term}%`);
          
          // Perform text search with multiple terms
          const { data: textResults, error } = await client
            .from('chunks')
            .select('*')
            .or(searchConditions.join(','))
            .limit(limit);
            
          if (error) throw error;
            
          // Calculate basic text match relevance and add to combined results
          if (textResults && textResults.length > 0) {
            console.log(`✅ Text search found ${textResults.length} matches`);
            
            textResults.forEach(item => {
              // Skip if already added from vector search
              if (combinedResults.has(item.id)) return;
              
              // Basic relevance scoring - count how many terms match
              let score = 0;
              const contentLower = (item.content || '').toLowerCase();
              terms.forEach(term => {
                if (contentLower.includes(term)) score += 0.1;
              });
              
              // Add to combined results if better than threshold
              if (score > threshold * 0.7) { // Lower threshold for text matches
                combinedResults.set(item.id, {
                  id: item.id,
                  videoId: item.video_id,
                  content: item.content,
                  contentType: item.content_type || 'unknown',
                  startTime: item.start_time,
                  endTime: item.end_time,
                  similarity: score,
                  metadata: item.metadata || {}
                });
              }
            });
          }
        }
      } catch (textError) {
        console.error("Error in text search part of hybrid search:", textError);
      }
    }
    
    // Return results sorted by similarity
    return Array.from(combinedResults.values())
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, limit);
  } catch (error) {
    console.error("Error in hybridSearchVideoContent:", error);
    return [];
  }
} 