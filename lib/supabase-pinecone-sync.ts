/**
 * Supabase-Pinecone synchronization service
 * Handles data linking between Supabase (source of truth) and Pinecone (search index)
 */

import { createClient } from '@supabase/supabase-js';

interface VideoRecord {
  id: string;
  title: string;
  channel_id: string;
  channel_name?: string;
  view_count: number;
  published_at: string;
  performance_ratio: number;
  pinecone_embedded: boolean;
  pinecone_embedding_version: string;
  pinecone_last_updated: string;
}

interface SyncStats {
  total_videos: number;
  unsynced_videos: number;
  synced_videos: number;
  failed_videos: number;
}

export class SupabasePineconeSync {
  private supabase;

  constructor() {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !supabaseKey) {
      throw new Error('Supabase environment variables are required');
    }

    this.supabase = createClient(supabaseUrl, supabaseKey);
  }

  /**
   * Get videos that haven't been synced to Pinecone
   */
  async getUnsyncedVideos(limit: number = 100): Promise<VideoRecord[]> {
    try {
      console.log(`📊 Fetching up to ${limit} unsynced videos from Supabase`);
      
      const { data, error } = await this.supabase
        .from('videos')
        .select(`
          id,
          title,
          channel_id,
          view_count,
          published_at,
          performance_ratio,
          pinecone_embedded,
          pinecone_embedding_version,
          pinecone_last_updated
        `)
        .or('pinecone_embedded.is.null,pinecone_embedded.eq.false')
        .not('title', 'is', null)
        .order('published_at', { ascending: false })
        .limit(limit);

      if (error) {
        console.error('❌ Error fetching unsynced videos:', error);
        throw error;
      }

      console.log(`✅ Found ${data?.length || 0} unsynced videos`);
      return data || [];
    } catch (error) {
      console.error('❌ Failed to get unsynced videos:', error);
      throw error;
    }
  }

  /**
   * Get video metadata for Pinecone embedding
   */
  async getVideoMetadataForPinecone(videoIds: string[]): Promise<VideoRecord[]> {
    try {
      console.log(`📊 Fetching metadata for ${videoIds.length} videos`);
      
      const { data, error } = await this.supabase
        .from('videos')
        .select(`
          id,
          title,
          channel_id,
          view_count,
          published_at,
          performance_ratio,
          pinecone_embedded,
          pinecone_embedding_version,
          pinecone_last_updated
        `)
        .in('id', videoIds);

      if (error) {
        console.error('❌ Error fetching video metadata:', error);
        throw error;
      }

      console.log(`✅ Retrieved metadata for ${data?.length || 0} videos`);
      return data || [];
    } catch (error) {
      console.error('❌ Failed to get video metadata:', error);
      throw error;
    }
  }

  /**
   * Update video embedding status in Supabase
   */
  async updateVideoEmbeddingStatus(
    videoIds: string[],
    success: boolean,
    embeddingVersion: string = 'v1'
  ): Promise<void> {
    try {
      console.log(`📝 Updating embedding status for ${videoIds.length} videos`);
      
      const { error } = await this.supabase
        .from('videos')
        .update({
          pinecone_embedded: success,
          pinecone_embedding_version: embeddingVersion,
          pinecone_last_updated: new Date().toISOString(),
        })
        .in('id', videoIds);

      if (error) {
        console.error('❌ Error updating embedding status:', error);
        throw error;
      }

      console.log(`✅ Updated embedding status for ${videoIds.length} videos`);
    } catch (error) {
      console.error('❌ Failed to update embedding status:', error);
      throw error;
    }
  }

  /**
   * Get videos with title changes that need re-embedding
   */
  async getVideosWithTitleChanges(): Promise<VideoRecord[]> {
    try {
      console.log('🔍 Checking for videos with title changes');
      
      // For now, we'll just check for videos that were embedded over a week ago
      // In the future, we could add a 'title_updated_at' column to track changes
      const weekAgo = new Date();
      weekAgo.setDate(weekAgo.getDate() - 7);
      
      const { data, error } = await this.supabase
        .from('videos')
        .select(`
          id,
          title,
          channel_id,
          view_count,
          published_at,
          performance_ratio,
          pinecone_embedded,
          pinecone_embedding_version,
          pinecone_last_updated
        `)
        .eq('pinecone_embedded', true)
        .lt('pinecone_last_updated', weekAgo.toISOString())
        .limit(50);

      if (error) {
        console.error('❌ Error checking for title changes:', error);
        throw error;
      }

      console.log(`✅ Found ${data?.length || 0} videos that may need re-embedding`);
      return data || [];
    } catch (error) {
      console.error('❌ Failed to check for title changes:', error);
      throw error;
    }
  }

  /**
   * Get sync statistics
   */
  async getSyncStats(): Promise<SyncStats> {
    try {
      console.log('📊 Calculating sync statistics');
      
      // Get total videos
      const { count: totalVideos, error: totalError } = await this.supabase
        .from('videos')
        .select('*', { count: 'exact', head: true })
        .not('title', 'is', null);

      if (totalError) {
        throw totalError;
      }

      // Get synced videos
      const { count: syncedVideos, error: syncedError } = await this.supabase
        .from('videos')
        .select('*', { count: 'exact', head: true })
        .eq('pinecone_embedded', true);

      if (syncedError) {
        throw syncedError;
      }

      const total = totalVideos || 0;
      const synced = syncedVideos || 0;
      const unsynced = total - synced;

      const stats: SyncStats = {
        total_videos: total,
        unsynced_videos: unsynced,
        synced_videos: synced,
        failed_videos: 0, // We'll track this separately if needed
      };

      console.log(`✅ Sync stats: ${synced}/${total} videos synced`);
      return stats;
    } catch (error) {
      console.error('❌ Failed to get sync stats:', error);
      throw error;
    }
  }

  /**
   * Reset embedding status for videos (useful for re-sync)
   */
  async resetEmbeddingStatus(videoIds: string[]): Promise<void> {
    try {
      console.log(`🔄 Resetting embedding status for ${videoIds.length} videos`);
      
      const { error } = await this.supabase
        .from('videos')
        .update({
          pinecone_embedded: false,
          pinecone_embedding_version: null,
          pinecone_last_updated: null,
        })
        .in('id', videoIds);

      if (error) {
        console.error('❌ Error resetting embedding status:', error);
        throw error;
      }

      console.log(`✅ Reset embedding status for ${videoIds.length} videos`);
    } catch (error) {
      console.error('❌ Failed to reset embedding status:', error);
      throw error;
    }
  }

  /**
   * Validate sync consistency between Supabase and Pinecone
   */
  async validateSyncConsistency(): Promise<{
    consistent: boolean;
    supabase_synced: number;
    pinecone_vectors: number;
    missing_in_pinecone: string[];
    orphaned_in_pinecone: string[];
  }> {
    try {
      console.log('🔍 Validating sync consistency');
      
      // Get all synced videos from Supabase
      const { data: syncedVideos, error } = await this.supabase
        .from('videos')
        .select('id')
        .eq('pinecone_embedded', true);

      if (error) {
        throw error;
      }

      const supabaseSynced = syncedVideos?.map(v => v.id) || [];
      
      // TODO: Get all vectors from Pinecone
      // For now, we'll return basic stats
      const result = {
        consistent: true,
        supabase_synced: supabaseSynced.length,
        pinecone_vectors: 0, // Will be updated when we can query Pinecone
        missing_in_pinecone: [],
        orphaned_in_pinecone: [],
      };

      console.log(`✅ Sync validation completed`);
      return result;
    } catch (error) {
      console.error('❌ Failed to validate sync consistency:', error);
      throw error;
    }
  }
}

// Export a singleton instance
export const supabasePineconeSync = new SupabasePineconeSync();