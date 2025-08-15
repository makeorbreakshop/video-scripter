import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

interface GetPatternInsightsParams {
  pattern_examples: string[];  // Can be video IDs or titles
  include_thumbnails?: boolean;
}

/**
 * Get deep insights about what makes specific patterns successful
 * Returns raw data about the videos for Claude to analyze
 */
export async function getPatternInsightsTool(params: GetPatternInsightsParams) {
  const {
    pattern_examples,
    include_thumbnails = false
  } = params;
  
  console.log('[get-pattern-insights] Analyzing', pattern_examples.length, 'examples');
  
  try {
    // Determine if inputs are video IDs or titles
    const isVideoId = pattern_examples[0]?.match(/^[a-zA-Z0-9_-]{11}$/);
    
    let videos: any[] = [];
    
    if (isVideoId) {
      // Query by video IDs - optimized with specific columns
      const { data, error } = await supabase
        .from('videos')
        .select('id, title, channel_name, channel_id, thumbnail_url, view_count, like_count, published_at, temporal_performance_score, performance_ratio, topic_niche, format_type, tags, duration, comment_count')
        .in('id', pattern_examples.slice(0, 20)); // Limit to 20 videos max
      
      if (error) throw error;
      videos = data || [];
      
    } else {
      // Search by title similarity - batch limited
      const titlesToSearch = pattern_examples.slice(0, 10); // Limit to 10 titles
      for (const title of titlesToSearch) {
        const { data, error } = await supabase
          .from('videos')
          .select('id, title, channel_name, channel_id, thumbnail_url, view_count, like_count, published_at, temporal_performance_score, performance_ratio, topic_niche, format_type, tags, duration, comment_count')
          .ilike('title', `%${title}%`)
          .limit(1);
        
        if (data && data[0]) {
          videos.push(data[0]);
        }
      }
    }
    
    // Get channel baselines for context
    const channelIds = [...new Set(videos.map(v => v.channel_id))];
    const channelBaselines = new Map<string, any>();
    
    // Limit channel baseline queries to first 5 channels
    for (const channelId of channelIds.slice(0, 5)) {
      const { data } = await supabase
        .from('videos')
        .select('view_count, like_count')
        .eq('channel_id', channelId)
        .eq('is_short', false)
        .order('published_at', { ascending: false })
        .limit(10); // Reduced from 20
      
      if (data && data.length > 0) {
        const avgViews = data.reduce((sum, v) => sum + (v.view_count || 0), 0) / data.length;
        const avgLikes = data.reduce((sum, v) => sum + (v.like_count || 0), 0) / data.length;
        
        channelBaselines.set(channelId, {
          avg_views: Math.round(avgViews),
          avg_likes: Math.round(avgLikes),
          sample_size: data.length
        });
      }
    }
    
    // Analyze common patterns
    const allTags = videos.flatMap(v => v.tags || []);
    const tagFrequency = allTags.reduce((acc, tag) => {
      acc[tag] = (acc[tag] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);
    
    const topTags = Object.entries(tagFrequency)
      .sort(([, a], [, b]) => (b as number) - (a as number))
      .slice(0, 10)
      .map(([tag, count]) => ({ tag, count, percentage: ((count as number) / videos.length) * 100 }));
    
    // Format response
    const response = {
      videos_analyzed: videos.length,
      pattern_examples: videos.map(v => ({
        video_id: v.id,
        title: v.title,
        channel_name: v.channel_name,
        channel_id: v.channel_id,
        thumbnail_url: include_thumbnails ? v.thumbnail_url : undefined,
        view_count: v.view_count,
        like_count: v.like_count,
        comment_count: v.comment_count,
        published_at: v.published_at,
        duration: v.duration,
        temporal_performance_score: v.temporal_performance_score,
        performance_ratio: v.performance_ratio,
        topic_niche: v.topic_niche,
        format_type: v.format_type,
        tags: v.tags,
        description_snippet: v.description?.substring(0, 200)
      })),
      channel_baselines: Object.fromEntries(channelBaselines),
      common_tags: topTags,
      performance_stats: {
        avg_tps: videos.reduce((sum, v) => sum + (v.temporal_performance_score || 0), 0) / videos.length,
        avg_views: Math.round(videos.reduce((sum, v) => sum + (v.view_count || 0), 0) / videos.length),
        avg_engagement_rate: videos.reduce((sum, v) => {
          const engagementRate = ((v.like_count || 0) + (v.comment_count || 0)) / (v.view_count || 1);
          return sum + engagementRate;
        }, 0) / videos.length
      },
      format_distribution: videos.reduce((acc, v) => {
        const format = v.format_type || 'unknown';
        acc[format] = (acc[format] || 0) + 1;
        return acc;
      }, {} as Record<string, number>),
      niche_distribution: videos.reduce((acc, v) => {
        const niche = v.topic_niche || 'uncategorized';
        acc[niche] = (acc[niche] || 0) + 1;
        return acc;
      }, {} as Record<string, number>)
    };
    
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(response, null, 2)
        }
      ]
    };
    
  } catch (error: any) {
    console.error('[get-pattern-insights] Error:', error);
    throw new Error(`Failed to get pattern insights: ${error.message}`);
  }
}