import { NextResponse } from 'next/server';

function getStrategyDescription(strategy: string): string {
  switch (strategy) {
    case 'semantic':
      return 'Direct topic matches using AI similarity';
    case 'format':
      return 'Content format and structure patterns';
    case 'competitive':
      return 'Competitive analysis and comparisons';
    case 'performance':
      return 'High-performing content in this category';
    case 'use_case':
      return 'Practical applications and use cases';
    case 'user_feedback':
      return 'User reviews and testimonials';
    case 'feature_analysis':
      return 'Feature-specific deep dives';
    case 'niche':
      return 'Niche and specialized content';
    default:
      return 'Related content discovery';
  }
}

interface SearchStrategy {
  type: 'semantic' | 'format' | 'competitive';
  query: string;
  weight: number;
  format_filter?: string;
  performance_filter?: string;
}

interface SearchResult {
  id: string;
  title: string;
  channel_name: string;
  thumbnail_url: string;
  view_count: number;
  published_at: string;
  format_type: string;
  performance_ratio: number;
  similarity?: number;
  source_strategy?: string;
  relevance_score?: number;
}

export async function POST(request: Request) {
  try {
    const { 
      query,
      page = 1,
      limit = 20,
      filters = {},
      fastMode = false // New parameter for immediate results
    } = await request.json();

    if (!query || query.trim().length === 0) {
      return NextResponse.json({ error: 'Query is required' }, { status: 400 });
    }

    console.log('🎯 Intelligent search for:', query, fastMode ? '(fast mode)' : '(full AI mode)');

    // Fast mode: Return immediate semantic + keyword results
    if (fastMode) {
      const immediatePromises = [
        // Semantic search
        fetch(new URL('/api/youtube/pattern-search', request.url), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            query,
            relevance: 0.5, // Higher threshold for better quality
            performanceThreshold: 0.3,
            page,
            limit: Math.ceil(limit * 0.4), // 40% semantic
            ...filters
          })
        }),
        // Keyword search via packaging API - prioritize this with higher limit
        fetch(new URL(`/api/youtube/packaging?search=${encodeURIComponent(query)}&page=${page}&limit=${Math.ceil(limit * 0.6)}&competitorFilter=all&sortBy=performance_ratio&sortOrder=desc`, request.url))
      ];

      const [semanticResponse, keywordResponse] = await Promise.all(immediatePromises);
      const [semanticData, keywordData] = await Promise.all([
        semanticResponse.json(),
        keywordResponse.json()
      ]);

      // Merge and deduplicate
      const allResults: SearchResult[] = [];
      const seenIds = new Set<string>();

      // Add semantic results SECOND (lower priority)
      const semanticResults: SearchResult[] = [];
      (semanticData.results || []).forEach((result: any) => {
        if (!seenIds.has(result.id)) {
          seenIds.add(result.id);
          const semanticResult = {
            ...result,
            source_strategy: 'semantic: direct match',
            relevance_score: (result.similarity || 0.5) * 0.7 // Lower relevance for semantic
          };
          semanticResults.push(semanticResult);
          allResults.push(semanticResult);
        }
      });
      
      console.log('📊 Semantic results added:', semanticResults.length);

      // Add keyword results FIRST (higher priority)
      const keywordResults: SearchResult[] = [];
      (keywordData.data || []).forEach((result: any) => {
        if (!seenIds.has(result.id)) {
          seenIds.add(result.id);
          const keywordResult = {
            id: result.id,
            title: result.title,
            channel_name: result.channel_name,
            thumbnail_url: result.thumbnail_url,
            view_count: result.view_count,
            published_at: result.published_at,
            format_type: result.format_type || 'unknown',
            performance_ratio: result.performance_percent || 0,
            source_strategy: 'keyword: title match',
            relevance_score: 0.9 // Higher relevance for keyword matches
          };
          keywordResults.push(keywordResult);
          allResults.push(keywordResult);
        }
      });
      
      console.log('📊 Keyword results added:', keywordResults.length);

      // Sort results to prioritize keyword matches first
      const sortedResults = allResults.sort((a, b) => {
        // Keyword matches first
        if (a.source_strategy?.includes('keyword') && !b.source_strategy?.includes('keyword')) return -1;
        if (!a.source_strategy?.includes('keyword') && b.source_strategy?.includes('keyword')) return 1;
        
        // Then by relevance score
        return (b.relevance_score || 0) - (a.relevance_score || 0);
      });
      
      // Simple grouping for fast mode with proper ordering
      const keywordVideos = sortedResults.filter(r => r.source_strategy?.includes('keyword'));
      const semanticVideos = sortedResults.filter(r => r.source_strategy?.includes('semantic'));
      
      const groupedResults: { [key: string]: { videos: SearchResult[], category_name: string, emoji: string } } = {};
      
      // Keyword matches FIRST (most relevant)
      if (keywordVideos.length > 0) {
        groupedResults['🎯 Keyword Matches'] = {
          videos: keywordVideos,
          category_name: 'Keyword Matches',
          emoji: '🎯'
        };
      }
      
      // Semantic matches SECOND
      if (semanticVideos.length > 0) {
        groupedResults['📝 Semantic Matches'] = {
          videos: semanticVideos,
          category_name: 'Semantic Matches', 
          emoji: '📝'
        };
      }

      console.log('⚡ Fast search completed:', allResults.length, 'results');
      console.log('📊 Fast mode grouping debug:', {
        total_results: allResults.length,
        semantic_count: allResults.filter(r => r.source_strategy?.includes('semantic')).length,
        keyword_count: allResults.filter(r => r.source_strategy?.includes('keyword')).length,
        sample_strategies: allResults.slice(0, 3).map(r => ({ title: r.title, strategy: r.source_strategy }))
      });
      
      return NextResponse.json({
        results: sortedResults,
        hasMore: false,
        totalFound: allResults.length,
        page,
        grouped_results: groupedResults,
        fastMode: true,
        strategies_used: [
          { strategy: 'keyword', query, results_count: groupedResults['🎯 Keyword Matches']?.videos.length || 0, description: 'Exact keyword title matching' },
          { strategy: 'semantic', query, results_count: groupedResults['📝 Semantic Matches']?.videos.length || 0, description: 'AI similarity search' }
        ]
      });
    }

    // Full AI mode: Get LLM expansion first
    const expansionResponse = await fetch(new URL('/api/youtube/research-expansion', request.url), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query })
    });

    const expansion = await expansionResponse.json();
    console.log('🧠 Expansion strategies:', expansion.search_strategies?.length || 0);

    // Step 2: Execute multiple search strategies in parallel
    const searchPromises = expansion.search_strategies?.map(async (strategy: SearchStrategy) => {
      try {
        if (strategy.type === 'semantic' || strategy.type === 'format' || strategy.type === 'competitive') {
          // Use pattern-search for ALL searches (semantic search works better than keyword matching)
          const response = await fetch(new URL('/api/youtube/pattern-search', request.url), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              query: strategy.query,
              format: strategy.format_filter,
              relevance: 0.5, // Higher threshold for better quality // Lower threshold for broader discovery
              performanceThreshold: strategy.performance_filter === 'high' ? 2.0 : 0.3,
              page: 1,
              limit: Math.ceil(limit * strategy.weight),
              ...filters
            })
          });
          
          const data = await response.json();
          return {
            strategy: strategy.type,
            query: strategy.query,
            weight: strategy.weight,
            results: (data.results || []).map((r: any) => ({
              ...r,
              source_strategy: `${strategy.type}: ${strategy.query}`,
              relevance_score: (r.similarity || 0.5) * strategy.weight
            }))
          };
        }
      } catch (error) {
        console.error(`❌ Search strategy failed (${strategy.type}):`, error);
        return { strategy: strategy.type, query: strategy.query, weight: strategy.weight, results: [] };
      }
    }) || [];

    const searchResults = await Promise.all(searchPromises);
    console.log('📊 Search results from strategies:', searchResults.map(r => ({ strategy: r.strategy, count: r.results.length })));

    // Step 3: Merge and deduplicate results
    const allResults: SearchResult[] = [];
    const seenIds = new Set<string>();

    searchResults.forEach(strategyResult => {
      strategyResult.results.forEach((result: SearchResult) => {
        if (!seenIds.has(result.id)) {
          seenIds.add(result.id);
          allResults.push({
            ...result,
            source_strategy: `${strategyResult.strategy}: ${strategyResult.query}`,
            relevance_score: strategyResult.weight
          });
        }
      });
    });

    // Step 4: Sort by relevance score (similarity * strategy weight * performance)
    const sortedResults = allResults.sort((a, b) => {
      const scoreA = (a.relevance_score || 0.5) * Math.log(a.performance_ratio + 1);
      const scoreB = (b.relevance_score || 0.5) * Math.log(b.performance_ratio + 1);
      return scoreB - scoreA;
    });

    // Step 5: Paginate
    const startIndex = (page - 1) * limit;
    const endIndex = startIndex + limit;
    const paginatedResults = sortedResults.slice(startIndex, endIndex);
    const hasMore = endIndex < sortedResults.length;

    console.log('✅ Intelligent search completed:', {
      total_found: sortedResults.length,
      returned: paginatedResults.length,
      has_more: hasMore,
      strategies_used: searchResults.length
    });

    // Group results by strategy with Netflix-style category names
    const groupedResults: { [key: string]: { videos: SearchResult[], category_name: string, emoji: string } } = {};
    
    // Create a mapping of strategy queries to their category info
    const strategyCategories: { [key: string]: { name: string, emoji: string } } = {};
    expansion.search_strategies?.forEach((strategy: any) => {
      if (strategy.category_name && strategy.category_emoji) {
        strategyCategories[strategy.query] = {
          name: strategy.category_name,
          emoji: strategy.category_emoji
        };
      }
    });
    
    sortedResults.forEach(result => {
      const strategyParts = result.source_strategy?.split(': ') || ['unknown', 'unknown'];
      const strategyType = strategyParts[0];
      const strategyQuery = strategyParts[1];
      
      // Try to find category info by query first, then by type
      let categoryInfo = strategyCategories[strategyQuery];
      
      if (!categoryInfo) {
        // Find by partial match or strategy type
        const matchingStrategy = expansion.search_strategies?.find((s: any) => 
          s.query === strategyQuery || s.type === strategyType
        );
        
        if (matchingStrategy?.category_name && matchingStrategy?.category_emoji) {
          categoryInfo = {
            name: matchingStrategy.category_name,
            emoji: matchingStrategy.category_emoji
          };
        } else {
          // Fallback based on strategy type
          switch (strategyType) {
            case 'semantic':
              categoryInfo = { name: 'Direct Matches', emoji: '🎯' };
              break;
            case 'format':
              categoryInfo = { name: 'Content Formats', emoji: '📋' };
              break;
            case 'competitive':
              categoryInfo = { name: 'Competitive Analysis', emoji: '⚔️' };
              break;
            default:
              categoryInfo = { name: 'Related Content', emoji: '🎬' };
          }
        }
      }
      
      const categoryKey = `${categoryInfo.emoji} ${categoryInfo.name}`;
      
      if (!groupedResults[categoryKey]) {
        groupedResults[categoryKey] = {
          videos: [],
          category_name: categoryInfo.name,
          emoji: categoryInfo.emoji
        };
      }
      groupedResults[categoryKey].videos.push(result);
    });

    return NextResponse.json({
      results: paginatedResults,
      hasMore,
      totalFound: sortedResults.length,
      page,
      grouped_results: groupedResults,
      expansion: {
        terms: expansion.expanded_terms || [],
        content_types: expansion.content_types || [],
        research_angles: expansion.research_angles || []
      },
      strategies_used: searchResults.map(r => ({ 
        strategy: r.strategy, 
        query: r.query, 
        results_count: r.results.length,
        description: getStrategyDescription(r.strategy)
      }))
    });

  } catch (error) {
    console.error('❌ Intelligent search error:', error);
    return NextResponse.json(
      { error: 'Failed to perform intelligent search' },
      { status: 500 }
    );
  }
}