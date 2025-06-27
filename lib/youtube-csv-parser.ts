/**
 * YouTube Reporting API CSV Parser
 * 
 * Parses the 4 core YouTube Reporting API CSV files and merges data 
 * by (video_id, date) to create comprehensive daily analytics records.
 * 
 * Core Reports:
 * - channel_basic_a2: Core daily metrics 
 * - channel_combined_a2: Enhanced with traffic sources and devices
 * - channel_demographics_a1: Age/gender audience composition
 * - channel_traffic_source_a2: Detailed traffic source analysis
 */

export interface YouTubeReportRow {
  date: string;
  channel_id: string;
  video_id: string;
  live_or_on_demand?: string;
  subscribed_status?: string;
  country_code?: string;
  device_type?: string;
  operating_system?: string;
  traffic_source_type?: string;
  traffic_source_detail?: string;
  views: number;
  watch_time_minutes: number;
  average_view_duration_seconds?: number;
  average_view_duration_percentage?: number;
  red_views?: number;
  red_watch_time_minutes?: number;
  // Demographics specific
  age_group?: string;
  gender?: string;
  // Additional metrics that may be available
  likes?: number;
  comments?: number;
  shares?: number;
  subscribers_gained?: number;
  subscribers_lost?: number;
  estimated_revenue?: number;
  estimated_ad_revenue?: number;
  cpm?: number;
  ad_impressions?: number;
  monetized_playbacks?: number;
}

export interface ParsedDailyAnalytics {
  video_id: string;
  date: string;
  views: number;
  estimated_minutes_watched: number;
  average_view_duration: number;
  average_view_percentage: number;
  red_views?: number;
  estimated_red_minutes_watched?: number;
  likes?: number;
  comments?: number;
  shares?: number;
  subscribers_gained?: number;
  subscribers_lost?: number;
  estimated_revenue?: number;
  estimated_ad_revenue?: number;
  cpm?: number;
  ad_impressions?: number;
  monetized_playbacks?: number;
  // Traffic sources
  search_views?: number;
  suggested_views?: number;
  external_views?: number;
  direct_views?: number;
  playlist_views?: number;
  // Device breakdown
  mobile_views?: number;
  desktop_views?: number;
  tablet_views?: number;
  tv_views?: number;
  // JSONB data
  country_views?: Record<string, number>;
  top_age_groups?: Record<string, number>;
  gender_breakdown?: Record<string, number>;
}

/**
 * Traffic source type mappings from YouTube Reporting API
 */
const TRAFFIC_SOURCE_TYPES = {
  0: 'unknown',
  1: 'advertising', 
  3: 'suggested', // YouTube suggested videos
  4: 'channel', // Direct channel access
  5: 'external', // External websites
  7: 'related_video', // Related video
  8: 'offline', // YouTube offline
  9: 'search', // Google/YouTube search
  11: 'playlist',
  14: 'notification',
  17: 'browse', // YouTube browse features
  18: 'channel_page',
  20: 'end_screen'
} as const;

/**
 * Device type mappings from YouTube Reporting API  
 */
const DEVICE_TYPES = {
  101: 'computer', // Desktop
  102: 'mobile', // Mobile phone
  103: 'tablet', // Tablet
  104: 'tv', // TV/Connected device
  105: 'game_console' // Game console
} as const;

/**
 * Parse CSV content into structured rows
 */
export function parseCSV(csvContent: string): YouTubeReportRow[] {
  const lines = csvContent.trim().split('\n');
  if (lines.length < 2) return [];
  
  const headers = lines[0].split(',');
  const rows: YouTubeReportRow[] = [];
  
  for (let i = 1; i < lines.length; i++) {
    const values = lines[i].split(',');
    if (values.length !== headers.length) continue;
    
    const row: any = {};
    headers.forEach((header, index) => {
      const value = values[index]?.trim();
      
      // Convert numeric fields
      if (['views', 'watch_time_minutes', 'average_view_duration_seconds', 
           'average_view_duration_percentage', 'red_views', 'red_watch_time_minutes',
           'likes', 'comments', 'shares', 'subscribers_gained', 'subscribers_lost',
           'estimated_revenue', 'estimated_ad_revenue', 'cpm', 'ad_impressions',
           'monetized_playbacks', 'device_type', 'traffic_source_type'].includes(header)) {
        row[header] = value && value !== '' ? parseFloat(value) : 0;
      } else {
        row[header] = value || '';
      }
    });
    
    rows.push(row as YouTubeReportRow);
  }
  
  return rows;
}

/**
 * Parse channel_basic_a2 report - Core daily metrics
 */
export function parseChannelBasic(csvContent: string, targetDate?: string): Map<string, ParsedDailyAnalytics> {
  const rows = parseCSV(csvContent);
  const analyticsMap = new Map<string, ParsedDailyAnalytics>();
  
  rows.forEach(row => {
    if (!row.video_id || row.video_id === 'CHANNEL_TOTAL') return;
    
    const finalDate = targetDate || row.date;
    const key = `${row.video_id}:${finalDate}`;
    const existing = analyticsMap.get(key) || {
      video_id: row.video_id,
      date: finalDate,
      views: 0,
      estimated_minutes_watched: 0,
      average_view_duration: 0,
      average_view_percentage: 0
    };
    
    // Aggregate core metrics
    existing.views += row.views || 0;
    existing.estimated_minutes_watched += row.watch_time_minutes || 0;
    existing.red_views = (existing.red_views || 0) + (row.red_views || 0);
    existing.estimated_red_minutes_watched = (existing.estimated_red_minutes_watched || 0) + (row.red_watch_time_minutes || 0);
    
    // Calculate weighted averages for duration metrics
    if (row.views > 0) {
      const totalViews = existing.views;
      existing.average_view_duration = (
        (existing.average_view_duration * (totalViews - row.views)) + 
        ((row.average_view_duration_seconds || 0) * row.views)
      ) / totalViews;
      
      existing.average_view_percentage = (
        (existing.average_view_percentage * (totalViews - row.views)) + 
        ((row.average_view_duration_percentage || 0) * row.views)
      ) / totalViews;
    }
    
    analyticsMap.set(key, existing);
  });
  
  return analyticsMap;
}

/**
 * Parse channel_combined_a2 report - Enhanced metrics with traffic sources and devices
 */
export function parseChannelCombined(csvContent: string, targetDate?: string): Map<string, Partial<ParsedDailyAnalytics>> {
  const rows = parseCSV(csvContent);
  const analyticsMap = new Map<string, Partial<ParsedDailyAnalytics>>();
  
  rows.forEach(row => {
    if (!row.video_id || row.video_id === 'CHANNEL_TOTAL') return;
    
    const finalDate = targetDate || row.date;
    const key = `${row.video_id}:${finalDate}`;
    const existing = analyticsMap.get(key) || {
      video_id: row.video_id,
      date: finalDate,
      country_views: {}
    };
    
    // Aggregate country views
    if (row.country_code && row.views > 0) {
      existing.country_views = existing.country_views || {};
      existing.country_views[row.country_code] = (existing.country_views[row.country_code] || 0) + row.views;
    }
    
    // Aggregate device views
    if (row.device_type && row.views > 0) {
      const deviceType = DEVICE_TYPES[row.device_type as keyof typeof DEVICE_TYPES];
      if (deviceType === 'computer') {
        existing.desktop_views = (existing.desktop_views || 0) + row.views;
      } else if (deviceType === 'mobile') {
        existing.mobile_views = (existing.mobile_views || 0) + row.views;
      } else if (deviceType === 'tablet') {
        existing.tablet_views = (existing.tablet_views || 0) + row.views;
      } else if (deviceType === 'tv') {
        existing.tv_views = (existing.tv_views || 0) + row.views;
      }
    }
    
    analyticsMap.set(key, existing);
  });
  
  return analyticsMap;
}

/**
 * Parse channel_demographics_a1 report - Age/gender audience composition  
 */
export function parseChannelDemographics(csvContent: string, targetDate?: string): Map<string, Partial<ParsedDailyAnalytics>> {
  const rows = parseCSV(csvContent);
  const analyticsMap = new Map<string, Partial<ParsedDailyAnalytics>>();
  
  rows.forEach(row => {
    if (!row.video_id || row.video_id === 'CHANNEL_TOTAL') return;
    
    const finalDate = targetDate || row.date;
    const key = `${row.video_id}:${finalDate}`;
    const existing = analyticsMap.get(key) || {
      video_id: row.video_id,
      date: finalDate,
      top_age_groups: {},
      gender_breakdown: {}
    };
    
    // Aggregate age groups
    if (row.age_group && row.views > 0) {
      existing.top_age_groups = existing.top_age_groups || {};
      existing.top_age_groups[row.age_group] = (existing.top_age_groups[row.age_group] || 0) + row.views;
    }
    
    // Aggregate gender breakdown
    if (row.gender && row.views > 0) {
      existing.gender_breakdown = existing.gender_breakdown || {};
      existing.gender_breakdown[row.gender] = (existing.gender_breakdown[row.gender] || 0) + row.views;
    }
    
    analyticsMap.set(key, existing);
  });
  
  return analyticsMap;
}

/**
 * Parse channel_traffic_source_a2 report - Detailed traffic source analysis
 */
export function parseChannelTrafficSource(csvContent: string, targetDate?: string): Map<string, Partial<ParsedDailyAnalytics>> {
  const rows = parseCSV(csvContent);
  const analyticsMap = new Map<string, Partial<ParsedDailyAnalytics>>();
  
  rows.forEach(row => {
    if (!row.video_id || row.video_id === 'CHANNEL_TOTAL') return;
    
    const finalDate = targetDate || row.date;
    const key = `${row.video_id}:${finalDate}`;
    const existing = analyticsMap.get(key) || {
      video_id: row.video_id,
      date: finalDate
    };
    
    // Map traffic source types to our schema
    if (row.traffic_source_type && row.views > 0) {
      const sourceType = TRAFFIC_SOURCE_TYPES[row.traffic_source_type as keyof typeof TRAFFIC_SOURCE_TYPES];
      
      switch (sourceType) {
        case 'search':
          existing.search_views = (existing.search_views || 0) + row.views;
          break;
        case 'suggested':
          existing.suggested_views = (existing.suggested_views || 0) + row.views;
          break;
        case 'external':
          existing.external_views = (existing.external_views || 0) + row.views;
          break;
        case 'channel':
        case 'channel_page':
          existing.direct_views = (existing.direct_views || 0) + row.views;
          break;
        case 'playlist':
          existing.playlist_views = (existing.playlist_views || 0) + row.views;
          break;
      }
    }
    
    analyticsMap.set(key, existing);
  });
  
  return analyticsMap;
}

/**
 * Merge all parsed report data into complete analytics records
 */
export function mergeReportData(
  basicData: Map<string, ParsedDailyAnalytics>,
  combinedData: Map<string, Partial<ParsedDailyAnalytics>>,
  demographicsData: Map<string, Partial<ParsedDailyAnalytics>>,
  trafficSourceData: Map<string, Partial<ParsedDailyAnalytics>>
): ParsedDailyAnalytics[] {
  const mergedResults: ParsedDailyAnalytics[] = [];
  
  // Start with basic data as foundation
  basicData.forEach((basic, key) => {
    const combined = combinedData.get(key) || {};
    const demographics = demographicsData.get(key) || {};
    const trafficSource = trafficSourceData.get(key) || {};
    
    const merged: ParsedDailyAnalytics = {
      ...basic,
      ...combined,
      ...demographics,
      ...trafficSource
    };
    
    mergedResults.push(merged);
  });
  
  return mergedResults;
}

/**
 * Parse all 4 core YouTube Reporting API CSV files and return merged analytics data
 */
export async function parseYouTubeReports(
  basicCSV: string,
  combinedCSV: string,
  demographicsCSV: string,
  trafficSourceCSV: string,
  targetDate?: string
): Promise<ParsedDailyAnalytics[]> {
  try {
    console.log('🔄 Parsing YouTube Reporting API CSV files...');
    
    // Parse each report type
    const basicData = parseChannelBasic(basicCSV, targetDate);
    console.log(`📊 Parsed ${basicData.size} basic analytics records`);
    
    const combinedData = parseChannelCombined(combinedCSV, targetDate);
    console.log(`📊 Parsed ${combinedData.size} combined analytics records`);
    
    const demographicsData = parseChannelDemographics(demographicsCSV, targetDate);
    console.log(`📊 Parsed ${demographicsData.size} demographics records`);
    
    const trafficSourceData = parseChannelTrafficSource(trafficSourceCSV, targetDate);
    console.log(`📊 Parsed ${trafficSourceData.size} traffic source records`);
    
    // Merge all data
    const mergedResults = mergeReportData(basicData, combinedData, demographicsData, trafficSourceData);
    console.log(`✅ Merged into ${mergedResults.length} complete analytics records`);
    
    return mergedResults;
  } catch (error) {
    console.error('❌ Error parsing YouTube reports:', error);
    throw new Error(`Failed to parse YouTube reports: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}