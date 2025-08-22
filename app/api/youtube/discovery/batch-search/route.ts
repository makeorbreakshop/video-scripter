/**
 * Batch Search Discovery API
 * Runs multiple searches in parallel for aggressive channel discovery
 */

import { NextRequest, NextResponse } from 'next/server';
import { getSupabase } from '@/lib/supabase-lazy';
import { queryGenerator } from '@/lib/discovery-query-generator';
import { clusterAwareQueryGenerator } from '@/lib/cluster-aware-query-generator';
import { googlePSE } from '@/lib/google-pse-service';
import { quotaTracker } from '@/lib/youtube-quota-tracker';


interface BatchSearchRequest {
  queryCount?: number;
  queryType?: 'mixed' | 'gap_filling' | 'trending' | 'cross_topic' | 'cluster_aware';
  autoApprove?: boolean;
  minSubscribers?: number;
  maxConcurrent?: number;
  useClusterInsights?: boolean;
  prioritizeClusters?: number[];
}

interface SearchResult {
  query: string;
  channelsFound: number;
  newChannels: number;
  error?: string;
}

export async function POST(request: NextRequest) {
  const supabase = getSupabase();
  try {
    const {
      queryCount = 50,
      queryType = 'mixed',
      autoApprove = true,
      minSubscribers = 5000,
      maxConcurrent = 10,
      useGooglePSE = true, // Default to Google PSE to save YouTube quota
      useClusterInsights = true,
      prioritizeClusters = []
    } = await request.json() as BatchSearchRequest;

    // Check if Google PSE is configured
    if (useGooglePSE && !googlePSE.isConfigured()) {
      return NextResponse.json(
        { error: 'Google PSE not configured. Set GOOGLE_PSE_API_KEY and GOOGLE_PSE_ENGINE_ID environment variables.' },
        { status: 500 }
      );
    }

    // Check quota based on search method
    if (!useGooglePSE) {
      const quotaCheck = await checkQuotaAvailability();
      if (!quotaCheck.available) {
        return NextResponse.json(
          { error: 'Insufficient YouTube API quota', remaining: quotaCheck.remaining },
          { status: 429 }
        );
      }
    }

    // Generate queries based on type
    let queries: Array<{ query: string; category: string; queryType: string; cluster_id?: number; priority_score?: number }>;
    
    // Use cluster-aware generation if enabled
    if (useClusterInsights && queryType !== 'mixed') {
      switch (queryType) {
        case 'gap_filling':
          queries = await clusterAwareQueryGenerator.generateGapFillingClusterQueries(queryCount);
          break;
        case 'trending':
          queries = await clusterAwareQueryGenerator.generateTrendingClusterQueries(queryCount);
          break;
        case 'cross_topic':
          queries = await clusterAwareQueryGenerator.generateCrossClusterQueries(queryCount);
          break;
        case 'cluster_aware':
          queries = await clusterAwareQueryGenerator.generateClusterAwareQueries(queryCount, {
            prioritizeGrowth: true,
            prioritizeGaps: true,
            clusterIds: prioritizeClusters
          });
          break;
        default:
          queries = await clusterAwareQueryGenerator.generateClusterAwareQueries(queryCount);
      }
    } else {
      // Fall back to original query generator
      switch (queryType) {
        case 'gap_filling':
          const topicDistribution = await getCurrentTopicDistribution();
          queries = await queryGenerator.generateGapFillingQueries(topicDistribution, queryCount);
          break;
        case 'trending':
          queries = await queryGenerator.generateTrendingQueries(queryCount);
          break;
        case 'cross_topic':
          queries = await queryGenerator.generateCrossTopicQueries(queryCount);
          break;
        default:
          queries = await queryGenerator.generateQueries(queryCount);
      }
    }

    // Run searches based on method
    const results: SearchResult[] = [];
    const channelsDiscovered = new Map<string, any>();
    
    if (useGooglePSE) {
      // Use Google PSE for discovery (100 free searches/day)
      const queryStrings = queries.map(q => q.query);
      const pseResults = await googlePSE.batchSearchYouTube(queryStrings, {
        type: 'video', // Search for videos to extract channels
        dedupeChannels: true
      });
      
      // Process PSE results
      console.log(`PSE returned ${pseResults.channels.length} channels from ${queryStrings.length} queries`);
      console.log(`PSE errors: ${pseResults.errors.length}`);
      
      for (const channel of pseResults.channels) {
        // Use channel URL as temporary key until we resolve IDs
        const key = channel.channelUrl || channel.channelName;
        channelsDiscovered.set(key, {
          channelId: channel.channelId || '', // May be empty, resolved later
          title: channel.channelName,
          channelUrl: channel.channelUrl,
          discoverySource: 'google_pse',
          confidence: channel.confidence,
          videoUrl: channel.videoUrl,
          videoTitle: channel.videoTitle
        });
      }
      
      console.log(`Channels discovered map size: ${channelsDiscovered.size}`);
      
      results.push({
        query: 'Google PSE Batch',
        channelsFound: pseResults.channels.length,
        newChannels: 0 // Will be determined after validation
      });
      
    } else {
      // Original YouTube API method (uses quota)
      for (let i = 0; i < queries.length; i += maxConcurrent) {
        const batch = queries.slice(i, i + maxConcurrent);
        const batchResults = await Promise.all(
          batch.map(q => performVideoSearch(q, minSubscribers))
        );
        
        // Aggregate results
        for (const result of batchResults) {
          results.push(result);
          if (result.channels) {
            for (const channel of result.channels) {
              if (!channelsDiscovered.has(channel.channelId)) {
                channelsDiscovered.set(channel.channelId, channel);
              }
            }
          }
        }
      }
    }

    // Get channel details for PSE results (batch validation)
    let validatedChannels = Array.from(channelsDiscovered.values());
    
    if (useGooglePSE && validatedChannels.length > 0) {
      // First, resolve handles to channel IDs for channels that don't have IDs
      const channelsNeedingResolution = validatedChannels.filter(ch => !ch.channelId && ch.channelUrl);
      console.log(`Channels needing handle resolution: ${channelsNeedingResolution.length}`);
      
      if (channelsNeedingResolution.length > 0) {
        const handles = channelsNeedingResolution
          .map(ch => {
            const handleMatch = ch.channelUrl.match(/youtube\.com\/@([a-zA-Z0-9_-]+)/);
            return handleMatch ? handleMatch[1] : null;
          })
          .filter(Boolean) as string[];
        
        console.log(`Resolving ${handles.length} handles to channel IDs...`);
        
        if (handles.length > 0) {
          const handleToIdMap = await googlePSE.resolveChannelHandles(handles);
          console.log(`Resolved ${handleToIdMap.size} handles successfully`);
          
          // Update channel IDs
          for (const channel of validatedChannels) {
            if (!channel.channelId && channel.channelUrl) {
              const handleMatch = channel.channelUrl.match(/youtube\.com\/@([a-zA-Z0-9_-]+)/);
              if (handleMatch) {
                const handle = handleMatch[1];
                const resolvedId = handleToIdMap.get(handle);
                if (resolvedId) {
                  channel.channelId = resolvedId;
                }
              }
            }
          }
        }
      }
      
      // Filter out channels we couldn't resolve
      const channelsWithIds = validatedChannels.filter(ch => ch.channelId);
      console.log(`Channels with resolved IDs: ${channelsWithIds.length} out of ${validatedChannels.length}`);
      
      // Need to get channel stats from YouTube API (1 unit per 50 channels)
      validatedChannels = await validateChannelsWithYouTubeAPI(
        channelsWithIds.map(ch => ch.channelId),
        minSubscribers
      );
    }
    
    // Filter out existing channels (only check channels with IDs)
    const newChannels = await filterExistingChannels(validatedChannels.filter(ch => ch.channelId));
    
    // Add to discovery system
    const discoveryRecords = newChannels.map(channel => ({
      discovered_channel_id: channel.channelId,
      source_channel_id: 'batch_search_discovery',
      discovery_method: 'search',
      discovery_context: {
        batch_run: new Date().toISOString(),
        query_type: queryType,
        auto_approve: autoApprove,
        discovery_method: useGooglePSE ? 'google_pse' : 'youtube_api',
        cluster_aware: useClusterInsights,
        cluster_id: queries.find(q => q.query === channel.discoveryQuery)?.cluster_id,
        priority_score: queries.find(q => q.query === channel.discoveryQuery)?.priority_score
      },
      channel_metadata: {
        title: channel.title,
        description: channel.description,
        subscriber_count: channel.subscriberCount,
        video_count: channel.videoCount,
        view_count: channel.viewCount,
        published_at: channel.publishedAt,
        thumbnail_url: channel.thumbnailUrl,
        custom_url: channel.customUrl,
        avg_views: channel.avgViews
      },
      subscriber_count: channel.subscriberCount,
      video_count: channel.videoCount,
      relevance_score: channel.relevanceScore || 0,
      validation_status: 'pending', // Always set to pending for manual review
      created_at: new Date().toISOString()
    }));

    if (discoveryRecords.length > 0) {
      console.log(`Attempting to insert ${discoveryRecords.length} discovery records`);
      const { data: insertedData, error: insertError } = await supabase
        .from('channel_discovery')
        .insert(discoveryRecords)
        .select();

      if (insertError) {
        console.error('Error inserting discovery records:', insertError);
        console.error('Failed records sample:', discoveryRecords.slice(0, 2));
      } else {
        console.log(`Successfully inserted ${insertedData?.length || 0} records`);
      }
    }

    // Auto-import disabled - channels remain in pending status for review
    let autoImportedCount = 0;

    // Update metrics
    await updateDiscoveryMetrics({
      searchesRun: queries.length,
      channelsFound: channelsDiscovered.size,
      newChannelsAdded: newChannels.length,
      channelsAutoImported: autoImportedCount
    });

    // Calculate cluster coverage if using cluster insights
    let clusterCoverage = null;
    if (useClusterInsights) {
      const clusterCounts = new Map<number, number>();
      queries.forEach(q => {
        if (q.cluster_id) {
          clusterCounts.set(q.cluster_id, (clusterCounts.get(q.cluster_id) || 0) + 1);
        }
      });
      
      clusterCoverage = {
        totalClustersTargeted: clusterCounts.size,
        queriesPerCluster: Array.from(clusterCounts.entries())
          .map(([cluster_id, count]) => ({ cluster_id, queries: count }))
          .sort((a, b) => b.queries - a.queries)
          .slice(0, 10)
      };
    }

    return NextResponse.json({
      success: true,
      summary: {
        queriesExecuted: queries.length,
        totalChannelsFound: channelsDiscovered.size,
        newChannelsAdded: newChannels.length,
        channelsAutoApproved: discoveryRecords.filter(r => r.validation_status === 'approved').length,
        channelsAutoImported: autoImportedCount,
        duplicatesSkipped: channelsDiscovered.size - newChannels.length,
        clusterAware: useClusterInsights
      },
      queryBreakdown: queries.reduce((acc, q) => {
        acc[q.queryType] = (acc[q.queryType] || 0) + 1;
        return acc;
      }, {} as Record<string, number>),
      clusterCoverage,
      topChannels: newChannels
        .sort((a, b) => b.subscriberCount - a.subscriberCount)
        .slice(0, 10)
        .map(ch => ({
          title: ch.title,
          subscribers: ch.subscriberCount,
          videos: ch.videoCount,
          avgViews: ch.avgViews
        }))
    });

  } catch (error) {
    console.error('Batch search error:', error);
    return NextResponse.json(
      { error: 'Failed to perform batch search', details: error.message },
      { status: 500 }
    );
  }
}

async function validateChannelsWithYouTubeAPI(
  channelIds: string[],
  minSubscribers: number
): Promise<any[]> {
  const apiKey = process.env.YOUTUBE_API_KEY;
  if (!apiKey) throw new Error('YouTube API key not configured');
  
  const validChannels = [];
  
  // Process in batches of 50 (YouTube API limit)
  for (let i = 0; i < channelIds.length; i += 50) {
    const batch = channelIds.slice(i, i + 50);
    
    const channelUrl = new URL('https://www.googleapis.com/youtube/v3/channels');
    channelUrl.searchParams.set('part', 'snippet,statistics,contentDetails');
    channelUrl.searchParams.set('id', batch.join(','));
    channelUrl.searchParams.set('key', apiKey);

    const response = await fetch(channelUrl.toString());
    if (!response.ok) continue;
    
    const data = await response.json();
    
    // Track quota usage - channels.list costs 1 unit per call
    await quotaTracker.trackAPICall('channels.list', {
      description: `Validate ${batch.length} channels for discovery`,
      count: 1
    });
    
    for (const channel of data.items || []) {
      const subCount = parseInt(channel.statistics.subscriberCount) || 0;
      if (subCount >= minSubscribers) {
        validChannels.push({
          channelId: channel.id,
          title: channel.snippet.title,
          description: channel.snippet.description,
          subscriberCount: subCount,
          videoCount: parseInt(channel.statistics.videoCount) || 0,
          viewCount: parseInt(channel.statistics.viewCount) || 0,
          avgViews: Math.round((parseInt(channel.statistics.viewCount) || 0) / (parseInt(channel.statistics.videoCount) || 1)),
          publishedAt: channel.snippet.publishedAt,
          thumbnailUrl: channel.snippet.thumbnails.high?.url || channel.snippet.thumbnails.default?.url,
          customUrl: channel.snippet.customUrl,
          relevanceScore: calculateChannelScore(channel, { query: 'discovery' })
        });
      }
    }
  }
  
  return validChannels;
}

async function performVideoSearch(
  queryInfo: { query: string; category: string; queryType: string },
  minSubscribers: number
): Promise<SearchResult & { channels?: any[] }> {
  try {
    const apiKey = process.env.YOUTUBE_API_KEY;
    if (!apiKey) throw new Error('YouTube API key not configured');

    // Search for videos
    const searchUrl = new URL('https://www.googleapis.com/youtube/v3/search');
    searchUrl.searchParams.set('part', 'snippet');
    searchUrl.searchParams.set('q', queryInfo.query);
    searchUrl.searchParams.set('type', 'video');
    searchUrl.searchParams.set('maxResults', '50');
    searchUrl.searchParams.set('order', 'viewCount'); // Get popular videos
    searchUrl.searchParams.set('publishedAfter', new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toISOString()); // Last year
    searchUrl.searchParams.set('key', apiKey);

    const searchResponse = await fetch(searchUrl.toString());
    if (!searchResponse.ok) {
      throw new Error(`Search failed: ${searchResponse.statusText}`);
    }

    const searchData = await searchResponse.json();
    
    // Extract unique channel IDs
    const channelIds = [...new Set(searchData.items?.map((item: any) => item.snippet.channelId) || [])];
    
    if (channelIds.length === 0) {
      return {
        query: queryInfo.query,
        channelsFound: 0,
        newChannels: 0
      };
    }

    // Get channel details in batch (1 API unit for up to 50)
    const channelUrl = new URL('https://www.googleapis.com/youtube/v3/channels');
    channelUrl.searchParams.set('part', 'snippet,statistics,contentDetails');
    channelUrl.searchParams.set('id', channelIds.join(','));
    channelUrl.searchParams.set('key', apiKey);

    const channelResponse = await fetch(channelUrl.toString());
    if (!channelResponse.ok) {
      throw new Error(`Channel lookup failed: ${channelResponse.statusText}`);
    }

    const channelData = await channelResponse.json();
    
    // Process and filter channels
    const validChannels = channelData.items
      ?.filter((channel: any) => {
        const subCount = parseInt(channel.statistics.subscriberCount) || 0;
        return subCount >= minSubscribers;
      })
      .map((channel: any) => ({
        channelId: channel.id,
        title: channel.snippet.title,
        description: channel.snippet.description,
        subscriberCount: parseInt(channel.statistics.subscriberCount) || 0,
        videoCount: parseInt(channel.statistics.videoCount) || 0,
        viewCount: parseInt(channel.statistics.viewCount) || 0,
        avgViews: Math.round((parseInt(channel.statistics.viewCount) || 0) / (parseInt(channel.statistics.videoCount) || 1)),
        publishedAt: channel.snippet.publishedAt,
        thumbnailUrl: channel.snippet.thumbnails.high?.url || channel.snippet.thumbnails.default?.url,
        customUrl: channel.snippet.customUrl,
        uploads: channel.contentDetails.relatedPlaylists.uploads,
        relevanceScore: calculateChannelScore(channel, queryInfo)
      })) || [];

    return {
      query: queryInfo.query,
      channelsFound: validChannels.length,
      newChannels: 0, // Will be determined after deduplication
      channels: validChannels
    };

  } catch (error) {
    return {
      query: queryInfo.query,
      channelsFound: 0,
      newChannels: 0,
      error: error.message
    };
  }
}

function calculateChannelScore(channel: any, queryInfo: any): number {
  let score = 0;
  
  // Subscriber score (0-2.5)
  const subs = parseInt(channel.statistics.subscriberCount) || 0;
  score += Math.min(subs / 100000, 2.5);
  
  // Engagement score (0-2.5) 
  const avgViews = (parseInt(channel.statistics.viewCount) || 0) / (parseInt(channel.statistics.videoCount) || 1);
  const viewsPerSub = avgViews / (subs || 1);
  score += Math.min(viewsPerSub * 10, 2.5);
  
  // Activity score (0-1.5)
  const videoCount = parseInt(channel.statistics.videoCount) || 0;
  score += Math.min(videoCount / 100, 1.5);
  
  // Query relevance (0-1.5)
  const title = channel.snippet.title.toLowerCase();
  const description = channel.snippet.description.toLowerCase();
  const query = queryInfo.query.toLowerCase();
  
  if (title.includes(query.split(' ')[0])) score += 0.75;
  if (description.includes(query.split(' ')[0])) score += 0.75;
  
  return Math.min(score, 8);
}

async function filterExistingChannels(channels: any[]): Promise<any[]> {
  if (channels.length === 0) return [];
  
  const channelIds = channels.map(c => c.channelId);
  
  // Check multiple sources for existing channels
  const [discoveryResult, videosResult] = await Promise.all([
    supabase
      .from('channel_discovery')
      .select('discovered_channel_id')
      .in('discovered_channel_id', channelIds),
    supabase
      .from('videos')
      .select('channel_id')
      .in('channel_id', channelIds)
  ]);
  
  const existingIds = new Set([
    ...(discoveryResult.data?.map(d => d.discovered_channel_id) || []),
    ...(videosResult.data?.map(v => v.channel_id) || [])
  ]);
  
  return channels.filter(c => !existingIds.has(c.channelId));
}

async function checkQuotaAvailability(): Promise<{ available: boolean; remaining: number }> {
  const { data, error } = await supabase
    .from('youtube_quota_usage')
    .select('quota_used, quota_limit')
    .eq('date', new Date().toISOString().split('T')[0])
    .single();
  
  if (error || !data) {
    return { available: true, remaining: 10000 }; // Assume full quota if no data
  }
  
  const remaining = data.quota_limit - data.quota_used;
  return {
    available: remaining > 1000, // Need at least 1000 units for batch
    remaining
  };
}

async function getCurrentTopicDistribution(): Promise<Map<string, number>> {
  const { data } = await supabase
    .from('videos')
    .select('topic_level_1, topic_level_2')
    .not('topic_level_1', 'is', null);
  
  const distribution = new Map<string, number>();
  
  // This is simplified - you'd want to map topic IDs to actual topic names
  data?.forEach(video => {
    const key = `topic_${video.topic_level_1}_${video.topic_level_2}`;
    distribution.set(key, (distribution.get(key) || 0) + 1);
  });
  
  return distribution;
}

async function updateDiscoveryMetrics(metrics: {
  searchesRun: number;
  channelsFound: number;
  newChannelsAdded: number;
  channelsAutoImported: number;
}) {
  await supabase.from('discovery_metrics').insert({
    metric_date: new Date().toISOString().split('T')[0],
    total_searches: metrics.searchesRun,
    channels_discovered: metrics.channelsFound,
    channels_validated: metrics.newChannelsAdded,
    channels_imported: metrics.channelsAutoImported,
    api_units_used: metrics.searchesRun * 2 // Rough estimate
  });
}