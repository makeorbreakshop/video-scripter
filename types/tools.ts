/**
 * Type definitions for Agentic Mode tools
 */

// Core types
export type VideoID = string;
export type ChannelID = string;
export type TopicClusterID = string;

// Search filters for various tools
export interface SearchFilters {
  dateRange?: {
    start?: Date;
    end?: Date;
  };
  niches?: string[];
  channels?: ChannelID[];
  minTPS?: number;
  maxTPS?: number;
  excludeShorts?: boolean;
  limit?: number;
}

// Standard tool response wrapper
export interface ToolResponse<T> {
  success: boolean;
  data?: T;
  error?: ToolError;
  metadata?: {
    cached?: boolean;
    executionTime?: number;
    source?: string;
  };
}

// Error handling
export interface ToolError {
  code: string;
  message: string;
  details?: any;
  retryable?: boolean;
}

// Tool configuration
export interface ToolConfig {
  name: string;
  description: string;
  parameters: Record<string, any>; // JSON Schema
  handler: ToolHandler;
  parallelSafe?: boolean;
  cacheTTL?: number; // in seconds
  timeout?: number; // in milliseconds
  retryConfig?: {
    maxRetries?: number;
    backoffMs?: number;
  };
}

// Tool handler function type
export type ToolHandler = (
  params: any,
  context?: ToolContext
) => Promise<ToolResponse<any>>;

// Context passed to tools
export interface ToolContext {
  requestId?: string;
  userId?: string;
  mode?: 'classic' | 'agentic';
  cache?: CacheInterface;
  logger?: LoggerInterface;
}

// Cache interface
export interface CacheInterface {
  get(key: string): Promise<any | null>;
  set(key: string, value: any, ttl?: number): Promise<void>;
  delete(key: string): Promise<void>;
  exists(key: string): Promise<boolean>;
}

// Logger interface
export interface LoggerInterface {
  debug(message: string, data?: any): void;
  info(message: string, data?: any): void;
  warn(message: string, data?: any): void;
  error(message: string, error?: any): void;
}

// Video bundle response
export interface VideoBundle {
  id: VideoID;
  title: string;
  channel_id: ChannelID;
  channel_name: string;
  view_count: number;
  published_at: string;
  temporal_performance_score: number | null;
  channel_baseline_at_publish: number | null;
  is_short: boolean;
  format_type: string | null;
  topic_niche: string | null;
  topic_cluster_id: TopicClusterID | null;
  thumbnail_url: string | null;
  summary: string | null;
  tags?: string[];
  duration?: number;
}

// Channel baseline response
export interface ChannelBaseline {
  channel_id: ChannelID;
  baseline_value: number;
  sample_videos: {
    id: VideoID;
    title: string;
    view_count: number;
    temporal_performance_score: number;
  }[];
  calculated_at: string;
}

// Performance snapshot
export interface PerformanceSnapshot {
  video_id: VideoID;
  temporal_performance_score: number;
  curve_shape?: 'early_spike' | 'slow_burn' | 'steady_growth' | 'viral' | 'declining';
  performance_category: 'viral' | 'outperforming' | 'above_average' | 'standard' | 'below_average' | 'poor';
}

// Search result
export interface SearchResult {
  video_id: VideoID;
  similarity_score: number;
  metadata?: Record<string, any>;
}

// Tool execution metrics
export interface ToolMetrics {
  tool_name: string;
  execution_time_ms: number;
  cache_hit: boolean;
  error_occurred: boolean;
  retry_count: number;
  payload_size_bytes?: number;
}