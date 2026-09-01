/**
 * Fast Temporal Baseline Processor
 * 
 * Direct database approach for calculating temporal baselines
 * Uses median Day 30 estimates as documented in TEMPORAL-PERFORMANCE-SCORE-SYSTEM.md
 * ~26 videos/second vs 0.02 videos/second with SQL functions
 */

import pg from 'pg';
import { createClient } from '@supabase/supabase-js';
import { day30Estimate, rawBaselineAt, baselineRatio, temporalScore } from './baselines/core';

const { Pool } = pg;

export class TemporalBaselineProcessor {
  private pool: Pool | null = null;
  private envelopes: Map<number, number> = new Map();

  constructor() {
    // Initialize direct database connection for bulk operations
    if (process.env.DATABASE_URL && typeof window === 'undefined') {
      this.pool = new Pool({
        connectionString: process.env.DATABASE_URL,
        ssl: { rejectUnauthorized: false }
      });
    }
  }

  /**
   * Calculate median of an array of numbers
   */
  private calculateMedian(values: number[]): number {
    if (values.length === 0) return 1;
    
    const sorted = [...values].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    
    if (sorted.length % 2 === 0) {
      return (sorted[mid - 1] + sorted[mid]) / 2;
    } else {
      return sorted[mid];
    }
  }

  /**
   * Get Day 30 estimate for a video using closest snapshot or curve-based backfill
   */
  private getDay30Estimate(video: any, snapshots: Map<string, any[]>): number {
    return day30Estimate(video.view_count, video.age_days, snapshots.get(video.id) || [], this.envelopes);
  }

  /**
   * Calculate temporal baseline for a video based on previous videos
   */
  private calculateTemporalBaseline(
    currentVideo: any, 
    allVideos: any[], 
    currentIndex: number
  ): number {
    return rawBaselineAt(allVideos, currentIndex);
  }

  /**
   * Load performance envelopes from database
   */
  private async loadEnvelopes(): Promise<void> {
    if (!this.pool) return;
    
    const result = await this.pool.query(`
      SELECT day_since_published, p50_views 
      FROM performance_envelopes 
      WHERE day_since_published <= 365
      ORDER BY day_since_published
    `);
    
    this.envelopes.clear();
    for (const row of result.rows) {
      this.envelopes.set(row.day_since_published, parseFloat(row.p50_views));
    }
    
    console.log(`📊 Loaded ${this.envelopes.size} performance envelope points`);
  }

  /**
   * Process temporal baselines for recently imported videos
   * Uses direct database connection for optimal performance
   */
  async processRecentVideos(videoCount: number): Promise<{ success: boolean; processedVideos: number; error?: string }> {
    if (!this.pool) {
      console.log('⚠️ No direct database connection available, skipping baseline processing');
      return { success: false, processedVideos: 0, error: 'No database connection' };
    }

    // Always use direct database for proper calculation
    return this.processWithDirectDB(videoCount);
  }

  /**
   * Direct database processing - Uses proper median Day 30 calculation
   */
  private async processWithDirectDB(videoCount: number): Promise<{ success: boolean; processedVideos: number; error?: string }> {
    if (!this.pool) {
      throw new Error('Direct database connection not available');
    }

    try {
      console.log(`🚀 Processing ${videoCount} videos with median Day 30 baseline calculation`);
      
      // Load performance envelopes if not already loaded
      if (this.envelopes.size === 0) {
        await this.loadEnvelopes();
      }
      
      // Get recently imported videos that need baseline processing
      const query = `
        SELECT 
          v.id,
          v.channel_id,
          v.published_at,
          v.view_count,
          DATE_PART('day', NOW() - v.published_at) as age_days
        FROM videos v
        WHERE v.is_short = false
        AND (v.channel_baseline_at_publish IS NULL OR v.channel_baseline_at_publish = 1.0)
        AND v.temporal_performance_score IS NULL
        ORDER BY v.created_at DESC
        LIMIT $1;
      `;
      
      const result = await this.pool.query(query, [videoCount]);
      const newVideos = result.rows;
      
      if (newVideos.length === 0) {
        console.log('✅ No videos need baseline processing');
        return { success: true, processedVideos: 0 };
      }

      // Group by channel for proper chronological processing
      const videosByChannel = new Map<string, any[]>();
      for (const video of newVideos) {
        if (!videosByChannel.has(video.channel_id)) {
          videosByChannel.set(video.channel_id, []);
        }
        videosByChannel.get(video.channel_id)!.push(video);
      }

      let totalProcessed = 0;
      const allUpdates = [];

      // Process each channel's videos
      for (const [channelId, channelNewVideos] of videosByChannel) {
        // Get ALL videos for this channel (not just new ones) for proper baseline calculation
        const allChannelVideosResult = await this.pool.query(`
          SELECT id, published_at, view_count,
                 DATE_PART('day', NOW() - published_at) as age_days
          FROM videos
          WHERE channel_id = $1 AND is_short = false
          ORDER BY published_at
        `, [channelId]);
        
        const allChannelVideos = allChannelVideosResult.rows;
        
        // Get all snapshots for this channel's videos
        const videoIds = allChannelVideos.map(v => v.id);
        const snapshotResult = await this.pool.query(`
          SELECT video_id, view_count, days_since_published
          FROM view_snapshots
          WHERE video_id = ANY($1::text[])
          ORDER BY video_id, days_since_published
        `, [videoIds]);
        
        // Organize snapshots by video_id
        const snapshots = new Map<string, any[]>();
        snapshotResult.rows.forEach(s => {
          if (!snapshots.has(s.video_id)) {
            snapshots.set(s.video_id, []);
          }
          snapshots.get(s.video_id)!.push({
            view_count: parseFloat(s.view_count),
            days_since_published: parseInt(s.days_since_published)
          });
        });

        // First pass: Calculate Day 30 estimates for ALL videos
        for (const video of allChannelVideos) {
          video.age_days = parseFloat(video.age_days);
          video.view_count = parseFloat(video.view_count);
          video.day30_estimate = this.getDay30Estimate(video, snapshots);
        }
        
        // Second pass: Process only the NEW videos that need baselines
        for (const newVideo of channelNewVideos) {
          // Find this video's position in the full chronological list
          const videoIndex = allChannelVideos.findIndex(v => v.id === newVideo.id);
          if (videoIndex === -1) continue;
          
          const video = allChannelVideos[videoIndex];
          
          // UNIFIED CONVENTION (2026-09-01): store the dimensionless ratio,
          // score = day30 / (ratio * globalP50Day30) == day30 / rawMedian.
          const rawBaseline = this.calculateTemporalBaseline(video, allChannelVideos, videoIndex);
          const ratio = baselineRatio(rawBaseline, this.envelopes);
          const score = temporalScore(video.day30_estimate, ratio, this.envelopes);

          allUpdates.push({
            id: video.id,
            baseline: Number(ratio),
            score: Number(score)
          });
        }
      }

      // Batch update all videos
      if (allUpdates.length > 0) {
        // Split into chunks to avoid parameter limit
        const CHUNK_SIZE = 500;
        for (let i = 0; i < allUpdates.length; i += CHUNK_SIZE) {
          const chunk = allUpdates.slice(i, i + CHUNK_SIZE);
          const values = chunk.map((u, idx) => 
            `($${idx*3+1}, $${idx*3+2}::numeric, $${idx*3+3}::numeric)`
          ).join(',');
          
          const params = chunk.flatMap(u => [u.id, Number(u.baseline), Number(u.score)]);
          
          await this.pool.query(`
            UPDATE videos v
            SET channel_baseline_at_publish = u.baseline,
                temporal_performance_score = u.score
            FROM (VALUES ${values}) AS u(id, baseline, score)
            WHERE v.id = u.id
          `, params);
        }
        
        totalProcessed = allUpdates.length;
        console.log(`✅ Processed ${totalProcessed} videos with correct median Day 30 baselines`);
      }
      
      return { success: true, processedVideos: totalProcessed };
      
    } catch (error) {
      console.error('❌ Direct database processing failed:', error);
      return { 
        success: false, 
        processedVideos: 0, 
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }


  /**
   * Cleanup resources
   */
  async close(): Promise<void> {
    if (this.pool) {
      await this.pool.end();
      this.pool = null;
    }
  }
}