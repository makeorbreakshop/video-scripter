/**
 * Vector Database Service
 * Handles all interactions with Supabase for vector storage and retrieval
 */

import { SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "./supabase.ts";
import { batchCreateEmbeddings } from "./server/openai-embeddings.ts";
import { videoTextFor, videosTextPayload, writeVideoTextFields } from "./app/video-text";

// Define the Chunk interface since we can't import from transcript-chunker yet
interface Chunk {
  content: string;
  startTime?: number;
  endTime?: number;
  metadata?: Record<string, any>;
}


// Search lives in ./vector-search (Edge-safe); re-exported here so existing imports keep working.
export { searchVideoContent, searchVideoById, hybridSearchVideoContent } from "./vector-search";
export type { VideoMetadata, SearchResult, VideoChunk } from "./vector-search";
import type { VideoMetadata, SearchResult, VideoChunk } from "./vector-search";

export async function storeVideoMetadata(
  videoMetadata: VideoMetadata,
  userId: string,
  client: SupabaseClient = supabase
): Promise<boolean> {
  try {
    console.log(`💾 Storing metadata for video ${videoMetadata.id}`);
    
    const text = { description: videoMetadata.description || "", metadata: videoMetadata.metadata || {} };
    const { error } = await client
      .from('videos')
      .upsert({
        id: videoMetadata.id,
        channel_id: videoMetadata.channelId,
        title: videoMetadata.title,
        // description/metadata only while they are still stored on videos (CLEARED_COLUMNS)
        ...videosTextPayload(text),
        published_at: videoMetadata.publishedAt,
        view_count: videoMetadata.viewCount,
        like_count: videoMetadata.likeCount,
        comment_count: videoMetadata.commentCount,
        duration: videoMetadata.duration,
        channel_avg_views: videoMetadata.channelAvgViews,
        performance_ratio: videoMetadata.performanceRatio,
        user_id: userId,
        updated_at: new Date().toISOString()
      }, {
        onConflict: 'id'
      });
    
    if (error) {
      console.error("🚨 Error storing video metadata:", error);
      return false;
    }
    // The upsert overwrote both fields, so overwrite the side copy too.
    await writeVideoTextFields([{ videoId: videoMetadata.id, ...text }], { onConflict: 'update' });
    
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
    
    // select('*') no longer carries the text columns once they are cleared; read them through
    // the accessor (lib/app/video-text.ts).
    const text = (await videoTextFor([data.id])).get(data.id);

    // Map from database format to our interface
    return {
      id: data.id,
      channelId: data.channel_id,
      title: data.title,
      description: text?.description ?? data.description,
      publishedAt: data.published_at,
      viewCount: data.view_count,
      likeCount: data.like_count,
      commentCount: data.comment_count,
      duration: data.duration,
      channelAvgViews: data.channel_avg_views,
      performanceRatio: data.performance_ratio,
      metadata: text?.metadata ?? data.metadata,
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
    
    // select('*') no longer carries the text columns once they are cleared; read them through
    // the accessor (lib/app/video-text.ts).
    const text = await videoTextFor(data.map((item) => item.id));

    // Map from database format to our interface
    return data.map(item => ({
      id: item.id,
      channelId: item.channel_id,
      title: item.title,
      description: text.get(item.id)?.description ?? item.description,
      publishedAt: item.published_at,
      viewCount: item.view_count,
      likeCount: item.like_count,
      commentCount: item.comment_count,
      duration: item.duration,
      channelAvgViews: item.channel_avg_views,
      performanceRatio: item.performance_ratio,
      metadata: text.get(item.id)?.metadata ?? item.metadata,
      updated_at: item.updated_at
    }));
  } catch (error) {
    console.error(`🚨 Error in getUserVideos:`, error);
    return [];
  }
}
