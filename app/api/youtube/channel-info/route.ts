import { NextRequest, NextResponse } from 'next/server';

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
    const { channelId } = await request.json();

    if (!channelId) {
      return NextResponse.json(
        { error: 'Channel ID is required' },
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

    // Fetch channel info directly by ID
    const channelUrl = `https://www.googleapis.com/youtube/v3/channels?part=snippet,statistics&id=${channelId}&key=${apiKey}`;
    
    console.log('Fetching channel info for ID:', channelId);

    const response = await fetch(channelUrl);
    const data: YouTubeChannelResponse = await response.json();

    if (!response.ok || !data.items || data.items.length === 0) {
      return NextResponse.json(
        { error: 'Channel not found' },
        { status: 404 }
      );
    }

    const channel = data.items[0];

    return NextResponse.json({ channel });
  } catch (error) {
    console.error('Error fetching channel info:', error);
    return NextResponse.json(
      { error: 'Failed to fetch channel information' },
      { status: 500 }
    );
  }
}