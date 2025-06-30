/**
 * YouTube Channel Search API Route
 * Searches for YouTube channels using public YouTube Data API v3
 */

import { NextRequest, NextResponse } from 'next/server';

interface YouTubeSearchResponse {
  items: Array<{
    id: {
      kind: string;
      channelId: string;
    };
    snippet: {
      channelId: string;
      title: string;
      description: string;
      thumbnails: {
        default: { url: string };
        medium: { url: string };
        high: { url: string };
      };
    };
  }>;
}

interface YouTubeChannelResponse {
  items: Array<{
    id: string;
    snippet: {
      title: string;
      description: string;
      customUrl?: string;
      thumbnails: {
        default: { url: string };
        medium: { url: string };
        high: { url: string };
      };
    };
    statistics: {
      viewCount: string;
      subscriberCount: string;
      videoCount: string;
    };
  }>;
}

export async function POST(request: NextRequest) {
  try {
    const { query } = await request.json();

    if (!query || !query.trim()) {
      return NextResponse.json(
        { error: 'Search query is required' },
        { status: 400 }
      );
    }

    if (!process.env.YOUTUBE_API_KEY) {
      return NextResponse.json(
        { error: 'YouTube API key not configured' },
        { status: 500 }
      );
    }

    const apiKey = process.env.YOUTUBE_API_KEY;
    const searchQuery = query.trim();

    // Step 1: Search for channels
    const searchUrl = `https://www.googleapis.com/youtube/v3/search?part=snippet&type=channel&q=${encodeURIComponent(searchQuery)}&maxResults=10&key=${apiKey}`;
    console.log('Channel search URL:', searchUrl);

    const searchResponse = await fetch(searchUrl);
    const searchData: YouTubeSearchResponse = await searchResponse.json();

    console.log('Search response:', searchData);

    if (!searchData.items || searchData.items.length === 0) {
      return NextResponse.json({
        channels: [],
        message: 'No channels found for your search query'
      });
    }

    // Step 2: Get detailed channel information
    const channelIds = searchData.items.map(item => item.snippet.channelId).join(',');
    const channelsUrl = `https://www.googleapis.com/youtube/v3/channels?part=snippet,statistics&id=${channelIds}&key=${apiKey}`;
    
    console.log('Channel details URL:', channelsUrl);

    const channelsResponse = await fetch(channelsUrl);
    const channelsData: YouTubeChannelResponse = await channelsResponse.json();

    console.log('Channels response:', channelsData);

    // Step 3: Format results
    const formattedChannels = channelsData.items?.map(channel => {
      const thumbnailUrl = channel.snippet.thumbnails.high?.url || 
                          channel.snippet.thumbnails.medium?.url || 
                          channel.snippet.thumbnails.default?.url;
      
      console.log('Channel thumbnail URL:', channel.snippet.title, thumbnailUrl);
      
      return {
        channelId: channel.id,
        title: channel.snippet.title,
        description: channel.snippet.description,
        thumbnailUrl,
        subscriberCount: channel.statistics.subscriberCount,
        videoCount: channel.statistics.videoCount,
        customUrl: channel.snippet.customUrl
      };
    }) || [];

    return NextResponse.json({
      channels: formattedChannels,
      total: formattedChannels.length
    });

  } catch (error) {
    console.error('Error searching channels:', error);
    return NextResponse.json(
      { error: 'Failed to search channels' },
      { status: 500 }
    );
  }
}