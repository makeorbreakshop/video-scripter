/**
 * Analytics Database Service
 * 
 * Handles bulk upsert operations for daily analytics data from YouTube Reporting API.
 * Provides conflict resolution, validation, and error handling for database operations.
 */

import { supabase as supabaseClient } from '@/lib/supabase-client';
import type { ParsedDailyAnalytics } from './youtube-csv-parser.ts';
import type { ParsedAnalyticsData } from './youtube-analytics-api.ts';

export interface UpsertResult {
  success: boolean;
  recordsProcessed: number;
  recordsCreated: number;
  recordsUpdated: number;
  errors: string[];
  summary: {
    dateRange: string;
    videosAffected: string[];
    totalViews: number;
    totalWatchTime: number;
  };
}

export interface AnalyticsRecord {
  id?: string;
  video_id: string;
  date: string;
  views: number;
  engaged_views?: number;
  red_views?: number;
  viewer_percentage?: number;
  estimated_minutes_watched?: number;
  estimated_red_minutes_watched?: number;
  average_view_duration?: number;
  average_view_percentage?: number;
  likes?: number;
  dislikes?: number;
  comments?: number;
  shares?: number;
  subscribers_gained?: number;
  subscribers_lost?: number;
  estimated_revenue?: number;
  estimated_ad_revenue?: number;
  estimated_red_partner_revenue?: number;
  gross_revenue?: number;
  cpm?: number;
  ad_impressions?: number;
  monetized_playbacks?: number;
  search_views?: number;
  suggested_views?: number;
  external_views?: number;
  direct_views?: number;
  playlist_views?: number;
  country_views?: Record<string, number>;
  mobile_views?: number;
  desktop_views?: number;
  tablet_views?: number;
  tv_views?: number;
  audience_retention?: Record<string, any>;
  top_age_groups?: Record<string, number>;
  gender_breakdown?: Record<string, number>;
  end_screen_element_clicks?: number;
  card_impressions?: number;
  card_clicks?: number;
  card_click_rate?: number;
  created_at?: string;
  updated_at?: string;
}

/**
 * Analytics Database Service Class
 */
export class AnalyticsDbService {
  private supabase = supabaseClient;

  /**
   * Validate that video_id exists in videos table
   */
  async validateVideoIds(videoIds: string[]): Promise<{ valid: string[], invalid: string[] }> {
    try {
      const { data: existingVideos, error } = await this.supabase
        .from('videos')
        .select('id')
        .in('id', videoIds);

      if (error) {
        throw new Error(`Failed to validate video IDs: ${error.message}`);
      }

      const validIds = existingVideos?.map(v => v.id) || [];
      const invalidIds = videoIds.filter(id => !validIds.includes(id));

      return { valid: validIds, invalid: invalidIds };
    } catch (error) {
      console.error('❌ Error validating video IDs:', error);
      throw error;
    }
  }

  /**
   * Transform parsed analytics data to database schema (supports both formats)
   */
  transformToDbRecord(parsed: ParsedDailyAnalytics | ParsedAnalyticsData): AnalyticsRecord {
    return {
      video_id: parsed.video_id,
      date: parsed.date,
      views: parsed.views || 0,
      estimated_minutes_watched: Math.round(parsed.estimated_minutes_watched || 0),
      estimated_red_minutes_watched: Math.round(parsed.estimated_red_minutes_watched || 0),
      average_view_duration: parsed.average_view_duration || null,
      average_view_percentage: parsed.average_view_percentage || null,
      red_views: parsed.red_views || null,
      likes: parsed.likes || null,
      comments: parsed.comments || null,
      shares: parsed.shares || null,
      subscribers_gained: parsed.subscribers_gained || null,
      subscribers_lost: parsed.subscribers_lost || null,
      estimated_revenue: parsed.estimated_revenue || null,
      estimated_ad_revenue: parsed.estimated_ad_revenue || null,
      cpm: parsed.cpm || null,
      ad_impressions: parsed.ad_impressions || null,
      monetized_playbacks: parsed.monetized_playbacks || null,
      search_views: parsed.search_views || null,
      suggested_views: parsed.suggested_views || null,
      external_views: parsed.external_views || null,
      direct_views: parsed.direct_views || null,
      playlist_views: parsed.playlist_views || null,
      mobile_views: parsed.mobile_views || null,
      desktop_views: parsed.desktop_views || null,
      tablet_views: parsed.tablet_views || null,
      tv_views: parsed.tv_views || null,
      // JSONB fields
      country_views: parsed.country_views && Object.keys(parsed.country_views).length > 0 ? parsed.country_views : null,
      top_age_groups: parsed.top_age_groups && Object.keys(parsed.top_age_groups).length > 0 ? parsed.top_age_groups : null,
      gender_breakdown: parsed.gender_breakdown && Object.keys(parsed.gender_breakdown).length > 0 ? parsed.gender_breakdown : null,
    };
  }

  /**
   * Bulk upsert analytics records with conflict resolution (supports both data formats)
   */
  async bulkUpsertAnalytics(parsedData: (ParsedDailyAnalytics | ParsedAnalyticsData)[]): Promise<UpsertResult> {
    const result: UpsertResult = {
      success: false,
      recordsProcessed: 0,
      recordsCreated: 0,
      recordsUpdated: 0,
      errors: [],
      summary: {
        dateRange: '',
        videosAffected: [],
        totalViews: 0,
        totalWatchTime: 0
      }
    };

    try {
      console.log(`🔄 Processing ${parsedData.length} analytics records for upsert...`);

      if (parsedData.length === 0) {
        result.success = true;
        return result;
      }

      // Validate video IDs first
      const videoIds = [...new Set(parsedData.map(d => d.video_id))];
      const { valid: validVideoIds, invalid: invalidVideoIds } = await this.validateVideoIds(videoIds);

      if (invalidVideoIds.length > 0) {
        result.errors.push(`Invalid video IDs: ${invalidVideoIds.join(', ')}`);
        console.warn(`⚠️ Skipping ${invalidVideoIds.length} records with invalid video IDs`);
      }

      // Filter to only valid video IDs
      const validData = parsedData.filter(d => validVideoIds.includes(d.video_id));
      
      if (validData.length === 0) {
        result.errors.push('No valid video IDs found in data');
        return result;
      }

      // Transform to database records
      const dbRecords = validData.map(d => this.transformToDbRecord(d));

      // Calculate summary statistics
      const dates = validData.map(d => d.date).sort();
      result.summary.dateRange = dates.length > 0 ? `${dates[0]} to ${dates[dates.length - 1]}` : '';
      result.summary.videosAffected = validVideoIds;
      result.summary.totalViews = validData.reduce((sum, d) => sum + (d.views || 0), 0);
      result.summary.totalWatchTime = validData.reduce((sum, d) => sum + (d.estimated_minutes_watched || 0), 0);

      console.log(`📊 Upserting ${dbRecords.length} valid records...`);
      console.log(`📊 Date range: ${result.summary.dateRange}`);
      console.log(`📊 Videos affected: ${result.summary.videosAffected.length}`);

      // Perform bulk upsert in batches to avoid memory issues
      const batchSize = 100;
      let totalProcessed = 0;
      let totalCreated = 0;
      let totalUpdated = 0;

      for (let i = 0; i < dbRecords.length; i += batchSize) {
        const batch = dbRecords.slice(i, i + batchSize);
        
        try {
          // Check existing records in this batch
          const batchKeys = batch.map(r => ({ video_id: r.video_id, date: r.date }));
          const { data: existingRecords } = await this.supabase
            .from('daily_analytics')
            .select('video_id, date')
            .or(batchKeys.map(k => `and(video_id.eq.${k.video_id},date.eq.${k.date})`).join(','));

          const existingKeys = new Set(existingRecords?.map(r => `${r.video_id}:${r.date}`) || []);

          // Separate into creates and updates
          const creates = batch.filter(r => !existingKeys.has(`${r.video_id}:${r.date}`));
          const updates = batch.filter(r => existingKeys.has(`${r.video_id}:${r.date}`));

          // Insert new records
          if (creates.length > 0) {
            const { error: insertError } = await this.supabase
              .from('daily_analytics')
              .insert(creates);

            if (insertError) {
              throw new Error(`Insert error: ${insertError.message}`);
            }
            totalCreated += creates.length;
            console.log(`✅ Inserted ${creates.length} new records`);
          }

          // Update existing records
          for (const update of updates) {
            const { error: updateError } = await this.supabase
              .from('daily_analytics')
              .update({ ...update, updated_at: new Date().toISOString() })
              .eq('video_id', update.video_id)
              .eq('date', update.date);

            if (updateError) {
              console.error(`❌ Update error for ${update.video_id}:${update.date}:`, updateError.message);
              result.errors.push(`Update failed for ${update.video_id}:${update.date}: ${updateError.message}`);
            } else {
              totalUpdated++;
            }
          }

          totalProcessed += batch.length;
          console.log(`🔄 Processed batch ${Math.ceil((i + batch.length) / batchSize)}/${Math.ceil(dbRecords.length / batchSize)}`);

        } catch (batchError) {
          console.error(`❌ Batch error:`, batchError);
          result.errors.push(`Batch processing error: ${batchError instanceof Error ? batchError.message : 'Unknown error'}`);
        }
      }

      result.recordsProcessed = totalProcessed;
      result.recordsCreated = totalCreated;
      result.recordsUpdated = totalUpdated;
      result.success = result.errors.length === 0 || (totalCreated + totalUpdated) > 0;

      console.log(`✅ Upsert complete: ${totalCreated} created, ${totalUpdated} updated`);
      console.log(`📊 Total views processed: ${result.summary.totalViews.toLocaleString()}`);
      console.log(`📊 Total watch time: ${Math.round(result.summary.totalWatchTime).toLocaleString()} minutes`);

      if (result.errors.length > 0) {
        console.warn(`⚠️ ${result.errors.length} errors occurred during upsert`);
      }

      return result;

    } catch (error) {
      console.error('❌ Critical error during bulk upsert:', error);
      result.errors.push(`Critical error: ${error instanceof Error ? error.message : 'Unknown error'}`);
      return result;
    }
  }

  /**
   * Get analytics data for a specific video and date range
   */
  async getAnalytics(videoId: string, startDate: string, endDate: string): Promise<AnalyticsRecord[]> {
    try {
      const { data, error } = await this.supabase
        .from('daily_analytics')
        .select('*')
        .eq('video_id', videoId)
        .gte('date', startDate)
        .lte('date', endDate)
        .order('date', { ascending: true });

      if (error) {
        throw new Error(`Failed to fetch analytics: ${error.message}`);
      }

      return data || [];
    } catch (error) {
      console.error('❌ Error fetching analytics:', error);
      throw error;
    }
  }

  /**
   * Get summary statistics for all analytics data
   */
  async getAnalyticsSummary(): Promise<{
    totalRecords: number;
    dateRange: { start: string; end: string } | null;
    totalVideos: number;
    totalViews: number;
    totalWatchTime: number;
  }> {
    try {
      const { data, error } = await this.supabase
        .from('daily_analytics')
        .select('date, video_id, views, estimated_minutes_watched');

      if (error) {
        throw new Error(`Failed to fetch analytics summary: ${error.message}`);
      }

      if (!data || data.length === 0) {
        return {
          totalRecords: 0,
          dateRange: null,
          totalVideos: 0,
          totalViews: 0,
          totalWatchTime: 0
        };
      }

      const dates = data.map(d => d.date).sort();
      const uniqueVideos = new Set(data.map(d => d.video_id));

      return {
        totalRecords: data.length,
        dateRange: { start: dates[0], end: dates[dates.length - 1] },
        totalVideos: uniqueVideos.size,
        totalViews: data.reduce((sum, d) => sum + (d.views || 0), 0),
        totalWatchTime: data.reduce((sum, d) => sum + (d.estimated_minutes_watched || 0), 0)
      };
    } catch (error) {
      console.error('❌ Error fetching analytics summary:', error);
      throw error;
    }
  }
}