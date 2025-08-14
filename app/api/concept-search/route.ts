import { NextRequest, NextResponse } from 'next/server';
import { generateQueryEmbedding } from '@/lib/title-embeddings';
import { pineconeService } from '@/lib/pinecone-service';

interface ConceptSearchRequest {
  semantic_queries: string[];
  min_performance_ratio?: number;
  limit?: number;
  min_score?: number;
}

interface ConceptSearchResult {
  video_id: string;
  title: string;
  channel_id: string;
  channel_name?: string;
  view_count: number;
  published_at: string;
  performance_ratio: number;
  similarity_score: number;
  thumbnail_url: string;
  matched_query: string;
  source: string;
}

export async function POST(request: NextRequest) {
  const startTime = Date.now();
  
  try {
    const body: ConceptSearchRequest = await request.json();
    const { 
      semantic_queries, 
      min_performance_ratio = 1.5, // Focus on outliers
      limit = 50,
      min_score = 0.3
    } = body;

    if (!semantic_queries || semantic_queries.length === 0) {
      return NextResponse.json(
        { error: 'semantic_queries array is required' },
        { status: 400 }
      );
    }

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        { error: 'OpenAI API key not configured' },
        { status: 500 }
      );
    }

    console.log(`🎯 Concept search with ${semantic_queries.length} queries, targeting ${min_performance_ratio}x+ temporal outliers`);

    const allResults: ConceptSearchResult[] = [];
    const seenVideoIds = new Set<string>();

    // Process each semantic query
    for (let i = 0; i < semantic_queries.length; i++) {
      const query = semantic_queries[i].trim();
      if (!query) continue;

      console.log(`🔍 Query ${i + 1}/${semantic_queries.length}: "${query}"`);

      try {
        // Generate query embedding
        const queryEmbedding = await generateQueryEmbedding(query, apiKey);
        
        // Search similar vectors in Pinecone - get more results to filter by temporal score
        const searchResponse = await pineconeService.searchSimilar(
          queryEmbedding,
          Math.max(50, Math.ceil(limit / semantic_queries.length * 10)), // Get many more results to filter
          min_score
        );

        // Get video IDs for temporal score lookup
        const videoIds = searchResponse.results
          .filter(video => !seenVideoIds.has(video.video_id))
          .map(video => video.video_id);

        if (videoIds.length === 0) continue;

        // Fetch temporal performance scores from Supabase
        const { createClient } = await import('@supabase/supabase-js');
        const supabase = createClient(
          process.env.NEXT_PUBLIC_SUPABASE_URL!,
          process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
        );

        const { data: temporalScores } = await supabase
          .from('videos')
          .select('id, temporal_performance_score, duration')
          .in('id', videoIds)
          .not('title', 'ilike', '%#shorts%')
          .not('description', 'ilike', '%#shorts%')
          .not('duration', 'in', '("PT1M","PT59S","PT58S","PT57S","PT56S","PT55S","PT54S","PT53S","PT52S","PT51S","PT50S","PT49S","PT48S","PT47S","PT46S","PT45S","PT44S","PT43S","PT42S","PT41S","PT40S","PT39S","PT38S","PT37S","PT36S","PT35S","PT34S","PT33S","PT32S","PT31S","PT30S","PT29S","PT28S","PT27S","PT26S","PT25S","PT24S","PT23S","PT22S","PT21S","PT20S","PT19S","PT18S","PT17S","PT16S","PT15S","PT14S","PT13S","PT12S","PT11S","PT10S","PT9S","PT8S","PT7S","PT6S","PT5S","PT4S","PT3S","PT2S","PT1S")');

        const temporalScoreMap = new Map(
          temporalScores?.map(v => [v.id, v.temporal_performance_score]) || []
        );

        // Filter results with temporal scores and deduplicate
        const filteredResults = searchResponse.results
          .filter(video => {
            const temporalScore = temporalScoreMap.get(video.video_id);
            return temporalScore && 
                   temporalScore >= min_performance_ratio && 
                   temporalScore <= 100 && // Cap at 100x to filter out edge cases
                   !seenVideoIds.has(video.video_id);
          })
          .map(video => {
            seenVideoIds.add(video.video_id);
            const temporalScore = temporalScoreMap.get(video.video_id);
            return {
              video_id: video.video_id,
              title: video.title,
              channel_id: video.channel_id,
              channel_name: video.channel_name,
              view_count: video.view_count,
              published_at: video.published_at,
              performance_ratio: temporalScore,
              similarity_score: Math.round(video.similarity_score * 100) / 100,
              thumbnail_url: `https://i.ytimg.com/vi/${video.video_id}/hqdefault.jpg`,
              matched_query: query,
              source: 'semantic_search'
            };
          });

        allResults.push(...filteredResults);
        console.log(`   ✅ Found ${filteredResults.length} outlier matches`);

      } catch (queryError) {
        console.error(`❌ Query "${query}" failed:`, queryError);
        // Continue with other queries even if one fails
      }
    }

    // Sort by performance ratio (highest outliers first) then by similarity
    allResults.sort((a, b) => {
      const perfDiff = b.performance_ratio - a.performance_ratio;
      if (Math.abs(perfDiff) > 0.1) return perfDiff;
      return b.similarity_score - a.similarity_score;
    });

    // Limit final results
    const finalResults = allResults.slice(0, limit);

    const queryTime = Date.now() - startTime;
    
    console.log(`🎯 Concept search completed: ${finalResults.length} outliers found in ${queryTime}ms`);
    console.log(`   Temporal performance range: ${finalResults[0]?.performance_ratio?.toFixed(1)}x - ${finalResults[finalResults.length - 1]?.performance_ratio?.toFixed(1)}x`);

    return NextResponse.json({
      results: finalResults,
      total_results: finalResults.length,
      queries_processed: semantic_queries.length,
      min_performance_ratio,
      query_time_ms: queryTime,
      search_summary: {
        total_candidates: allResults.length,
        final_results: finalResults.length,
        avg_performance: finalResults.length > 0 
          ? Math.round((finalResults.reduce((sum, r) => sum + r.performance_ratio, 0) / finalResults.length) * 10) / 10
          : 0
      }
    });

  } catch (error) {
    const queryTime = Date.now() - startTime;
    console.error('❌ Concept search failed:', error);
    
    return NextResponse.json(
      { 
        error: 'Failed to perform concept search',
        details: error instanceof Error ? error.message : 'Unknown error',
        query_time_ms: queryTime,
      },
      { status: 500 }
    );
  }
}