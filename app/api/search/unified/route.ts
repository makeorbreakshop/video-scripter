/**
 * Unified Search API
 * Combines semantic search, keyword search, and channel search
 * GET /api/search/unified
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { pineconeService } from '@/lib/pinecone-service';
import { generateQueryEmbedding } from '@/lib/title-embeddings';
import { searchResultsCache, channelCache, embedingCache } from '@/lib/search-cache';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

interface UnifiedSearchParams {
  query: string;
  type?: 'all' | 'videos' | 'channels' | 'semantic';
  limit?: number;
  offset?: number;
  filters?: {
    performanceFilter?: string;
    dateFilter?: string;
    minViews?: number;
    maxViews?: number;
    competitorFilter?: string;
  };
}

interface SearchResult {
  id: string;
  type: 'video' | 'channel';
  title: string;
  channel_id?: string;
  channel_name?: string;
  channel_thumbnail?: string;
  view_count?: number;
  subscriber_count?: number;
  video_count?: number;
  published_at?: string;
  performance_ratio?: number;
  score: number;
  match_type: 'semantic' | 'keyword' | 'channel' | 'direct';
  thumbnail_url?: string;
  description?: string;
}

export async function GET(request: NextRequest) {
  const startTime = Date.now();
  
  try {
    const { searchParams } = new URL(request.url);
    const query = searchParams.get('query') || '';
    const type = (searchParams.get('type') || 'all') as UnifiedSearchParams['type'];
    const limit = parseInt(searchParams.get('limit') || '20');
    const offset = parseInt(searchParams.get('offset') || '0');
    
    // Parse filters
    const filters: UnifiedSearchParams['filters'] = {
      performanceFilter: searchParams.get('performanceFilter') || undefined,
      dateFilter: searchParams.get('dateFilter') || undefined,
      minViews: searchParams.get('minViews') ? parseInt(searchParams.get('minViews')!) : undefined,
      maxViews: searchParams.get('maxViews') ? parseInt(searchParams.get('maxViews')!) : undefined,
      competitorFilter: searchParams.get('competitorFilter') || undefined,
    };
    
    // Check cache first
    const cacheKey = `${query}-${type}-${limit}-${offset}-${JSON.stringify(filters)}`;
    const cachedResult = searchResultsCache.get(cacheKey);
    if (cachedResult) {
      console.log(`🎯 Cache hit for: "${query}"`);
      return NextResponse.json({
        ...cachedResult,
        cached: true,
        query_time_ms: Date.now() - startTime
      });
    }

    if (!query || query.trim().length === 0) {
      return NextResponse.json(
        { error: 'Query parameter is required' },
        { status: 400 }
      );
    }

    console.log(`🔍 Unified search: "${query}" (type: ${type})`);

    // Detect search intent
    const searchIntent = detectSearchIntent(query);
    console.log(`🎯 Detected intent: ${searchIntent.type}`);

    // Merge operator filters with UI filters
    const mergedFilters = {
      ...filters,
      ...(searchIntent.operators?.views && {
        minViews: searchIntent.operators.views.min || filters.minViews,
        maxViews: searchIntent.operators.views.max || filters.maxViews,
      }),
      ...(searchIntent.operators?.date && {
        dateFilter: searchIntent.operators.date,
      }),
    };

    // Execute parallel searches based on type and intent
    const searchPromises: Promise<SearchResult[]>[] = [];
    
    if (type === 'all' || type === 'videos') {
      if (searchIntent.type === 'youtube_url' || searchIntent.type === 'video_id') {
        searchPromises.push(searchDirectVideo(searchIntent.extractedId!));
      } else {
        searchPromises.push(searchVideosByKeyword(searchIntent.cleanQuery, mergedFilters, limit));
        if (searchIntent.type !== 'channel' && searchIntent.cleanQuery.split(' ').length > 1) {
          searchPromises.push(searchVideosBySemantic(searchIntent.cleanQuery, mergedFilters, limit));
        }
      }
    }
    
    if (type === 'all' || type === 'channels') {
      if (searchIntent.type === 'channel' || searchIntent.type === 'channel_prefix') {
        searchPromises.push(searchChannels(searchIntent.cleanQuery, limit));
      } else if (type === 'channels' || type === 'all') {
        // For 'all' searches, also search channels with the clean query
        searchPromises.push(searchChannels(searchIntent.cleanQuery, Math.floor(limit / 3))); // Get fewer channels for 'all'
      }
    }

    // Execute all searches in parallel
    const searchResults = await Promise.all(searchPromises);
    const allResults = searchResults.flat();

    // Merge and rank results
    const rankedResults = rankAndMergeResults(allResults, query);
    
    // Apply pagination
    const paginatedResults = rankedResults.slice(offset, offset + limit);
    
    const queryTime = Date.now() - startTime;

    // Cache the successful results
    const resultData = {
      results: paginatedResults,
      total_results: rankedResults.length,
      query,
      type,
      query_time_ms: queryTime,
      has_more: rankedResults.length > offset + limit,
      search_intent: searchIntent
    };
    
    // Only cache the first page of results
    if (offset === 0) {
      searchResultsCache.set(cacheKey, resultData);
    }

    return NextResponse.json(resultData);

  } catch (error) {
    console.error('❌ Unified search failed:', error);
    return NextResponse.json(
      { 
        error: 'Failed to perform unified search',
        details: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  }
}

/**
 * Parse search operators from query
 */
interface SearchOperators {
  views?: { min?: number; max?: number };
  date?: string;
  channel?: string;
}

function parseSearchOperators(query: string): { cleanQuery: string; operators: SearchOperators } {
  const operators: SearchOperators = {};
  let cleanQuery = query;

  // Parse views operators (views:>1000, views:<10000, views:1000-10000)
  const viewsPattern = /views:([<>]?)(\d+)(?:-(\d+))?/gi;
  const viewsMatches = Array.from(query.matchAll(viewsPattern));
  viewsMatches.forEach(match => {
    const [fullMatch, operator, value1, value2] = match;
    const num1 = parseInt(value1);
    
    if (!operators.views) operators.views = {};
    
    if (value2) {
      // Range: views:1000-10000
      operators.views.min = num1;
      operators.views.max = parseInt(value2);
    } else if (operator === '>') {
      operators.views.min = num1;
    } else if (operator === '<') {
      operators.views.max = num1;
    } else {
      // Exact match, treat as range ±10%
      operators.views.min = Math.floor(num1 * 0.9);
      operators.views.max = Math.ceil(num1 * 1.1);
    }
    
    cleanQuery = cleanQuery.replace(fullMatch, '').trim();
  });

  // Parse date operators (date:7d, date:30d, date:6m, date:1y)
  const datePattern = /date:(\d+)([dmy])/gi;
  const dateMatch = cleanQuery.match(datePattern);
  if (dateMatch) {
    const [fullMatch, value, unit] = dateMatch[0].match(/date:(\d+)([dmy])/i)!;
    const num = parseInt(value);
    
    switch (unit.toLowerCase()) {
      case 'd':
        operators.date = `${num}days`;
        break;
      case 'm':
        operators.date = `${num}months`;
        break;
      case 'y':
        operators.date = `${num}year`;
        break;
    }
    
    cleanQuery = cleanQuery.replace(fullMatch, '').trim();
  }

  // Parse channel operator (channel:name)
  const channelPattern = /channel:([^\s]+)/gi;
  const channelMatch = cleanQuery.match(channelPattern);
  if (channelMatch) {
    const [fullMatch, channelName] = channelMatch[0].match(/channel:([^\s]+)/i)!;
    operators.channel = channelName;
    cleanQuery = cleanQuery.replace(fullMatch, '').trim();
  }

  return { cleanQuery, operators };
}

/**
 * Detect the intent of the search query
 */
function detectSearchIntent(query: string): {
  type: 'keyword' | 'channel' | 'channel_prefix' | 'youtube_url' | 'video_id' | 'semantic';
  cleanQuery: string;
  extractedId?: string;
  operators?: SearchOperators;
} {
  // First parse operators
  const { cleanQuery: queryWithoutOperators, operators } = parseSearchOperators(query);

  // Check for YouTube URL
  const youtubeUrlPattern = /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([a-zA-Z0-9_-]{11})/;
  const urlMatch = queryWithoutOperators.match(youtubeUrlPattern);
  if (urlMatch) {
    return { type: 'youtube_url', cleanQuery: queryWithoutOperators, extractedId: urlMatch[1], operators };
  }

  // Check for video ID pattern
  const videoIdPattern = /^[a-zA-Z0-9_-]{11}$/;
  if (videoIdPattern.test(queryWithoutOperators.trim())) {
    return { type: 'video_id', cleanQuery: queryWithoutOperators, extractedId: queryWithoutOperators.trim(), operators };
  }

  // Check for @channel prefix
  if (queryWithoutOperators.startsWith('@')) {
    return { type: 'channel_prefix', cleanQuery: queryWithoutOperators.substring(1).trim(), operators };
  }

  // Check if channel operator was used
  if (operators.channel) {
    return { type: 'channel', cleanQuery: operators.channel, operators };
  }

  // Default to keyword/semantic search
  return { type: 'keyword', cleanQuery: queryWithoutOperators, operators };
}

/**
 * Search videos by keyword using PostgreSQL full-text search
 */
async function searchVideosByKeyword(
  query: string, 
  filters: UnifiedSearchParams['filters'],
  limit: number
): Promise<SearchResult[]> {
  try {
    let queryBuilder = supabase
      .from('videos')
      .select('*')
      .textSearch('title', query, {
        type: 'websearch',
        config: 'english'
      })
      .limit(limit);

    // Apply filters
    queryBuilder = applyVideoFilters(queryBuilder, filters);

    const { data, error } = await queryBuilder;

    if (error) throw error;

    return (data || []).map(video => ({
      id: video.id,
      type: 'video' as const,
      title: video.title,
      channel_id: video.channel_id,
      channel_name: video.channel_name,
      view_count: video.view_count,
      published_at: video.published_at,
      performance_ratio: video.baseline_cpm_prediction_ratio || 1,
      score: 0.8, // Base score for keyword matches
      match_type: 'keyword' as const,
      thumbnail_url: `https://i.ytimg.com/vi/${video.id}/hqdefault.jpg`,
      description: video.description
    }));
  } catch (error) {
    console.error('Keyword search error:', error);
    return [];
  }
}

/**
 * Search videos using semantic similarity
 */
async function searchVideosBySemantic(
  query: string,
  filters: UnifiedSearchParams['filters'],
  limit: number
): Promise<SearchResult[]> {
  try {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) return [];

    // Check embedding cache first
    const embeddingCacheKey = `embedding-${query}`;
    let queryEmbedding = embedingCache.get(embeddingCacheKey);
    
    if (!queryEmbedding) {
      // Generate query embedding
      queryEmbedding = await generateQueryEmbedding(query, apiKey);
      // Cache the embedding
      embedingCache.set(embeddingCacheKey, queryEmbedding);
    } else {
      console.log(`🎯 Embedding cache hit for: "${query}"`);
    }
    
    // Search in Pinecone
    const searchResult = await pineconeService.searchSimilar(
      queryEmbedding,
      limit * 2, // Get more to filter
      0.5 // Lower threshold for unified search
    );

    // Extract results array from the response
    let filteredVideos = searchResult.results;
    
    // Filter by additional criteria if needed
    if (filters?.minViews || filters?.maxViews) {
      filteredVideos = filteredVideos.filter(v => {
        if (filters.minViews && v.view_count < filters.minViews) return false;
        if (filters.maxViews && v.view_count > filters.maxViews) return false;
        return true;
      });
    }

    return filteredVideos.slice(0, limit).map(video => ({
      id: video.video_id,
      type: 'video' as const,
      title: video.title,
      channel_id: video.channel_id,
      channel_name: video.channel_name,
      view_count: video.view_count,
      published_at: video.published_at,
      performance_ratio: video.performance_ratio,
      score: video.similarity_score,
      match_type: 'semantic' as const,
      thumbnail_url: `https://i.ytimg.com/vi/${video.video_id}/hqdefault.jpg`
    }));
  } catch (error) {
    console.error('Semantic search error:', error);
    return [];
  }
}

/**
 * Search channels by name
 */
async function searchChannels(query: string, limit: number): Promise<SearchResult[]> {
  try {
    // Check cache first
    const cacheKey = `channels-${query}-${limit}`;
    const cached = channelCache.get(cacheKey);
    if (cached) {
      console.log(`🎯 Channel cache hit for: "${query}"`);
      return cached;
    }

    // Use optimized SQL function if available
    const { data: channelResults, error: funcError } = await supabase
      .rpc('search_channels', {
        search_query: `%${query}%`,
        result_limit: limit
      });

    if (!funcError && channelResults && channelResults.length > 0) {
      console.log(`✅ Found ${channelResults.length} channels using optimized function`);
      
      const results = channelResults.map((channel: any) => {
        // Calculate relevance score
        let score = 0.5;
        const lowerQuery = query.toLowerCase();
        const lowerChannelName = channel.channel_name.toLowerCase();
        
        if (lowerChannelName === lowerQuery) {
          score = 1.0; // Exact match
        } else if (lowerChannelName.startsWith(lowerQuery)) {
          score = 0.9; // Starts with query
        } else if (lowerChannelName.includes(lowerQuery)) {
          score = 0.7; // Contains query
        }

        return {
          id: channel.channel_id,
          type: 'channel' as const,
          title: channel.channel_name,
          channel_id: channel.channel_id,
          channel_name: channel.channel_name,
          channel_thumbnail: channel.channel_thumbnail,
          video_count: channel.video_count,
          view_count: channel.total_views,
          score,
          match_type: 'channel' as const
        };
      });

      // Sort by score
      results.sort((a, b) => b.score - a.score);
      
      // Cache the results
      channelCache.set(cacheKey, results);
      
      return results;
    }
    
    // Fallback to original method if function doesn't exist or returns no results
    console.log('⚠️ Falling back to original channel search method');
    
    // Search for channels by name
    const { data: videos, error } = await supabase
      .from('videos')
      .select('channel_id, channel_name')
      .ilike('channel_name', `%${query}%`)
      .limit(1000); // Get enough to find unique channels

    if (error) throw error;

    // Aggregate channels manually
    const channelMap = new Map<string, {
      channel_id: string;
      channel_name: string;
      video_count: number;
      total_views: number;
    }>();

    // Count videos per channel
    const channelVideoCount = new Map<string, number>();
    videos?.forEach(video => {
      const count = channelVideoCount.get(video.channel_id) || 0;
      channelVideoCount.set(video.channel_id, count + 1);
    });

    // Get unique channels
    const uniqueChannels = new Map<string, { name: string; thumbnail?: string }>();
    videos?.forEach(video => {
      if (!uniqueChannels.has(video.channel_id)) {
        uniqueChannels.set(video.channel_id, { name: video.channel_name, thumbnail: undefined });
      }
    });

    // Get stats for each unique channel
    const channelIds = Array.from(uniqueChannels.keys()).slice(0, limit);
    
    for (const channelId of channelIds) {
      // Get video count, total views, and channel metadata for this channel
      const { data: stats, error: statsError } = await supabase
        .from('videos')
        .select('view_count, metadata')
        .eq('channel_id', channelId);

      if (!statsError && stats && stats.length > 0) {
        const totalViews = stats.reduce((sum, video) => sum + (video.view_count || 0), 0);
        
        // Try to get channel thumbnail from metadata
        let channelThumbnail;
        for (const video of stats) {
          if (video.metadata?.channel_stats?.channel_thumbnail) {
            channelThumbnail = video.metadata.channel_stats.channel_thumbnail;
            break;
          }
        }
        
        channelMap.set(channelId, {
          channel_id: channelId,
          channel_name: uniqueChannels.get(channelId)?.name || '',
          channel_thumbnail: channelThumbnail,
          video_count: stats.length,
          total_views: totalViews
        });
      }
    }

    // Convert to search results and sort by relevance
    const results = Array.from(channelMap.values()).map(channel => {
      // Calculate relevance score
      let score = 0.5;
      const lowerQuery = query.toLowerCase();
      const lowerChannelName = channel.channel_name.toLowerCase();
      
      if (lowerChannelName === lowerQuery) {
        score = 1.0; // Exact match
      } else if (lowerChannelName.startsWith(lowerQuery)) {
        score = 0.9; // Starts with query
      } else if (lowerChannelName.includes(lowerQuery)) {
        score = 0.7; // Contains query
      }

      return {
        id: channel.channel_id,
        type: 'channel' as const,
        title: channel.channel_name,
        channel_id: channel.channel_id,
        channel_name: channel.channel_name,
        channel_thumbnail: channel.channel_thumbnail,
        video_count: channel.video_count,
        view_count: channel.total_views,
        score,
        match_type: 'channel' as const
      };
    });

    // Sort by score
    results.sort((a, b) => b.score - a.score);
    
    // Cache the results
    channelCache.set(cacheKey, results);

    return results;
  } catch (error) {
    console.error('Channel search error:', error);
    return [];
  }
}

/**
 * Search for a specific video by ID
 */
async function searchDirectVideo(videoId: string): Promise<SearchResult[]> {
  try {
    const { data, error } = await supabase
      .from('videos')
      .select('*')
      .eq('id', videoId)
      .single();

    if (error || !data) return [];

    return [{
      id: data.id,
      type: 'video' as const,
      title: data.title,
      channel_id: data.channel_id,
      channel_name: data.channel_name,
      view_count: data.view_count,
      published_at: data.published_at,
      performance_ratio: data.baseline_cpm_prediction_ratio || 1,
      score: 1, // Perfect match
      match_type: 'direct' as const,
      thumbnail_url: `https://i.ytimg.com/vi/${data.id}/hqdefault.jpg`,
      description: data.description
    }];
  } catch (error) {
    console.error('Direct video search error:', error);
    return [];
  }
}

/**
 * Apply video filters to query builder
 */
function applyVideoFilters(queryBuilder: any, filters?: UnifiedSearchParams['filters']) {
  if (!filters) return queryBuilder;

  // Performance filter
  if (filters.performanceFilter) {
    const perfRanges = {
      excellent: { min: 2, max: null },
      good: { min: 1.5, max: 2 },
      average: { min: 0.8, max: 1.5 },
      poor: { min: null, max: 0.8 }
    };
    const range = perfRanges[filters.performanceFilter as keyof typeof perfRanges];
    if (range) {
      if (range.min) queryBuilder = queryBuilder.gte('baseline_cpm_prediction_ratio', range.min);
      if (range.max) queryBuilder = queryBuilder.lt('baseline_cpm_prediction_ratio', range.max);
    }
  }

  // Date filter
  if (filters.dateFilter) {
    const dateRanges = {
      '30days': 30,
      '3months': 90,
      '6months': 180,
      '1year': 365
    };
    const days = dateRanges[filters.dateFilter as keyof typeof dateRanges];
    if (days) {
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - days);
      queryBuilder = queryBuilder.gte('published_at', cutoffDate.toISOString());
    }
  }

  // View count filters
  if (filters.minViews) queryBuilder = queryBuilder.gte('view_count', filters.minViews);
  if (filters.maxViews) queryBuilder = queryBuilder.lte('view_count', filters.maxViews);

  // Competitor filter
  if (filters.competitorFilter === 'mine') {
    queryBuilder = queryBuilder.eq('is_mine', true);
  } else if (filters.competitorFilter === 'competitors') {
    queryBuilder = queryBuilder.eq('is_competitor', true);
  }

  return queryBuilder;
}

/**
 * Rank and merge results from different search types
 */
function rankAndMergeResults(results: SearchResult[], query: string): SearchResult[] {
  // Remove duplicates, keeping highest score
  const uniqueResults = new Map<string, SearchResult>();
  
  results.forEach(result => {
    const key = `${result.type}-${result.id}`;
    const existing = uniqueResults.get(key);
    if (!existing || result.score > existing.score) {
      uniqueResults.set(key, result);
    }
  });

  // Calculate final scores with boosts
  const scoredResults = Array.from(uniqueResults.values()).map(result => {
    let finalScore = result.score;

    // Boost for exact title matches
    if (result.title.toLowerCase() === query.toLowerCase()) {
      finalScore *= 1.5;
    } else if (result.title.toLowerCase().includes(query.toLowerCase())) {
      finalScore *= 1.2;
    }

    // Boost for high performance videos
    if (result.performance_ratio && result.performance_ratio > 1.5) {
      finalScore *= 1.1;
    }

    // Boost for recent videos
    if (result.published_at) {
      const daysOld = (Date.now() - new Date(result.published_at).getTime()) / (1000 * 60 * 60 * 24);
      if (daysOld < 30) finalScore *= 1.05;
    }

    return { ...result, score: finalScore };
  });

  // Sort by final score
  return scoredResults.sort((a, b) => b.score - a.score);
}