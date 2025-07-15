import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

// Use service role for better performance with database functions
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  {
    auth: {
      autoRefreshToken: false,
      persistSession: false
    }
  }
);

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const search = searchParams.get('search') || '';
    const sortBy = searchParams.get('sortBy') || 'performance_ratio';
    const sortOrder = searchParams.get('sortOrder') || 'desc';
    const performanceFilter = searchParams.get('performanceFilter') || '';
    const dateFilter = searchParams.get('dateFilter') || 'all';
    const competitorFilter = searchParams.get('competitorFilter') || 'mine';
    const minViews = searchParams.get('minViews');
    const maxViews = searchParams.get('maxViews');
    const page = parseInt(searchParams.get('page') || '1');
    const limit = parseInt(searchParams.get('limit') || '24');
    const offset = (page - 1) * limit;

    console.log('🚀 Materialized view packaging API called with filters:', {
      search, sortBy, sortOrder, performanceFilter, dateFilter, competitorFilter, minViews, maxViews, page, limit
    });

    const startTime = Date.now();

    // Build dynamic query for materialized view
    let query = supabase.from('packaging_performance').select('*', { count: 'exact' });

    // Apply filters
    if (competitorFilter === 'competitors') {
      query = query.eq('is_competitor', true);
    } else if (competitorFilter === 'mine' || competitorFilter === 'user') {
      query = query.eq('is_competitor', false);
    }

    // Date filter
    if (dateFilter !== 'all') {
      const intervals: { [key: string]: string } = {
        '1week': '1 week',
        '1month': '1 month', 
        '3months': '3 months',
        '6months': '6 months',
        '1year': '1 year'
      };
      if (intervals[dateFilter]) {
        const cutoffDate = new Date();
        cutoffDate.setTime(cutoffDate.getTime() - (
          dateFilter === '1week' ? 7 * 24 * 60 * 60 * 1000 :
          dateFilter === '1month' ? 30 * 24 * 60 * 60 * 1000 :
          dateFilter === '3months' ? 90 * 24 * 60 * 60 * 1000 :
          dateFilter === '6months' ? 180 * 24 * 60 * 60 * 1000 :
          365 * 24 * 60 * 60 * 1000
        ));
        query = query.gte('published_at', cutoffDate.toISOString());
      }
    }

    // Performance filter
    if (performanceFilter === 'high') {
      query = query.gte('performance_ratio', 2.0);
    } else if (performanceFilter === 'medium') {
      query = query.gte('performance_ratio', 1.0).lt('performance_ratio', 2.0);
    } else if (performanceFilter === 'low') {
      query = query.lt('performance_ratio', 1.0);
    }

    // View count filter
    if (minViews && !isNaN(parseInt(minViews))) {
      query = query.gte('view_count', parseInt(minViews));
    }
    if (maxViews && !isNaN(parseInt(maxViews))) {
      query = query.lte('view_count', parseInt(maxViews));
    }

    // Search filter - implement proper keyword search
    let searchWords: string[] = [];
    if (search) {
      searchWords = search.trim().toLowerCase().split(/\s+/).filter(word => word.length > 2);
      
      if (searchWords.length > 1) {
        // For multiple words, find videos containing ALL significant words (AND logic)
        // This gives more relevant results than OR logic
        searchWords.forEach(word => {
          query = query.ilike('title', `%${word}%`);
        });
      } else if (searchWords.length === 1) {
        // Single word search
        query = query.ilike('title', `%${searchWords[0]}%`);
      } else {
        // If no valid search words after filtering, use original search
        query = query.ilike('title', `%${search}%`);
      }
    }

    // Sorting
    const sortColumn = sortBy === 'performance_ratio' ? 'performance_ratio' :
                      sortBy === 'view_count' ? 'view_count' :
                      sortBy === 'published_at' ? 'published_at' : 'performance_ratio';
    
    query = query.order(sortColumn, { 
      ascending: sortOrder === 'asc',
      nullsFirst: false 
    });

    // Pagination
    query = query.range(offset, offset + limit - 1);

    const { data: results, error, count } = await query;

    const queryTime = Date.now() - startTime;

    if (error) {
      console.error('Database function error:', error);
      return NextResponse.json({ 
        error: 'Failed to fetch packaging data',
        details: error.message 
      }, { status: 500 });
    }

    if (!results || results.length === 0) {
      return NextResponse.json({ 
        data: [],
        total: 0,
        page,
        limit,
        message: 'No videos found matching your criteria'
      });
    }

    // Get total count from query result
    const totalCount = count || 0;

    // Transform results to match existing API interface
    let processedData = (results || []).map((video: any) => ({
      id: video.id,
      title: video.title,
      view_count: video.view_count,
      published_at: video.published_at,
      baseline_views: video.baseline_views || 0,
      performance_percent: Number((video.performance_ratio || 0).toFixed(2)),
      thumbnail_url: video.thumbnail_url || `https://i.ytimg.com/vi/${video.id}/hqdefault.jpg`,
      is_competitor: video.is_competitor,
      channel_id: video.channel_id,
      channel_name: video.channel_name || 'Unknown Channel',
      channel_avg_views: video.channel_avg_views || 0
    }));

    // Add relevance scoring for multi-word searches
    if (search && searchWords.length > 1) {
      processedData = processedData.map(video => {
        const titleLower = video.title.toLowerCase();
        let relevanceScore = 0;
        
        // Score based on word presence and position
        searchWords.forEach((word, index) => {
          if (titleLower.includes(word)) {
            // Base score for containing the word
            relevanceScore += 10;
            
            // Bonus for exact word match (not part of another word)
            const wordRegex = new RegExp(`\\b${word}\\b`, 'i');
            if (wordRegex.test(video.title)) {
              relevanceScore += 5;
            }
            
            // Bonus for word position (earlier = better)
            const position = titleLower.indexOf(word);
            if (position !== -1) {
              relevanceScore += Math.max(0, 10 - (position / titleLower.length) * 10);
            }
            
            // Bonus for word order matching search query
            if (index === 0 && position < 10) {
              relevanceScore += 5;
            }
          }
        });
        
        // Bonus for exact phrase match
        if (titleLower.includes(search.toLowerCase())) {
          relevanceScore += 20;
        }
        
        return { ...video, relevanceScore };
      });
      
      // Sort by relevance score first, then by original sort column
      processedData.sort((a, b) => {
        const scoreDiff = (b.relevanceScore || 0) - (a.relevanceScore || 0);
        if (scoreDiff !== 0) return scoreDiff;
        
        // Fall back to original sort
        if (sortBy === 'performance_ratio') {
          return (b.performance_percent || 0) - (a.performance_percent || 0);
        } else if (sortBy === 'view_count') {
          return (b.view_count || 0) - (a.view_count || 0);
        }
        return 0;
      });
    }

    console.log(`⚡ Materialized view query completed in ${queryTime}ms, returning ${processedData.length}/${totalCount} videos`);

    const totalPages = Math.ceil(totalCount / limit);
    const hasMore = page < totalPages;
    const hasPrevious = page > 1;

    return NextResponse.json({ 
      data: processedData,
      pagination: {
        page,
        limit,
        totalCount,
        totalPages,
        hasMore,
        hasPrevious
      },
      query_time_ms: queryTime,
      calculation_method: 'materialized_view',
      message: `Found ${totalCount} videos, showing page ${page}`
    });

  } catch (error) {
    console.error('API error:', error);
    return NextResponse.json({ 
      error: 'Internal server error',
      details: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 });
  }
}