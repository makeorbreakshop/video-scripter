import { NextResponse } from 'next/server';
import { openai } from '@/lib/openai-client';
import { getSupabase } from '@/lib/supabase-lazy';
import { Pinecone } from '@pinecone-database/pinecone';

// Initialize Pinecone
const pinecone = new Pinecone({
  apiKey: process.env.PINECONE_API_KEY!,
});

// Initialize Supabase

export async function POST(request: Request) {
  console.log('🚀 Pattern Search API called');
  console.log('🔧 Environment check:', {
    has_pinecone_key: !!process.env.PINECONE_API_KEY,
    pinecone_index: process.env.PINECONE_INDEX_NAME,
    has_openai_key: !!process.env.OPENAI_API_KEY,
    has_supabase_url: !!process.env.NEXT_PUBLIC_SUPABASE_URL,
    has_supabase_key: !!process.env.SUPABASE_SERVICE_ROLE_KEY
  });
  
  try {
    const body = await request.json();
    const { 
      query, 
      format, 
      relevance = 0.7, 
      performanceThreshold = 0.3,
      minViews,
      maxViews,
      dateFilter = 'all',
      customStartDate,
      customEndDate,
      sortBy = 'relevance',
      page = 1,
      limit = 20 
    } = body;

    console.log('🔍 Pattern Search Request:', {
      query,
      format,
      relevance,
      performanceThreshold,
      minViews,
      maxViews,
      dateFilter,
      customStartDate,
      customEndDate,
      sortBy,
      page,
      limit
    });

    if (!query || query.trim().length === 0) {
      return NextResponse.json({ error: 'Query is required' }, { status: 400 });
    }

    // Generate embedding for the search query
    console.log('🧮 Generating embedding for query:', query);
    const embeddingResponse = await openai.embeddings.create({
      model: 'text-embedding-3-small',
      input: query,
      dimensions: 512
    });
    
    const embedding = embeddingResponse.data[0].embedding;
    console.log('✅ Embedding generated, length:', embedding.length);
    
    // Query Pinecone for similar videos
    console.log('🔌 Querying Pinecone index:', process.env.PINECONE_INDEX_NAME);
    const index = pinecone.index(process.env.PINECONE_INDEX_NAME!);
    const pineconeResponse = await index.query({
      vector: embedding,
      topK: 200, // Get more results to filter locally
      includeMetadata: true,
    });

    console.log('📊 Pinecone response:', {
      matches_count: pineconeResponse.matches?.length || 0,
      has_matches: !!pineconeResponse.matches && pineconeResponse.matches.length > 0,
      first_few_matches: pineconeResponse.matches?.slice(0, 3).map(m => ({
        id: m.id,
        score: m.score,
        metadata: m.metadata
      }))
    });

    if (!pineconeResponse.matches || pineconeResponse.matches.length === 0) {
      console.log('❌ No matches found in Pinecone');
      return NextResponse.json({ 
        results: [], 
        hasMore: false,
        totalFound: 0 
      });
    }

    // Extract video IDs and build metadata map
    const videoMatches = pineconeResponse.matches.map(match => ({
      id: match.id,
      similarity: match.score || 0,
      metadata: match.metadata
    }));
    console.log('📝 Total video matches:', videoMatches.length);

    // Filter by similarity threshold (relevance) - use higher threshold for better quality
    const adjustedRelevance = relevance < 0.5 ? 0.5 : relevance; // Minimum 0.5 similarity
    const relevantMatches = videoMatches.filter(match => match.similarity >= adjustedRelevance);
    console.log(`🎯 Relevant matches (similarity >= ${adjustedRelevance}):`, relevantMatches.length);

    // Check if we have any relevant matches
    if (relevantMatches.length === 0) {
      console.log('⚠️ No matches meet the relevance threshold. Consider lowering the relevance parameter.');
      return NextResponse.json({ 
        results: [], 
        hasMore: false,
        totalFound: 0,
        debug: {
          message: 'No matches meet the relevance threshold',
          highest_similarity: videoMatches.length > 0 ? Math.max(...videoMatches.map(m => m.similarity)) : 0,
          relevance_threshold: relevance
        }
      });
    }

    // Get video details from database with performance data
    const videoIds = relevantMatches.map(match => match.id);
    console.log('🔍 Looking up videos in database:', {
      video_ids_count: videoIds.length,
      sample_ids: videoIds.slice(0, 5)
    });
    
    let query_builder = supabase
      .from('videos')
      .select(`
        id,
        title,
        channel_name,
        thumbnail_url,
        view_count,
        published_at,
        format_type,
        duration,
        rolling_baseline_views,
        channel_avg_views
      `)
      .in('id', videoIds)
      .not('duration', 'is', null);

    // Apply format filter if specified
    if (format) {
      console.log('🏷️ Applying format filter:', format);
      query_builder = query_builder.eq('format_type', format);
    }

    // Apply view count filters
    if (minViews && !isNaN(parseInt(minViews))) {
      console.log('📊 Applying min views filter:', minViews);
      query_builder = query_builder.gte('view_count', parseInt(minViews));
    }
    if (maxViews && !isNaN(parseInt(maxViews))) {
      console.log('📊 Applying max views filter:', maxViews);
      query_builder = query_builder.lte('view_count', parseInt(maxViews));
    }

    // Apply date filter
    if (dateFilter === 'custom' && customStartDate && customEndDate) {
      console.log('📅 Applying custom date filter:', customStartDate, 'to', customEndDate);
      query_builder = query_builder
        .gte('published_at', new Date(customStartDate).toISOString())
        .lte('published_at', new Date(customEndDate).toISOString());
    } else if (dateFilter !== 'all') {
      console.log('📅 Applying date filter:', dateFilter);
      const cutoffDate = new Date();
      cutoffDate.setTime(cutoffDate.getTime() - (
        dateFilter === '1week' ? 7 * 24 * 60 * 60 * 1000 :
        dateFilter === '1month' ? 30 * 24 * 60 * 60 * 1000 :
        dateFilter === '3months' ? 90 * 24 * 60 * 60 * 1000 :
        dateFilter === '6months' ? 180 * 24 * 60 * 60 * 1000 :
        365 * 24 * 60 * 60 * 1000
      ));
      query_builder = query_builder.gte('published_at', cutoffDate.toISOString());
    }

    const { data: videos, error } = await query_builder;

    if (error) {
      console.error('❌ Database error:', error);
      return NextResponse.json({ error: 'Database error' }, { status: 500 });
    }

    console.log('💾 Database query results:', {
      videos_found: videos?.length || 0,
      has_videos: !!videos && videos.length > 0,
      sample_videos: videos?.slice(0, 3).map(v => ({
        id: v.id,
        title: v.title,
        format_type: v.format_type,
        rolling_baseline_views: v.rolling_baseline_views
      }))
    });

    if (!videos || videos.length === 0) {
      console.log('❌ No videos found in database matching the criteria');
      return NextResponse.json({ 
        results: [], 
        hasMore: false,
        totalFound: 0 
      });
    }

    // Filter out shorts (videos under 60 seconds) - same as packaging API
    const videosWithoutShorts = videos.filter(video => {
      if (!video.duration) return false;
      
      // Filter out shorts: PT[0-9]+S (PT15S, PT45S) or PT[1-5][0-9]S (PT10S-PT59S)
      const isShort = /^PT[0-9]+S$/.test(video.duration) || /^PT[1-5][0-9]S$/.test(video.duration);
      return !isShort;
    });
    
    console.log(`🎬 Filtered out shorts: ${videos.length - videosWithoutShorts.length} shorts removed, ${videosWithoutShorts.length} videos remaining`);

    // Calculate performance ratios and combine with similarity scores
    const enrichedVideos = videosWithoutShorts.map(video => {
      const match = relevantMatches.find(m => m.id === video.id);
      const baselineViews = video.rolling_baseline_views || video.view_count || 1;
      const performanceRatio = video.view_count / baselineViews;
      
      return {
        ...video,
        performance_ratio: performanceRatio,
        similarity: match?.similarity || 0,
        channel_avg_views: video.channel_avg_views || video.rolling_baseline_views,
        rolling_baseline_views: undefined // Remove from response
      };
    });

    console.log('📈 Performance calculations:', {
      total_enriched: enrichedVideos.length,
      sample_performance: enrichedVideos.slice(0, 3).map(v => ({
        title: v.title,
        view_count: v.view_count,
        performance_ratio: v.performance_ratio,
        similarity: v.similarity
      }))
    });

    // Filter by performance threshold
    const filteredVideos = enrichedVideos.filter(
      video => video.performance_ratio >= performanceThreshold
    );
    console.log(`🎯 Videos meeting performance threshold (>= ${performanceThreshold}):`, filteredVideos.length);

    // Sort videos based on sortBy parameter
    const sortedVideos = filteredVideos.sort((a, b) => {
      switch (sortBy) {
        case 'view_count':
          return b.view_count - a.view_count;
        case 'published_at':
          return new Date(b.published_at).getTime() - new Date(a.published_at).getTime();
        case 'performance_ratio':
          return b.performance_ratio - a.performance_ratio;
        case 'relevance':
        default:
          // Default: relevance × log(performance)
          const scoreA = a.similarity * Math.log(a.performance_ratio + 1);
          const scoreB = b.similarity * Math.log(b.performance_ratio + 1);
          return scoreB - scoreA;
      }
    });

    // Paginate results
    const startIndex = (page - 1) * limit;
    const endIndex = startIndex + limit;
    const paginatedResults = sortedVideos.slice(startIndex, endIndex);
    const hasMore = endIndex < sortedVideos.length;

    console.log('📄 Final results:', {
      total_sorted: sortedVideos.length,
      page,
      limit,
      start_index: startIndex,
      end_index: endIndex,
      paginated_count: paginatedResults.length,
      has_more: hasMore,
      top_results: paginatedResults.slice(0, 3).map(v => ({
        title: v.title,
        performance_ratio: v.performance_ratio,
        similarity: v.similarity,
        combined_score: v.similarity * Math.log(v.performance_ratio + 1)
      }))
    });

    return NextResponse.json({
      results: paginatedResults,
      hasMore,
      totalFound: sortedVideos.length,
      page
    });

  } catch (error) {
    console.error('❌ Pattern search error:', {
      error,
      message: error instanceof Error ? error.message : 'Unknown error',
      stack: error instanceof Error ? error.stack : undefined
    });
    return NextResponse.json(
      { error: 'Failed to search patterns' },
      { status: 500 }
    );
  }
}