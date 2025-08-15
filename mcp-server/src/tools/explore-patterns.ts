import { createClient } from '@supabase/supabase-js';
import { Pinecone } from '@pinecone-database/pinecone';
import OpenAI from 'openai';

// Initialize clients
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const pinecone = new Pinecone({
  apiKey: process.env.PINECONE_API_KEY!
});

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY!
});

interface ExplorePatternParams {
  core_concept: string;
  current_hook: string;
  frame: string;
  channel_id?: string;
  exploration_depth?: number;
  min_performance?: number;
}

interface SearchResult {
  video_id: string;
  title: string;
  channel_name: string;
  channel_id: string;
  thumbnail_url?: string;
  view_count: number;
  published_at: string;
  temporal_performance_score?: number;
  performance_ratio?: number;
  topic_niche?: string;
  format_type?: string;
  similarity_score?: number;
  source: string;
  query_used?: string;
}

interface ExplorePatternResponse {
  query_context: {
    concept: string;
    hook: string;
    frame: string;
    search_angles: Record<string, string>;
  };
  results: {
    title_searches: SearchResult[];
    summary_searches: SearchResult[];
    cross_niche_searches: SearchResult[];
    high_performers: SearchResult[];
    channel_gaps?: SearchResult[];
  };
  stats: {
    total_videos_found: number;
    unique_videos: number;
    avg_performance: number;
    search_queries_used: number;
  };
}

/**
 * Generate multiple search angles from a concept
 */
function generateSearchAngles(concept: string, hook: string, frame: string) {
  const angles: Record<string, string> = {
    // Direct concept search
    direct: concept,
    
    // Hook-based angles
    hook_focused: hook,
    
    // Problem extraction (if hook contains problem indicators)
    problem: hook.toLowerCase().includes('problem') || hook.toLowerCase().includes('terrible') || hook.toLowerCase().includes('bad')
      ? hook 
      : `problem with ${concept}`,
    
    // Solution/transformation angle
    solution: `how to ${concept}`,
    transformation: `${concept.replace(/ing\s*$/, '')} transformation`,
    
    // Frame-based psychological angles
    psychological: frame.toLowerCase().includes('mastery') 
      ? `mastering ${concept}`
      : frame.toLowerCase().includes('skill')
      ? `${concept} skills`
      : frame.toLowerCase().includes('tool')
      ? `${concept} tools`
      : `${concept} strategy`,
    
    // Fear/pain points
    fear: `${concept} mistakes to avoid`,
    pain: `struggling with ${concept}`,
    
    // Success/results angle
    success: `${concept} results`,
    outcome: `${concept} case study`,
    
    // Beginner angle
    beginner: `${concept} for beginners`,
    
    // Advanced angle
    advanced: `advanced ${concept} techniques`
  };
  
  return angles;
}

/**
 * Search titles with a specific query
 */
async function searchTitles(query: string, topK: number = 30, minScore: number = 0.3) {
  try {
    const embedding = await openai.embeddings.create({
      model: 'text-embedding-3-small',
      input: query,
      dimensions: 512
    });
    
    const index = pinecone.index(process.env.PINECONE_INDEX_NAME!);
    const results = await index.query({
      vector: embedding.data[0].embedding,
      topK,
      includeMetadata: true,
      filter: {
        is_short: false
      }
    });
    
    return results.matches?.filter(m => (m.score || 0) >= minScore) || [];
  } catch (error) {
    console.error(`[search-titles] Error searching for "${query}":`, error);
    return [];
  }
}

/**
 * Search summaries with a specific query
 */
async function searchSummaries(query: string, topK: number = 20, minScore: number = 0.25) {
  try {
    const embedding = await openai.embeddings.create({
      model: 'text-embedding-3-small',
      input: query,
      dimensions: 512
    });
    
    const index = pinecone.index(process.env.PINECONE_INDEX_NAME!).namespace('llm-summaries');
    const results = await index.query({
      vector: embedding.data[0].embedding,
      topK,
      includeMetadata: true
    });
    
    return results.matches?.filter(m => (m.score || 0) >= minScore) || [];
  } catch (error) {
    console.error(`[search-summaries] Error searching for "${query}":`, error);
    return [];
  }
}

/**
 * Find high performers across different niches
 */
async function findCrossNicheHighPerformers(concept: string, minTPS: number = 2.5) {
  // Try to identify current niche from concept
  const conceptLower = concept.toLowerCase();
  const potentialNiche = conceptLower.includes('laser') ? 'laser-engraving' 
    : conceptLower.includes('3d') ? '3d-printing'
    : conceptLower.includes('ai') ? 'ai-tools'
    : conceptLower.includes('wood') ? 'woodworking'
    : null;
  
  // Use specific columns to reduce data transfer
  let query = supabase
    .from('videos')
    .select('id, title, channel_name, channel_id, thumbnail_url, view_count, published_at, temporal_performance_score, performance_ratio, topic_niche, format_type')
    .gte('temporal_performance_score', minTPS)
    .eq('is_short', false)
    .order('temporal_performance_score', { ascending: false })
    .limit(15); // Reduced from 30
  
  // If we identified a niche, exclude it to get cross-niche results
  if (potentialNiche) {
    query = query.neq('topic_niche', potentialNiche);
  }
  
  const { data } = await query;
  return data || [];
}

/**
 * Get top performers regardless of topic
 */
async function getTopPerformers(minTPS: number = 3.0, limit: number = 10) { // Reduced default from 20
  const { data } = await supabase
    .from('videos')
    .select('id, title, channel_name, channel_id, thumbnail_url, view_count, published_at, temporal_performance_score, performance_ratio, topic_niche, format_type')
    .gte('temporal_performance_score', minTPS)
    .eq('is_short', false)
    .order('temporal_performance_score', { ascending: false })
    .limit(limit);
  
  return data || [];
}

/**
 * Find content gaps for a channel
 */
async function findChannelGaps(channelId: string) {
  // Get channel's recent videos - smaller select for efficiency
  const { data: channelVideos } = await supabase
    .from('videos')
    .select('topic_niche, format_type')
    .eq('channel_id', channelId)
    .eq('is_short', false)
    .order('published_at', { ascending: false })
    .limit(50); // Reduced from 100
  
  if (!channelVideos || channelVideos.length === 0) return [];
  
  // Get unique niches the channel has covered
  const coveredNiches = [...new Set(channelVideos.map(v => v.topic_niche).filter(Boolean))];
  
  // Simply find high performers in different niches - avoid NOT IN
  // Pick a few uncovered niches to explore
  const nichesToExplore = ['ai-tools', 'woodworking', '3d-printing', 'laser-engraving', 'productivity']
    .filter(niche => !coveredNiches.includes(niche))
    .slice(0, 3); // Only check 3 niches
  
  if (nichesToExplore.length === 0) return [];
  
  // Get high performers from one of the unexplored niches
  const { data } = await supabase
    .from('videos')
    .select('*')
    .gte('temporal_performance_score', 2.0)
    .eq('is_short', false)
    .in('topic_niche', nichesToExplore)
    .neq('channel_id', channelId)
    .limit(15); // Reduced from 20
  
  return data || [];
}

/**
 * Enrich Pinecone results with Supabase data
 */
async function enrichResults(pineconeMatches: any[], source: string, query?: string): Promise<SearchResult[]> {
  if (pineconeMatches.length === 0) return [];
  
  // Batch videoIds into smaller chunks to avoid query size limits
  const videoIds = pineconeMatches.map(m => m.id);
  const batchSize = 50; // Process in smaller batches
  const batches = [];
  
  for (let i = 0; i < videoIds.length; i += batchSize) {
    batches.push(videoIds.slice(i, i + batchSize));
  }
  
  // Fetch all batches in parallel but with smaller queries
  const allVideos = await Promise.all(
    batches.map(async (batch) => {
      const { data } = await supabase
        .from('videos')
        .select('id, title, channel_name, channel_id, thumbnail_url, view_count, published_at, temporal_performance_score, performance_ratio, topic_niche, format_type')
        .in('id', batch);
      return data || [];
    })
  );
  
  // Flatten results
  const videos = allVideos.flat();
  if (!videos || videos.length === 0) return [];
  
  const videoMap = new Map(videos.map(v => [v.id, v]));
  
  return pineconeMatches
    .map(match => {
      const video = videoMap.get(match.id);
      if (!video) return null;
      
      return {
        video_id: video.id,
        title: video.title,
        channel_name: video.channel_name,
        channel_id: video.channel_id,
        thumbnail_url: video.thumbnail_url,
        view_count: video.view_count,
        published_at: video.published_at,
        temporal_performance_score: video.temporal_performance_score,
        performance_ratio: video.performance_ratio,
        topic_niche: video.topic_niche,
        format_type: video.format_type,
        similarity_score: match.score,
        source,
        query_used: query
      };
    })
    .filter(Boolean) as SearchResult[];
}

/**
 * Main tool handler - orchestrates multiple searches and returns raw data
 */
export async function explorePatternsTool(params: ExplorePatternParams) {
  const {
    core_concept,
    current_hook,
    frame,
    channel_id,
    exploration_depth = 3,
    min_performance = 1.5
  } = params;
  
  console.log('[explore-patterns] Starting pattern exploration for:', core_concept);
  
  try {
    // 1. Generate search angles
    const searchAngles = generateSearchAngles(core_concept, current_hook, frame);
    const anglesToUse = Object.entries(searchAngles).slice(0, exploration_depth);
    console.log('[explore-patterns] Using', anglesToUse.length, 'search angles');
    
    // 2. Perform parallel searches
    const searchPromises = [];
    
    // Title searches with different angles - reduced topK
    for (const [angleType, query] of anglesToUse) {
      searchPromises.push(
        searchTitles(query, 10, 0.35).then(matches => ({ // Reduced from 20 to 10, increased min score
          type: 'title', 
          angleType, 
          query, 
          matches 
        }))
      );
    }
    
    // Summary searches for psychological depth (use first angle only)
    const firstAngle = anglesToUse[0];
    if (firstAngle) {
      searchPromises.push(
        searchSummaries(firstAngle[1], 10, 0.3).then(matches => ({ // Reduced from 15 to 10
          type: 'summary', 
          angleType: firstAngle[0], 
          query: firstAngle[1], 
          matches 
        }))
      );
    }
    
    // Cross-niche high performers
    searchPromises.push(
      findCrossNicheHighPerformers(core_concept, min_performance).then(videos => ({ 
        type: 'cross_niche', 
        videos 
      }))
    );
    
    // Top performers - reduced limit
    searchPromises.push(
      getTopPerformers(min_performance * 2, 5).then(videos => ({ // Reduced to 5 top performers
        type: 'top_performers', 
        videos 
      }))
    );
    
    // Channel gaps if channel_id provided
    if (channel_id) {
      searchPromises.push(
        findChannelGaps(channel_id).then(videos => ({ 
          type: 'channel_gaps', 
          videos 
        }))
      );
    }
    
    // 3. Execute all searches in parallel
    const searchResults = await Promise.all(searchPromises);
    console.log('[explore-patterns] Completed', searchResults.length, 'searches');
    
    // 4. Process and enrich results
    const response: ExplorePatternResponse = {
      query_context: {
        concept: core_concept,
        hook: current_hook,
        frame,
        search_angles: searchAngles
      },
      results: {
        title_searches: [],
        summary_searches: [],
        cross_niche_searches: [],
        high_performers: [],
        channel_gaps: []
      },
      stats: {
        total_videos_found: 0,
        unique_videos: 0,
        avg_performance: 0,
        search_queries_used: anglesToUse.length
      }
    };
    
    // Process each search result
    for (const result of searchResults) {
      if (result.type === 'title' && 'matches' in result && result.matches) {
        const enriched = await enrichResults(result.matches, `title_${result.angleType}`, result.query);
        response.results.title_searches.push(...enriched);
      } else if (result.type === 'summary' && 'matches' in result && result.matches) {
        const enriched = await enrichResults(result.matches, `summary_${result.angleType}`, result.query);
        response.results.summary_searches.push(...enriched);
      } else if (result.type === 'cross_niche' && 'videos' in result && result.videos) {
        response.results.cross_niche_searches = result.videos.map((v: any) => ({
          ...v,
          source: 'cross_niche_search'
        }));
      } else if (result.type === 'top_performers' && 'videos' in result && result.videos) {
        response.results.high_performers = result.videos.map((v: any) => ({
          ...v,
          source: 'top_performers'
        }));
      } else if (result.type === 'channel_gaps' && 'videos' in result && result.videos) {
        response.results.channel_gaps = result.videos.map((v: any) => ({
          ...v,
          source: 'channel_gaps'
        }));
      }
    }
    
    // 5. Calculate stats
    const allVideos = [
      ...response.results.title_searches,
      ...response.results.summary_searches,
      ...response.results.cross_niche_searches,
      ...response.results.high_performers,
      ...(response.results.channel_gaps || [])
    ];
    
    response.stats.total_videos_found = allVideos.length;
    
    // Get unique video IDs
    const uniqueIds = new Set(allVideos.map(v => v.video_id));
    response.stats.unique_videos = uniqueIds.size;
    
    // Calculate average performance
    const performanceScores = allVideos
      .map(v => v.temporal_performance_score || v.performance_ratio || 1.0)
      .filter(score => score > 0);
    
    if (performanceScores.length > 0) {
      response.stats.avg_performance = 
        performanceScores.reduce((sum, score) => sum + score, 0) / performanceScores.length;
    }
    
    console.log('[explore-patterns] Returning', response.stats.unique_videos, 'unique videos');
    
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(response, null, 2)
        }
      ]
    };
    
  } catch (error: any) {
    console.error('[explore-patterns] Error:', error);
    throw new Error(`Failed to explore patterns: ${error.message}`);
  }
}