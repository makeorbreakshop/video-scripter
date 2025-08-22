/**
 * Multi-Dimensional Concept Search API
 * Supports topic similarity, psychological similarity, format similarity, and channel analysis
 */

import { NextRequest, NextResponse } from 'next/server';
import { getSupabase } from '@/lib/supabase-lazy';
import { generateQueryEmbedding } from '@/lib/title-embeddings';
import { pineconeService } from '@/lib/pinecone-service';


interface MultiDimensionalSearchRequest {
  semantic_queries: string[];
  multi_dimensional_queries?: {
    topic_similarity?: string[];
    psychological_similarity?: string[];
    format_similarity?: string[];
  };
  target_channel_id?: string; // For channel analysis
  min_performance_ratio?: number;
  limit?: number;
  min_score?: number;
}

export async function POST(request: NextRequest) {
  const supabase = getSupabase();
  try {
    const { 
      semantic_queries,
      multi_dimensional_queries,
      target_channel_id,
      min_performance_ratio = 1.5,
      limit = 30,
      min_score = 0.3 
    }: MultiDimensionalSearchRequest = await request.json();

    console.log('🔍 Multi-dimensional search started');
    console.log('📊 Query breakdown:', {
      total_queries: semantic_queries.length,
      topic_queries: multi_dimensional_queries?.topic_similarity?.length || 0,
      psychology_queries: multi_dimensional_queries?.psychological_similarity?.length || 0,
      format_queries: multi_dimensional_queries?.format_similarity?.length || 0,
      target_channel: target_channel_id || 'none'
    });

    const allFoundVideos = new Map<string, {
      video_id: string;
      similarity_score: number;
      source: 'topic' | 'psychology' | 'format' | 'channel' | 'summary';
      query: string;
    }>();

    // 1. Topic Similarity Search (Title Embeddings - Default Namespace)
    if (multi_dimensional_queries?.topic_similarity) {
      console.log('🎯 Searching topic similarity via title embeddings (default namespace)...');
      
      for (const query of multi_dimensional_queries.topic_similarity) {
        try {
          const embedding = await generateQueryEmbedding(query, process.env.OPENAI_API_KEY!);
          const results = await pineconeService.searchSimilar(embedding, 20, min_score, 0, undefined); // Default namespace
          
          results.results.forEach(r => {
            const existing = allFoundVideos.get(r.video_id);
            if (!existing || existing.similarity_score < r.similarity_score) {
              allFoundVideos.set(r.video_id, {
                video_id: r.video_id,
                similarity_score: r.similarity_score,
                source: 'topic',
                query
              });
            }
          });
          
          console.log(`  "${query}": ${results.results.length} results`);
        } catch (error) {
          console.error(`Topic search failed for "${query}":`, error);
        }
      }
    }

    // 2. Psychological Similarity Search (Summary Embeddings - 'llm-summaries' Namespace)
    if (multi_dimensional_queries?.psychological_similarity) {
      console.log('🧠 Searching psychological similarity via summary embeddings (llm-summaries namespace)...');
      
      for (const query of multi_dimensional_queries.psychological_similarity) {
        try {
          const embedding = await generateQueryEmbedding(query, process.env.OPENAI_API_KEY!);
          const results = await pineconeService.searchSimilar(embedding, 20, min_score * 0.8, 0, 'llm-summaries'); // Summary namespace
          
          results.results.forEach(r => {
            const existing = allFoundVideos.get(r.video_id);
            const weightedScore = r.similarity_score * 1.2; // Boost psychology matches
            if (!existing || existing.similarity_score < weightedScore) {
              allFoundVideos.set(r.video_id, {
                video_id: r.video_id,
                similarity_score: weightedScore,
                source: 'psychology',
                query
              });
            }
          });
          
          console.log(`  "${query}": ${results.results.length} results`);
        } catch (error) {
          console.error(`Psychology search failed for "${query}":`, error);
        }
      }
    }

    // 3. Format Similarity Search (Title Embeddings - Default Namespace)
    if (multi_dimensional_queries?.format_similarity) {
      console.log('📝 Searching format similarity via title embeddings (default namespace)...');
      
      for (const query of multi_dimensional_queries.format_similarity) {
        try {
          const embedding = await generateQueryEmbedding(query, process.env.OPENAI_API_KEY!);
          const results = await pineconeService.searchSimilar(embedding, 15, min_score, 0, undefined); // Default namespace
          
          results.results.forEach(r => {
            const existing = allFoundVideos.get(r.video_id);
            if (!existing || existing.similarity_score < r.similarity_score) {
              allFoundVideos.set(r.video_id, {
                video_id: r.video_id,
                similarity_score: r.similarity_score,
                source: 'format',
                query
              });
            }
          });
          
          console.log(`  "${query}": ${results.results.length} results`);
        } catch (error) {
          console.error(`Format search failed for "${query}":`, error);
        }
      }
    }

    // 4. Channel Outlier Analysis (if target channel specified)
    if (target_channel_id) {
      console.log('📺 Analyzing target channel outliers...');
      
      try {
        // Get channel outliers from last 2 years with 1.5x+ performance
        const twoYearsAgo = new Date();
        twoYearsAgo.setFullYear(twoYearsAgo.getFullYear() - 2);

        const { data: channelOutliers } = await supabase
          .from('videos')
          .select('id, title, view_count, temporal_performance_score, published_at')
          .eq('channel_id', target_channel_id)
          .gte('temporal_performance_score', 1.5)
          .gte('published_at', twoYearsAgo.toISOString())
          .order('temporal_performance_score', { ascending: false })
          .limit(20);

        if (channelOutliers) {
          channelOutliers.forEach(video => {
            allFoundVideos.set(video.id, {
              video_id: video.id,
              similarity_score: video.temporal_performance_score || 1.5,
              source: 'channel',
              query: 'channel_outlier_analysis'
            });
          });
          
          console.log(`  Found ${channelOutliers.length} channel outliers`);
        }
      } catch (error) {
        console.error('Channel analysis failed:', error);
      }
    }

    console.log(`🎯 Total unique videos found: ${allFoundVideos.size}`);

    // 5. Get full video data and apply performance filtering
    if (allFoundVideos.size === 0) {
      return NextResponse.json({
        results: [],
        summary: 'No videos found matching the search criteria',
        search_details: {
          total_queries: semantic_queries.length,
          total_videos_found: 0,
          after_performance_filter: 0
        }
      });
    }

    const videoIds = Array.from(allFoundVideos.keys());
    const { data: videos } = await supabase
      .from('videos')
      .select(`
        id, title, channel_id, channel_name, thumbnail_url, view_count, 
        published_at, temporal_performance_score, format_type, topic_niche
      `)
      .in('id', videoIds)
      .gte('temporal_performance_score', min_performance_ratio)
      .lte('temporal_performance_score', 100) // Cap to exclude corrupted data
      .not('title', 'ilike', '%#shorts%')
      .not('description', 'ilike', '%#shorts%')
      .order('temporal_performance_score', { ascending: false })
      .limit(limit);

    if (!videos || videos.length === 0) {
      return NextResponse.json({
        results: [],
        summary: 'No high-performing videos found after filtering',
        search_details: {
          total_queries: semantic_queries.length,
          total_videos_found: allFoundVideos.size,
          after_performance_filter: 0
        }
      });
    }

    // 6. Enrich with search metadata
    const enrichedResults = videos.map(video => {
      const searchInfo = allFoundVideos.get(video.id);
      return {
        ...video,
        video_id: video.id, // Ensure video_id field for frontend compatibility
        search_score: searchInfo?.similarity_score || 0,
        search_source: searchInfo?.source || 'unknown',
        matching_query: searchInfo?.query || 'unknown',
        performance_ratio: video.temporal_performance_score || 0
      };
    });

    const sourceBreakdown = {
      topic: enrichedResults.filter(v => v.search_source === 'topic').length,
      psychology: enrichedResults.filter(v => v.search_source === 'psychology').length,
      format: enrichedResults.filter(v => v.search_source === 'format').length,
      channel: enrichedResults.filter(v => v.search_source === 'channel').length
    };

    console.log('✅ Multi-dimensional search complete');
    console.log('📊 Results breakdown:', sourceBreakdown);

    return NextResponse.json({
      results: enrichedResults,
      summary: `Found ${enrichedResults.length} high-performing videos across ${Object.values(sourceBreakdown).filter(v => v > 0).length} search dimensions`,
      search_details: {
        total_queries: semantic_queries.length,
        total_videos_found: allFoundVideos.size,
        after_performance_filter: enrichedResults.length,
        source_breakdown: sourceBreakdown,
        performance_threshold: min_performance_ratio
      }
    });

  } catch (error) {
    console.error('Multi-dimensional search failed:', error);
    return NextResponse.json(
      { 
        error: 'Search failed',
        details: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  }
}