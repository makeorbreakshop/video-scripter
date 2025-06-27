/**
 * TypeScript interfaces for YouTube Dashboard components
 */

export interface VideoAnalytics {
  video_id: string;
  title: string;
  published_at: string;
  views: number;
  ctr?: number;
  retention_avg?: number;
  likes?: number;
  comments?: number;
  trend_direction: 'up' | 'down' | 'stable';
  trend_percentage: number;
}

export interface ChannelOverview {
  totalViews: number;
  totalLikes: number;
  totalComments: number;
  averageRetention: number;
  trendViews: number;
  trendCTR: number;
  trendRetention: number;
  watchHours: number;
  dailyAverage: number;
  lifetimeViews: number;
  lifetimeLikes: number;
  channelAverage: number;
  daysOfData: number;
  lastUpdated: string;
}

export interface ChartData {
  date: string;
  views: number;
  ctr?: number;
  retention?: number;
  likes?: number;
  comments?: number;
}

export interface ExportOptions {
  format: 'csv' | 'json';
  dateRange: {
    from: Date;
    to: Date;
  };
  includeMetrics: {
    views: boolean;
    ctr: boolean;
    retention: boolean;
    likes: boolean;
    comments: boolean;
  };
  selectedVideos?: string[];
}

export interface BackfillProgress {
  total: number;
  processed: number;
  currentVideo: string;
  errors: string[];
  isRunning: boolean;
}