import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

interface FindCrossNicheParams {
  psychological_trigger: string;
  exclude_niches?: string[];
  min_performance?: number;
  limit?: number;
}

/**
 * Find patterns from different niches that share psychological triggers
 * Returns raw data for Claude to analyze
 */
export async function findCrossNichePatternsTool(params: FindCrossNicheParams) {
  const {
    psychological_trigger,
    exclude_niches = [],
    min_performance = 2.0,
    limit = 30
  } = params;
  
  console.log('[find-cross-niche] Searching for:', psychological_trigger);
  
  try {
    // Build query for high performers - optimized with specific columns
    let query = supabase
      .from('videos')
      .select('id, title, channel_name, channel_id, thumbnail_url, view_count, published_at, temporal_performance_score, performance_ratio, topic_niche, format_type')
      .gte('temporal_performance_score', min_performance)
      .eq('is_short', false)
      .order('temporal_performance_score', { ascending: false })
      .limit(50); // Reduced from 100
    
    // Execute query
    const { data: videos, error } = await query;
    
    if (error) {
      throw new Error(`Database query failed: ${error.message}`);
    }
    
    // Group by niche
    const nicheGroups = new Map<string, any[]>();
    
    videos?.forEach(video => {
      const niche = video.topic_niche || 'uncategorized';
      
      // Skip excluded niches
      if (exclude_niches.includes(niche)) return;
      
      if (!nicheGroups.has(niche)) {
        nicheGroups.set(niche, []);
      }
      nicheGroups.get(niche)!.push(video);
    });
    
    // Format videos for consistent structure
    const allVideos: any[] = [];
    nicheGroups.forEach((videos, niche) => {
      videos.slice(0, 5).forEach(video => {
        allVideos.push({
          ...video,
          source: 'cross_niche_search'
        });
      });
    });
    
    // Convert to response format matching expected structure
    const response = {
      query_context: {
        psychological_trigger,
        excluded_niches: exclude_niches,
        min_performance_used: min_performance
      },
      results: {
        by_niche: Object.fromEntries(
          Array.from(nicheGroups.entries())
            .map(([niche, videos]) => [
              niche,
              videos.slice(0, 5).map(v => ({
                video_id: v.id,
                title: v.title,
                channel_name: v.channel_name,
                view_count: v.view_count,
                temporal_performance_score: v.temporal_performance_score,
                topic_niche: v.topic_niche,
                thumbnail_url: v.thumbnail_url
              }))
            ])
        ),
        all_videos: allVideos.slice(0, limit)
      },
      stats: {
        total_videos: videos?.length || 0,
        unique_niches: nicheGroups.size,
        videos_per_niche: Math.min(5, Math.floor((videos?.length || 0) / nicheGroups.size))
      }
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
    console.error('[find-cross-niche] Error:', error);
    throw new Error(`Failed to find cross-niche patterns: ${error.message}`);
  }
}