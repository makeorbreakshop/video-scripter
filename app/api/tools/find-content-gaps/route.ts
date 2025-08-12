/**
 * API endpoint for find_content_gaps tool
 * Identifies untried formats and topics by analyzing what's missing from channel history
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { ToolResponse } from '@/types/tools';
import { wrapTool, createToolContext } from '@/lib/tools/base-wrapper';

// Initialize Supabase client
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

interface ContentGapsParams {
  channel_id: string;
  compare_to_competitors?: boolean;
  competitor_channel_ids?: string[];
  min_competitor_tps?: number;
  days_back?: number;
}

interface FormatGap {
  format_type: string;
  never_tried: boolean;
  last_tried_days_ago: number | null;
  competitor_success_rate: number;
  avg_competitor_tps: number;
  example_competitors: Array<{
    channel_id: string;
    channel_name: string;
    video_count: number;
    avg_tps: number;
  }>;
}

interface TopicGap {
  topic_niche: string;
  topic_cluster_id: number | null;
  never_tried: boolean;
  last_tried_days_ago: number | null;
  competitor_success_rate: number;
  avg_competitor_tps: number;
  example_competitors: Array<{
    channel_id: string;
    channel_name: string;
    video_count: number;
    avg_tps: number;
  }>;
}

interface ContentGapsResponse {
  channel_id: string;
  analysis_scope: {
    days_back: number;
    compared_competitors: number;
    min_competitor_tps: number;
  };
  format_gaps: FormatGap[];
  topic_gaps: TopicGap[];
  recommendations: {
    high_priority_formats: string[];
    high_priority_topics: string[];
    format_reasoning: string[];
    topic_reasoning: string[];
  };
  total_gaps_found: number;
}

/**
 * Find content gaps for a channel
 */
async function findContentGapsHandler(
  params: ContentGapsParams,
  context?: any
): Promise<ToolResponse<ContentGapsResponse>> {
  const {
    channel_id,
    compare_to_competitors = true,
    competitor_channel_ids = [],
    min_competitor_tps = 2.0,
    days_back = 180
  } = params;
  
  // Validate inputs
  if (!channel_id) {
    return {
      success: false,
      error: {
        code: 'INVALID_PARAMS',
        message: 'channel_id is required'
      }
    };
  }
  
  try {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - days_back);
    
    // Get channel's content history
    const { data: channelVideos, error: channelError } = await supabase
      .from('videos')
      .select('format_type, topic_niche, topic_cluster_id, published_at, temporal_performance_score')
      .eq('channel_id', channel_id)
      .eq('is_short', false)
      .gte('published_at', cutoffDate.toISOString());
    
    if (channelError) {
      throw new Error(`Failed to fetch channel videos: ${channelError.message}`);
    }
    
    const channelHistory = channelVideos || [];
    
    // Get competitor data if requested
    let competitorVideos: any[] = [];
    let actualCompetitorIds = competitor_channel_ids;
    
    if (compare_to_competitors) {
      if (competitor_channel_ids.length === 0) {
        // Auto-discover competitors based on similar topic niches
        const channelTopics = [...new Set(channelHistory
          .map(v => v.topic_niche)
          .filter(t => t !== null))]
          .slice(0, 5); // Top 5 topics
        
        if (channelTopics.length > 0) {
          const { data: discoveredCompetitors, error: competitorError } = await supabase
            .from('videos')
            .select('channel_id, channel_name')
            .in('topic_niche', channelTopics)
            .neq('channel_id', channel_id)
            .gte('temporal_performance_score', min_competitor_tps)
            .gte('published_at', cutoffDate.toISOString())
            .eq('is_short', false);
          
          if (!competitorError && discoveredCompetitors) {
            const channelCounts = new Map();
            discoveredCompetitors.forEach(v => {
              channelCounts.set(v.channel_id, (channelCounts.get(v.channel_id) || 0) + 1);
            });
            
            // Take top 10 most active competitors
            actualCompetitorIds = Array.from(channelCounts.entries())
              .sort(([,a], [,b]) => b - a)
              .slice(0, 10)
              .map(([channelId]) => channelId);
          }
        }
      }
      
      if (actualCompetitorIds.length > 0) {
        const { data: fetchedCompetitors, error: fetchError } = await supabase
          .from('videos')
          .select('*')
          .in('channel_id', actualCompetitorIds)
          .gte('temporal_performance_score', min_competitor_tps)
          .gte('published_at', cutoffDate.toISOString())
          .eq('is_short', false)
          .order('temporal_performance_score', { ascending: false })
          .limit(1000);
        
        if (!fetchError) {
          competitorVideos = fetchedCompetitors || [];
        }
      }
    }
    
    // Analyze format gaps
    const channelFormats = new Set(channelHistory
      .map(v => v.format_type)
      .filter(f => f !== null));
    
    const competitorFormats = new Map<string, any[]>();
    competitorVideos.forEach(v => {
      if (v.format_type) {
        if (!competitorFormats.has(v.format_type)) {
          competitorFormats.set(v.format_type, []);
        }
        competitorFormats.get(v.format_type)!.push(v);
      }
    });
    
    const formatGaps: FormatGap[] = [];
    
    competitorFormats.forEach((videos, format) => {
      const neverTried = !channelFormats.has(format);
      let lastTriedDaysAgo = null;
      
      if (!neverTried) {
        const lastChannelVideo = channelHistory
          .filter(v => v.format_type === format)
          .sort((a, b) => new Date(b.published_at).getTime() - new Date(a.published_at).getTime())[0];
        
        if (lastChannelVideo) {
          lastTriedDaysAgo = Math.floor(
            (Date.now() - new Date(lastChannelVideo.published_at).getTime()) / (1000 * 60 * 60 * 24)
          );
        }
      }
      
      // Calculate competitor success metrics
      const successfulVideos = videos.filter(v => v.temporal_performance_score >= min_competitor_tps);
      const successRate = successfulVideos.length / videos.length;
      const avgTps = videos.reduce((sum, v) => sum + v.temporal_performance_score, 0) / videos.length;
      
      // Get example competitors
      const channelStats = new Map<string, { name: string; videos: any[] }>();
      videos.forEach(v => {
        if (!channelStats.has(v.channel_id)) {
          channelStats.set(v.channel_id, { name: v.channel_name, videos: [] });
        }
        channelStats.get(v.channel_id)!.videos.push(v);
      });
      
      const exampleCompetitors = Array.from(channelStats.entries())
        .map(([channelId, data]) => ({
          channel_id: channelId,
          channel_name: data.name,
          video_count: data.videos.length,
          avg_tps: data.videos.reduce((sum, v) => sum + v.temporal_performance_score, 0) / data.videos.length
        }))
        .sort((a, b) => b.avg_tps - a.avg_tps)
        .slice(0, 3);
      
      formatGaps.push({
        format_type: format,
        never_tried: neverTried,
        last_tried_days_ago: lastTriedDaysAgo,
        competitor_success_rate: successRate,
        avg_competitor_tps: avgTps,
        example_competitors: exampleCompetitors
      });
    });
    
    // Analyze topic gaps
    const channelTopics = new Set(channelHistory
      .map(v => v.topic_niche)
      .filter(t => t !== null));
    
    const competitorTopics = new Map<string, any[]>();
    competitorVideos.forEach(v => {
      if (v.topic_niche) {
        if (!competitorTopics.has(v.topic_niche)) {
          competitorTopics.set(v.topic_niche, []);
        }
        competitorTopics.get(v.topic_niche)!.push(v);
      }
    });
    
    const topicGaps: TopicGap[] = [];
    
    competitorTopics.forEach((videos, topic) => {
      const neverTried = !channelTopics.has(topic);
      let lastTriedDaysAgo = null;
      
      if (!neverTried) {
        const lastChannelVideo = channelHistory
          .filter(v => v.topic_niche === topic)
          .sort((a, b) => new Date(b.published_at).getTime() - new Date(a.published_at).getTime())[0];
        
        if (lastChannelVideo) {
          lastTriedDaysAgo = Math.floor(
            (Date.now() - new Date(lastChannelVideo.published_at).getTime()) / (1000 * 60 * 60 * 24)
          );
        }
      }
      
      // Calculate competitor success metrics
      const successfulVideos = videos.filter(v => v.temporal_performance_score >= min_competitor_tps);
      const successRate = successfulVideos.length / videos.length;
      const avgTps = videos.reduce((sum, v) => sum + v.temporal_performance_score, 0) / videos.length;
      
      // Get cluster ID from first video
      const clusterId = videos[0]?.topic_cluster_id || null;
      
      // Get example competitors
      const channelStats = new Map<string, { name: string; videos: any[] }>();
      videos.forEach(v => {
        if (!channelStats.has(v.channel_id)) {
          channelStats.set(v.channel_id, { name: v.channel_name, videos: [] });
        }
        channelStats.get(v.channel_id)!.videos.push(v);
      });
      
      const exampleCompetitors = Array.from(channelStats.entries())
        .map(([channelId, data]) => ({
          channel_id: channelId,
          channel_name: data.name,
          video_count: data.videos.length,
          avg_tps: data.videos.reduce((sum, v) => sum + v.temporal_performance_score, 0) / data.videos.length
        }))
        .sort((a, b) => b.avg_tps - a.avg_tps)
        .slice(0, 3);
      
      topicGaps.push({
        topic_niche: topic,
        topic_cluster_id: clusterId,
        never_tried: neverTried,
        last_tried_days_ago: lastTriedDaysAgo,
        competitor_success_rate: successRate,
        avg_competitor_tps: avgTps,
        example_competitors: exampleCompetitors
      });
    });
    
    // Sort gaps by potential (success rate * avg TPS)
    formatGaps.sort((a, b) => (b.competitor_success_rate * b.avg_competitor_tps) - (a.competitor_success_rate * a.avg_competitor_tps));
    topicGaps.sort((a, b) => (b.competitor_success_rate * b.avg_competitor_tps) - (a.competitor_success_rate * a.avg_competitor_tps));
    
    // Generate recommendations
    const highPriorityFormats = formatGaps
      .filter(g => (g.never_tried || (g.last_tried_days_ago && g.last_tried_days_ago > 60)) 
        && g.avg_competitor_tps >= 2.5 
        && g.competitor_success_rate >= 0.4)
      .slice(0, 3)
      .map(g => g.format_type);
    
    const highPriorityTopics = topicGaps
      .filter(g => (g.never_tried || (g.last_tried_days_ago && g.last_tried_days_ago > 60))
        && g.avg_competitor_tps >= 2.5
        && g.competitor_success_rate >= 0.4)
      .slice(0, 5)
      .map(g => g.topic_niche);
    
    const formatReasoning = formatGaps
      .filter(g => highPriorityFormats.includes(g.format_type))
      .map(g => `${g.format_type}: ${g.avg_competitor_tps.toFixed(1)} avg TPS, ${(g.competitor_success_rate * 100).toFixed(0)}% success rate`);
    
    const topicReasoning = topicGaps
      .filter(g => highPriorityTopics.includes(g.topic_niche))
      .map(g => `${g.topic_niche}: ${g.avg_competitor_tps.toFixed(1)} avg TPS, ${(g.competitor_success_rate * 100).toFixed(0)}% success rate`);
    
    const response: ContentGapsResponse = {
      channel_id,
      analysis_scope: {
        days_back,
        compared_competitors: actualCompetitorIds.length,
        min_competitor_tps
      },
      format_gaps: formatGaps.slice(0, 10), // Limit to top 10
      topic_gaps: topicGaps.slice(0, 15), // Limit to top 15
      recommendations: {
        high_priority_formats: highPriorityFormats,
        high_priority_topics: highPriorityTopics,
        format_reasoning: formatReasoning,
        topic_reasoning: topicReasoning
      },
      total_gaps_found: formatGaps.length + topicGaps.length
    };
    
    return {
      success: true,
      data: response
    };
    
  } catch (error: any) {
    console.error('Error finding content gaps:', error);
    return {
      success: false,
      error: {
        code: 'DATABASE_ERROR',
        message: 'Failed to find content gaps',
        details: error.message,
        retryable: true
      }
    };
  }
}

// Wrap handler with caching and retry logic
const wrappedHandler = wrapTool({
  name: 'find_content_gaps',
  description: 'Identify untried formats and topics by comparing to competitors',
  parameters: {
    type: 'object',
    properties: {
      channel_id: {
        type: 'string',
        description: 'Channel ID to analyze gaps for'
      },
      compare_to_competitors: {
        type: 'boolean',
        description: 'Whether to compare against competitors',
        default: true
      },
      competitor_channel_ids: {
        type: 'array',
        items: { type: 'string' },
        description: 'Specific competitor channel IDs (auto-discovered if empty)',
        default: []
      },
      min_competitor_tps: {
        type: 'number',
        description: 'Minimum TPS to consider successful competitors',
        default: 2.0
      },
      days_back: {
        type: 'number',
        description: 'Number of days to analyze',
        default: 180
      }
    },
    required: ['channel_id']
  },
  handler: findContentGapsHandler,
  parallelSafe: true,
  cacheTTL: 600, // Cache for 10 minutes
  timeout: 10000, // Longer timeout for complex analysis
  retryConfig: {
    maxRetries: 3,
    backoffMs: 1000
  }
});

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const context = createToolContext({
      requestId: request.headers.get('x-request-id') || undefined,
      mode: request.headers.get('x-analysis-mode') as 'classic' | 'agentic' || 'agentic'
    });

    const result = await wrappedHandler(body, context);
    
    return NextResponse.json(result, {
      status: result.success ? 200 : 400,
      headers: {
        'x-request-id': context.requestId || '',
        'x-cache-status': result.metadata?.cached ? 'hit' : 'miss',
        'x-execution-time': String(result.metadata?.executionTime || 0)
      }
    });
  } catch (error: any) {
    console.error('API error:', error);
    return NextResponse.json(
      {
        success: false,
        error: {
          code: 'API_ERROR',
          message: error.message || 'Internal server error'
        }
      },
      { status: 500 }
    );
  }
}

// Export for testing
export { findContentGapsHandler };