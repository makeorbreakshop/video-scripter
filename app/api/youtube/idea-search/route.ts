import { NextRequest, NextResponse } from 'next/server';
import { getSupabase } from '@/lib/supabase-lazy';
import { openai } from '@/lib/openai-client';
import { Pinecone } from '@pinecone-database/pinecone';


const pinecone = new Pinecone({
  apiKey: process.env.PINECONE_API_KEY!
});

interface SearchResult {
  video: any;
  similarity: number;
  performanceRatio: number;
  daysAgo: number;
  insights: {
    format: string;
    performanceVsAvg: string;
    trend: 'up' | 'down' | 'stable';
    competitionLevel: 'low' | 'medium' | 'high';
  };
}

export async function POST(request: NextRequest) {
  const supabase = getSupabase();
  try {
    const { query, limit = 20, includeFormats = false } = await request.json();

    if (!query || typeof query !== 'string') {
      return NextResponse.json({ error: 'Query is required' }, { status: 400 });
    }

    console.log('🔍 Searching for video idea:', query);

    // Step 1: Generate embedding for the query
    const embeddingResponse = await openai.embeddings.create({
      model: 'text-embedding-3-small',
      input: query,
      dimensions: 512
    });

    const queryEmbedding = embeddingResponse.data[0].embedding;

    // Step 2: Search Pinecone for similar videos
    const index = pinecone.index(process.env.PINECONE_INDEX_NAME!);
    const searchResults = await index.query({
      vector: queryEmbedding,
      topK: limit * 2, // Get more to filter later
      includeMetadata: true
    });

    if (!searchResults.matches || searchResults.matches.length === 0) {
      return NextResponse.json({ 
        results: [], 
        message: 'No similar videos found. This might be a unique idea!' 
      });
    }

    // Step 3: Get full video data from Supabase
    const videoIds = searchResults.matches.map(match => match.id);
    const { data: videos, error: videosError } = await supabase
      .from('videos')
      .select(`
        *,
        baseline_analytics (
          views,
          likes,
          comments,
          estimated_minutes_watched
        )
      `)
      .in('id', videoIds);

    if (videosError) {
      console.error('Error fetching videos:', videosError);
      return NextResponse.json({ error: 'Failed to fetch video data' }, { status: 500 });
    }

    // Step 4: Calculate performance metrics and insights
    const now = new Date();
    const results: SearchResult[] = [];

    for (const match of searchResults.matches) {
      const video = videos?.find(v => v.id === match.id);
      if (!video) continue;

      // Calculate performance ratio
      const baselineViews = video.baseline_analytics?.views || video.channel_avg_views || video.view_count || 1;
      const performanceRatio = video.view_count / baselineViews;

      // Calculate days since published
      const publishedDate = new Date(video.published_at);
      const daysAgo = Math.floor((now.getTime() - publishedDate.getTime()) / (1000 * 60 * 60 * 24));

      // Determine competition level based on topic
      const { data: topicVideos } = await supabase
        .from('videos')
        .select('id', { count: 'exact', head: true })
        .eq('topic_level_3', video.topic_level_3)
        .gte('published_at', new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000).toISOString());

      const competitionLevel = 
        (topicVideos?.count || 0) > 50 ? 'high' :
        (topicVideos?.count || 0) > 20 ? 'medium' : 'low';

      // Determine trend (simplified - could be more sophisticated)
      const trend = performanceRatio > 1.2 ? 'up' : 
                   performanceRatio < 0.8 ? 'down' : 'stable';

      results.push({
        video: {
          id: video.id,
          title: video.title,
          channel_title: video.channel_name,
          thumbnail_url: video.thumbnail_url,
          published_at: video.published_at,
          view_count: video.view_count,
          like_count: video.like_count,
          comment_count: video.comment_count,
          duration: video.duration,
          topic_level_1: video.topic_level_1,
          topic_level_2: video.topic_level_2,
          topic_level_3: video.topic_level_3,
          format_type: video.format_type,
          url: `https://youtube.com/watch?v=${video.id}`
        },
        similarity: match.score || 0,
        performanceRatio,
        daysAgo,
        insights: {
          format: video.format_type || 'unknown',
          performanceVsAvg: performanceRatio > 2 ? 'Exceptional' :
                           performanceRatio > 1.5 ? 'Above average' :
                           performanceRatio > 0.8 ? 'Average' : 'Below average',
          trend,
          competitionLevel
        }
      });
    }

    // Sort by relevance score (combination of similarity and performance)
    results.sort((a, b) => {
      // Weight similarity more heavily for recent videos
      const aScore = a.similarity * (a.daysAgo < 30 ? 1.2 : 1) * Math.sqrt(a.performanceRatio);
      const bScore = b.similarity * (b.daysAgo < 30 ? 1.2 : 1) * Math.sqrt(b.performanceRatio);
      return bScore - aScore;
    });

    // Step 5: If requested, analyze format distribution
    let formatAnalysis = null;
    if (includeFormats) {
      const formatStats = results.reduce((acc, result) => {
        const format = result.video.format_type || 'unknown';
        if (!acc[format]) {
          acc[format] = {
            count: 0,
            avgPerformance: 0,
            videos: []
          };
        }
        acc[format].count++;
        acc[format].avgPerformance += result.performanceRatio;
        acc[format].videos.push(result);
        return acc;
      }, {} as Record<string, any>);

      formatAnalysis = Object.entries(formatStats)
        .map(([format, stats]) => ({
          format,
          count: stats.count,
          avgPerformance: stats.avgPerformance / stats.count,
          percentage: (stats.count / results.length) * 100,
          topVideo: stats.videos.sort((a: any, b: any) => b.performanceRatio - a.performanceRatio)[0]
        }))
        .sort((a, b) => b.avgPerformance - a.avgPerformance);
    }

    // Step 6: Generate timeline insights
    const timelineData = results
      .map(r => ({
        date: r.video.published_at,
        performance: r.performanceRatio,
        title: r.video.title
      }))
      .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

    // Identify publishing patterns
    const publishingInsights = {
      recentActivity: results.filter(r => r.daysAgo < 30).length,
      peakMonth: getMostActiveMonth(results),
      averageGap: getAveragePublishingGap(results)
    };

    return NextResponse.json({
      query,
      results: results.slice(0, limit),
      summary: {
        totalFound: results.length,
        avgPerformance: results.reduce((sum, r) => sum + r.performanceRatio, 0) / results.length,
        topPerformer: results[0],
        uniqueFormats: [...new Set(results.map(r => r.video.format_type))].filter(Boolean).length
      },
      formatAnalysis,
      timeline: timelineData,
      publishingInsights,
      recommendations: generateRecommendations(results, query)
    });

  } catch (error) {
    console.error('Idea search error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

function getMostActiveMonth(results: SearchResult[]): string {
  const monthCounts = results.reduce((acc, r) => {
    const month = new Date(r.video.published_at).toISOString().slice(0, 7);
    acc[month] = (acc[month] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  const [topMonth] = Object.entries(monthCounts)
    .sort(([, a], [, b]) => b - a)[0] || ['Unknown', 0];

  return topMonth;
}

function getAveragePublishingGap(results: SearchResult[]): number {
  const sorted = results
    .sort((a, b) => new Date(b.video.published_at).getTime() - new Date(a.video.published_at).getTime());

  if (sorted.length < 2) return 0;

  let totalGap = 0;
  for (let i = 1; i < sorted.length; i++) {
    const gap = new Date(sorted[i-1].video.published_at).getTime() - 
                new Date(sorted[i].video.published_at).getTime();
    totalGap += gap;
  }

  return Math.floor(totalGap / (sorted.length - 1) / (1000 * 60 * 60 * 24)); // Days
}

function generateRecommendations(results: SearchResult[], query: string): string[] {
  const recommendations: string[] = [];

  // Format recommendation
  const topFormat = results[0]?.video.format_type;
  if (topFormat) {
    const formatCount = results.filter(r => r.video.format_type === topFormat).length;
    const formatPerf = results
      .filter(r => r.video.format_type === topFormat)
      .reduce((sum, r) => sum + r.performanceRatio, 0) / formatCount;
    
    recommendations.push(
      `Consider using the "${topFormat}" format - it appears in ${formatCount} similar videos with ${formatPerf.toFixed(1)}x average performance`
    );
  }

  // Timing recommendation
  const recentCount = results.filter(r => r.daysAgo < 30).length;
  if (recentCount === 0) {
    recommendations.push('This topic hasn\'t been covered recently - great opportunity for fresh content!');
  } else if (recentCount > 5) {
    recommendations.push('This topic is trending - move quickly to capitalize on current interest');
  }

  // Competition recommendation
  const highCompetition = results.filter(r => r.insights.competitionLevel === 'high').length;
  if (highCompetition > results.length * 0.5) {
    recommendations.push('High competition detected - focus on unique angle or superior production quality');
  }

  // Length recommendation
  const avgDuration = results.reduce((sum, r) => sum + (r.video.duration || 0), 0) / results.length;
  if (avgDuration > 0) {
    const minutes = Math.floor(avgDuration / 60);
    recommendations.push(`Optimal video length appears to be around ${minutes} minutes based on similar content`);
  }

  return recommendations;
}