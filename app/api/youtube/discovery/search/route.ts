/**
 * YouTube Search-Based Discovery API Route
 * Searches for channels using keywords and stores them in the discovery system
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

interface SearchFilters {
  minSubscribers?: number;
  maxSubscribers?: number;
  minVideos?: number;
  maxVideos?: number;
  publishedAfter?: string;
}

export async function GET(request: NextRequest) {
  try {
    // Get statistics for search-based discovery
    const { data: stats, error } = await supabase
      .from('channel_discovery')
      .select('*')
      .eq('discovery_method', 'search');

    if (error) throw error;

    const totalDiscovered = stats?.length || 0;
    const pending = stats?.filter(s => s.validation_status === 'pending').length || 0;
    const approved = stats?.filter(s => s.validation_status === 'approved').length || 0;
    const rejected = stats?.filter(s => s.validation_status === 'rejected').length || 0;

    // Get recent discoveries
    const { data: recentDiscoveries, error: recentError } = await supabase
      .from('channel_discovery')
      .select('discovered_channel_id, channel_metadata, validation_status, created_at')
      .eq('discovery_method', 'search')
      .order('created_at', { ascending: false })
      .limit(10);

    if (recentError) throw recentError;

    const formattedRecent = recentDiscoveries?.map(discovery => ({
      discoveredChannelId: discovery.discovered_channel_id,
      channelTitle: discovery.channel_metadata?.title || 'Unknown Channel',
      subscriberCount: discovery.channel_metadata?.subscriber_count || 0,
      videoCount: discovery.channel_metadata?.video_count || 0,
      validationStatus: discovery.validation_status,
      discoveryDate: discovery.created_at
    })) || [];

    return NextResponse.json({
      statistics: {
        totalDiscovered,
        pending,
        approved,
        rejected
      },
      recentDiscoveries: formattedRecent
    });

  } catch (error) {
    console.error('Error getting search discovery stats:', error);
    return NextResponse.json(
      { error: 'Failed to get search discovery statistics' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const { searchTerm, filters = {}, maxResults = 50 } = await request.json();

    if (!searchTerm || typeof searchTerm !== 'string') {
      return NextResponse.json(
        { error: 'Search term is required' },
        { status: 400 }
      );
    }

    const apiKey = process.env.YOUTUBE_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        { error: 'YouTube API key not configured' },
        { status: 500 }
      );
    }

    // Search for channels using YouTube Data API
    const searchUrl = new URL('https://www.googleapis.com/youtube/v3/search');
    searchUrl.searchParams.set('part', 'snippet');
    searchUrl.searchParams.set('q', searchTerm);
    searchUrl.searchParams.set('type', 'channel');
    searchUrl.searchParams.set('maxResults', Math.min(maxResults, 50).toString());
    searchUrl.searchParams.set('key', apiKey);

    const searchResponse = await fetch(searchUrl.toString());
    if (!searchResponse.ok) {
      throw new Error(`YouTube API search failed: ${searchResponse.statusText}`);
    }

    const searchData = await searchResponse.json();
    if (!searchData.items || searchData.items.length === 0) {
      return NextResponse.json({
        channelsDiscovered: 0,
        channelsAdded: 0,
        channels: [],
        message: 'No channels found for search term'
      });
    }

    // Get detailed channel information
    const channelIds = searchData.items.map((item: any) => item.id.channelId);
    const channelUrl = new URL('https://www.googleapis.com/youtube/v3/channels');
    channelUrl.searchParams.set('part', 'snippet,statistics,brandingSettings');
    channelUrl.searchParams.set('id', channelIds.join(','));
    channelUrl.searchParams.set('key', apiKey);

    const channelResponse = await fetch(channelUrl.toString());
    if (!channelResponse.ok) {
      throw new Error(`YouTube API channel details failed: ${channelResponse.statusText}`);
    }

    const channelData = await channelResponse.json();

    // Track filtering stats
    const rawChannelsFromYoutube = channelData.items?.length || 0;
    let filteredBySubscribers = 0;
    let filteredByVideos = 0;
    let filteredByAge = 0;

    // Apply filters and prepare channels for discovery
    const filteredChannels = channelData.items
      .filter((channel: any) => {
        const stats = channel.statistics;
        const subscriberCount = parseInt(stats.subscriberCount) || 0;
        const videoCount = parseInt(stats.videoCount) || 0;
        const publishedAt = new Date(channel.snippet.publishedAt);

        // Apply filters and track what gets filtered
        if (filters.minSubscribers && subscriberCount < filters.minSubscribers) {
          filteredBySubscribers++;
          return false;
        }
        if (filters.maxSubscribers && subscriberCount > filters.maxSubscribers) {
          filteredBySubscribers++;
          return false;
        }
        if (filters.minVideos && videoCount < filters.minVideos) {
          filteredByVideos++;
          return false;
        }
        if (filters.maxVideos && videoCount > filters.maxVideos) {
          filteredByVideos++;
          return false;
        }
        if (filters.publishedAfter && publishedAt < new Date(filters.publishedAfter)) {
          filteredByAge++;
          return false;
        }

        return true;
      })
      .map((channel: any) => ({
        channelId: channel.id,
        title: channel.snippet.title,
        description: channel.snippet.description,
        subscriberCount: parseInt(channel.statistics.subscriberCount) || 0,
        videoCount: parseInt(channel.statistics.videoCount) || 0,
        viewCount: parseInt(channel.statistics.viewCount) || 0,
        publishedAt: channel.snippet.publishedAt,
        thumbnailUrl: channel.snippet.thumbnails.high?.url || channel.snippet.thumbnails.default?.url,
        customUrl: channel.snippet.customUrl
      }));

    // Check for existing channels in both discovery system AND imported videos
    const existingChannelIds = filteredChannels.length > 0 ? 
      await Promise.all([
        // Check discovery system (by YouTube channel ID)
        supabase
          .from('channel_discovery')
          .select('discovered_channel_id')
          .in('discovered_channel_id', filteredChannels.map(c => c.channelId)),
        // Check imported videos by actual YouTube channel ID from metadata
        supabase
          .from('videos')
          .select('metadata')
          .in('metadata->>youtube_channel_id', filteredChannels.map(c => c.channelId)),
        // Check imported videos by channel name
        supabase
          .from('videos')
          .select('channel_name')
          .in('channel_name', filteredChannels.map(c => c.title))
      ]).then(([discoveryResult, videosByIdResult, videosByNameResult]) => {
        const discoveryIds = discoveryResult.data?.map(d => d.discovered_channel_id) || [];
        const videoChannelIds = videosByIdResult.data?.map(d => d.metadata?.youtube_channel_id).filter(Boolean) || [];
        const videoChannelNames = videosByNameResult.data?.map(d => d.channel_name) || [];
        
        // Create a set of channel IDs to exclude
        const excludeIds = new Set(discoveryIds);
        
        // Also exclude channels that exist in videos table (by YouTube ID or by name)
        filteredChannels.forEach(channel => {
          if (videoChannelIds.includes(channel.channelId) || videoChannelNames.includes(channel.title)) {
            excludeIds.add(channel.channelId);
          }
        });
        
        return excludeIds;
      })
      : new Set();

    // Filter out existing channels
    const newChannels = filteredChannels.filter(channel => !existingChannelIds.has(channel.channelId));

    // Add new channels to discovery system
    const discoveryRecords = newChannels.map(channel => ({
      discovered_channel_id: channel.channelId,
      source_channel_id: 'search_discovery', // Use placeholder for search discovery
      discovery_method: 'search',
      discovery_context: {
        search_term: searchTerm,
        search_filters: filters,
        search_date: new Date().toISOString()
      },
      channel_metadata: {
        title: channel.title,
        description: channel.description,
        subscriber_count: channel.subscriberCount,
        video_count: channel.videoCount,
        view_count: channel.viewCount,
        published_at: channel.publishedAt,
        thumbnail_url: channel.thumbnailUrl,
        custom_url: channel.customUrl
      },
      subscriber_count: channel.subscriberCount,
      video_count: channel.videoCount,
      relevance_score: calculateRelevanceScore(channel, searchTerm),
      validation_status: 'pending',
      created_at: new Date().toISOString()
    }));

    let channelsAdded = 0;
    if (discoveryRecords.length > 0) {
      const { error: insertError } = await supabase
        .from('channel_discovery')
        .insert(discoveryRecords);

      if (insertError) {
        console.error('Error inserting discovery records:', insertError);
        throw insertError;
      }

      channelsAdded = discoveryRecords.length;
    }

    return NextResponse.json({
      success: true,
      searchTerm,
      stats: {
        rawFromYoutube: rawChannelsFromYoutube,
        afterFilters: filteredChannels.length,
        alreadyExists: filteredChannels.length - newChannels.length,
        newChannelsAdded: channelsAdded,
        filterBreakdown: {
          bySubscribers: filteredBySubscribers,
          byVideoCount: filteredByVideos,
          byAge: filteredByAge,
          totalFiltered: filteredBySubscribers + filteredByVideos + filteredByAge
        }
      },
      // Legacy fields for backward compatibility
      channelsDiscovered: filteredChannels.length,
      channelsAdded,
      channelsFiltered: filteredBySubscribers + filteredByVideos + filteredByAge,
      channelsExisting: filteredChannels.length - newChannels.length,
      channels: newChannels.map(channel => ({
        ...channel,
        relevanceScore: calculateRelevanceScore(channel, searchTerm),
        status: 'pending'
      }))
    });

  } catch (error) {
    console.error('Error in search discovery:', error);
    return NextResponse.json(
      { error: 'Failed to perform search discovery' },
      { status: 500 }
    );
  }
}

function calculateRelevanceScore(channel: any, searchTerm: string): number {
  let score = 0;
  
  // Title match (50% weight) - max 2.5 points
  const titleMatch = channel.title.toLowerCase().includes(searchTerm.toLowerCase());
  if (titleMatch) score += 2.5;
  
  // Description match (20% weight) - max 1.0 points
  const descriptionMatch = channel.description?.toLowerCase().includes(searchTerm.toLowerCase());
  if (descriptionMatch) score += 1.0;
  
  // Subscriber count scoring (15% weight) - max 0.75 points
  const subscriberScore = Math.min(channel.subscriberCount / 100000, 0.75); // Cap at 0.75
  score += subscriberScore;
  
  // Video count scoring (10% weight) - max 0.5 points
  const videoScore = Math.min(channel.videoCount / 200, 0.5); // Cap at 0.5
  score += videoScore;
  
  // Activity bonus (5% weight) - max 0.25 points
  const monthsOld = (Date.now() - new Date(channel.publishedAt).getTime()) / (1000 * 60 * 60 * 24 * 30);
  const activityScore = monthsOld < 120 ? 0.25 : 0.1; // Bonus for channels less than 10 years old
  score += activityScore;
  
  return Math.min(score, 5.0); // Cap at 5.0 for database constraint
}