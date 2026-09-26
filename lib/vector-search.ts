/**
 * Vector search over chunks (Supabase RPC + text fallback).
 * Split out of lib/vector-db-service.ts on 2026-09-26: app/api/ai/chat runs on the Edge runtime and
 * imports hybridSearchVideoContent; the rest of vector-db-service reads text through the accessor,
 * which needs `pg` — not bundleable for Edge (lib/ops/edge-runtime-imports.test.ts). Keep this module
 * free of lib/app/video-text and lib/admin/db.
 */

import { SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "./supabase.ts";

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