import { NextRequest, NextResponse } from 'next/server';
import { openai } from '@/lib/openai-client';
import { pineconeService } from '@/lib/pinecone-service';
import { getSupabase } from '@/lib/supabase-lazy';

// Initialize Supabase client
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  video_id: string;
  title: string;
  channel_name: string;
  channel_id: string;
  view_count: number;
  published_at: string;
  thumbnail_url?: string;
  performance_ratio: number;
  similarity_score: number;
  historical_avg_views?: number;
  found_via?: {
    thread: string;
    query: string;
  };
}

interface ChannelInfo {
  channel_id: string;
  channel_name: string;
  avg_views: number;
  channel_size: 'nano' | 'small' | 'medium' | 'large';
  subscriber_count?: number;
}

interface OutlierVideo {
  video: VideoResult;
  channel: ChannelInfo;
  outlier_strength: 'strong' | 'exceptional' | 'breakthrough';
}

// Get channel statistics from database
async function getChannelStats(channelIds: string[]): Promise<Map<string, ChannelInfo>> {
  // First try to get subscriber counts from discovered_channels table
  const { data: channelData, error: channelError } = await supabase
    .from('discovered_channels')
    .select('channel_id, channel_title, subscriber_count')
    .in('channel_id', channelIds);

  const subscriberMap = new Map<string, { name: string, subs: number }>();
  if (!channelError && channelData) {
    channelData.forEach(channel => {
      if (channel.subscriber_count) {
        subscriberMap.set(channel.channel_id, {
          name: channel.channel_title,
          subs: channel.subscriber_count
        });
      }
    });
  }

  // Get recent videos to understand current channel activity
  const { data, error } = await supabase
    .from('videos')
    .select('channel_id, channel_name, view_count, published_at')
    .in('channel_id', channelIds)
    .gte('published_at', new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString()) // Last 90 days for current status
    .order('published_at', { ascending: false });

  if (error) {
    console.error('Error fetching channel stats:', error);
    return new Map();
  }

  // Group by channel and calculate stats
  const channelStats = new Map<string, ChannelInfo>();
  const channelViewData = new Map<string, { views: number[], name: string }>();

  data.forEach(video => {
    if (!channelViewData.has(video.channel_id)) {
      channelViewData.set(video.channel_id, { views: [], name: video.channel_name });
    }
    const channelInfo = channelViewData.get(video.channel_id)!;
    channelInfo.views.push(video.view_count);
  });

  channelViewData.forEach((data, channelId) => {
    const recentAvgViews = data.views.length > 0 
      ? data.views.reduce((a, b) => a + b, 0) / data.views.length 
      : 0;
    
    // Get subscriber count from discovered_channels if available
    const channelInfo = subscriberMap.get(channelId);
    const subscriberCount = channelInfo?.subs;
    
    // Use subscriber count for channel size if available, otherwise use recent avg views
    let channelSize: 'nano' | 'small' | 'medium' | 'large';
    if (subscriberCount) {
      // Classify by subscriber count (most accurate for channel size)
      if (subscriberCount < 10000) channelSize = 'nano';
      else if (subscriberCount < 100000) channelSize = 'small';
      else if (subscriberCount < 1000000) channelSize = 'medium';
      else channelSize = 'large';
    } else {
      // Fallback to recent average views
      if (recentAvgViews < 10000) channelSize = 'nano';
      else if (recentAvgViews < 100000) channelSize = 'small';
      else if (recentAvgViews < 1000000) channelSize = 'medium';
      else channelSize = 'large';
    }

    channelStats.set(channelId, {
      channel_id: channelId,
      channel_name: channelInfo?.name || data.name,
      avg_views: recentAvgViews, // This is just for display context, not for calculating outliers
      channel_size: channelSize,
      subscriber_count: subscriberCount
    });
  });

  return channelStats;
}

// Classify outlier strength based on performance ratio
function getOutlierStrength(performanceRatio: number): 'strong' | 'exceptional' | 'breakthrough' | null {
  if (performanceRatio >= 10) return 'breakthrough';
  if (performanceRatio >= 5) return 'exceptional';
  if (performanceRatio >= 3) return 'strong';
  return null;
}

// Search for videos using semantic search
async function searchVideos(query: string, limit: number = 100): Promise<VideoResult[]> {
  try {
    // Get embedding for the query
    const embeddingResponse = await openai.embeddings.create({
      model: 'text-embedding-3-small',
      input: query,
      dimensions: 512
    });
    const queryEmbedding = embeddingResponse.data[0].embedding;
    
    // Search with reasonable threshold
    const searchResults = await pineconeService.searchSimilar(queryEmbedding, limit, 0.4);
    
    // Transform results - we'll get actual performance data from DB later
    return searchResults.results.map(result => ({
      video_id: result.video_id,
      title: result.title,
      channel_name: result.channel_name,
      channel_id: result.channel_id || '',
      view_count: result.view_count,
      published_at: result.published_at || '',
      thumbnail_url: result.thumbnail_url,
      performance_ratio: 1, // Placeholder - will use DB value
      similarity_score: result.similarity_score
    }));
  } catch (error) {
    console.error(`Error searching for "${query}":`, error);
    return [];
  }
}

export async function POST(request: NextRequest) {
  const supabase = getSupabase();
  try {
    const body = await request.json();
    const { concept, options = {} } = body;
    
    if (!concept) {
      return NextResponse.json({ error: 'Concept is required' }, { status: 400 });
    }

    const { 
      limit = 200, // Get more videos by default
      includeAdjacent = true,
      showSearchSource = true // Show which query found each video
    } = options;

    console.log(`\n🎯 Searching for videos about: "${concept}"`);
    console.log(`   Include adjacent topics: ${includeAdjacent}`);
    
    // Step 1: Direct search for the concept
    console.log('\n📍 Searching for videos...');
    const searchResults: Array<VideoResult & { search_query: string }> = [];
    
    // Primary search
    const primaryVideos = await searchVideos(concept, 100);
    primaryVideos.forEach(v => searchResults.push({ ...v, search_query: concept }));
    console.log(`   Found ${primaryVideos.length} videos for "${concept}"`);

    // Step 2: Optional adjacent searches for broader discovery
    if (includeAdjacent) {
      console.log('\n📍 Expanding to adjacent topics...');
      const adjacentQueries = [
        `${concept} tutorial`,
        `${concept} for beginners`,
        `DIY ${concept}`,
        `how to make ${concept}`,
        `best ${concept}`,
        `${concept} tips`,
        `${concept} guide`,
        `${concept} project`
      ];
      
      for (const query of adjacentQueries) {
        const adjacentVideos = await searchVideos(query, 50);
        console.log(`   Found ${adjacentVideos.length} videos for "${query}"`);
        adjacentVideos.forEach(v => searchResults.push({ ...v, search_query: query }));
      }
    }
    
    // Deduplicate by video_id, keeping the best similarity score
    const uniqueVideos = new Map<string, VideoResult & { search_query: string }>();
    searchResults.forEach(video => {
      if (!uniqueVideos.has(video.video_id) || 
          video.similarity_score > uniqueVideos.get(video.video_id)!.similarity_score) {
        uniqueVideos.set(video.video_id, video);
      }
    });
    const allVideos = Array.from(uniqueVideos.values());
    
    console.log(`\n📊 Total unique videos found: ${allVideos.length}`);

    // Step 3: Get actual performance data from database
    const videoIds = allVideos.map(v => v.video_id);
    console.log('\n📍 Fetching actual performance data from database...');
    
    // Get ALL videos from database (no performance filter)
    const { data: dbVideos, error } = await supabase
      .from('videos')
      .select('id, title, channel_id, channel_name, view_count, published_at, thumbnail_url, performance_ratio, channel_avg_views, rolling_baseline_views')
      .in('id', videoIds)
      .limit(limit);
    
    if (error) {
      console.error('Error fetching videos from database:', error);
      return NextResponse.json({ error: 'Failed to fetch video data' }, { status: 500 });
    }
    
    console.log(`\n📊 Found ${dbVideos?.length || 0} videos with performance data`);

    // Step 4: Get channel statistics
    const channelIds = [...new Set(dbVideos?.map(v => v.channel_id).filter(id => id) || [])];
    const channelStats = await getChannelStats(channelIds);

    // Step 5: Build results with all videos and their metadata
    const videoResults = (dbVideos || [])
      .map(dbVideo => {
        const channel = channelStats.get(dbVideo.channel_id);
        const searchVideo = allVideos.find(v => v.video_id === dbVideo.id);
        
        // Use the historical average from the database
        const historicalAvg = dbVideo.channel_avg_views || dbVideo.rolling_baseline_views || channel?.avg_views || 0;
        
        // Get outlier classification if applicable
        const outlierStrength = getOutlierStrength(dbVideo.performance_ratio);
        
        return {
          video_id: dbVideo.id,
          title: dbVideo.title,
          channel_name: dbVideo.channel_name,
          channel_id: dbVideo.channel_id,
          channel_size: channel?.channel_size || 'unknown',
          subscriber_count: channel?.subscriber_count,
          view_count: dbVideo.view_count,
          published_at: dbVideo.published_at,
          thumbnail_url: dbVideo.thumbnail_url,
          performance_ratio: dbVideo.performance_ratio,
          channel_avg_views: historicalAvg,
          similarity_score: searchVideo?.similarity_score || 0.8,
          search_query: searchVideo?.search_query || concept,
          outlier_strength: outlierStrength,
          is_outlier: dbVideo.performance_ratio >= 3.0
        };
      })
      .sort((a, b) => b.performance_ratio - a.performance_ratio); // Default sort by performance

    // Step 6: Calculate summary statistics
    const performanceDistribution = {
      breakthrough: videoResults.filter(v => v.outlier_strength === 'breakthrough').length,
      exceptional: videoResults.filter(v => v.outlier_strength === 'exceptional').length,
      strong: videoResults.filter(v => v.outlier_strength === 'strong').length,
      normal: videoResults.filter(v => !v.outlier_strength).length
    };

    const searchQueryDistribution = videoResults.reduce((acc, video) => {
      acc[video.search_query] = (acc[video.search_query] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);

    console.log('\n📊 Search Summary:');
    console.log(`   Total videos found: ${videoResults.length}`);
    console.log(`   Outliers (3x+): ${videoResults.filter(v => v.is_outlier).length}`);
    console.log(`   Breakthrough (10x+): ${performanceDistribution.breakthrough}`);
    console.log(`   Search queries used: ${Object.keys(searchQueryDistribution).length}`);

    return NextResponse.json({
      concept,
      videos: videoResults,
      summary: {
        total_videos_found: videoResults.length,
        outliers_found: videoResults.filter(v => v.is_outlier).length,
        performance_distribution: performanceDistribution,
        search_query_distribution: searchQueryDistribution,
        top_performance_ratio: videoResults[0]?.performance_ratio || 0,
        average_performance_ratio: videoResults.reduce((sum, v) => sum + v.performance_ratio, 0) / videoResults.length || 0
      }
    });

  } catch (error) {
    console.error('Error finding outliers:', error);
    return NextResponse.json({ 
      error: error instanceof Error ? error.message : 'Failed to find outliers',
      details: error instanceof Error ? error.stack : undefined
    }, { status: 500 });
  }
}