/**
 * Channel Verification API Route
 * Verifies a YouTube channel ID and returns channel details
 */

import { NextRequest, NextResponse } from 'next/server';

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
    
    // Validate channel ID format
    if (!channelId.startsWith('UC') || channelId.length !== 24) {
      return NextResponse.json({
        success: false,
        error: 'Invalid channel ID format. Should start with "UC" and be 24 characters long.'
      }, { status: 400 });
    }

    // Get channel details (1 API unit)
    const channelUrl = `https://www.googleapis.com/youtube/v3/channels?part=snippet,statistics,contentDetails&id=${channelId}&key=${apiKey}`;
    const response = await fetch(channelUrl);
    const data = await response.json();

    if (!response.ok) {
      console.error('YouTube API error:', data);
      return NextResponse.json({
        success: false,
        error: `YouTube API error: ${data.error?.message || 'Failed to verify channel'}`
      }, { status: 400 });
    }

    if (!data.items || data.items.length === 0) {
      return NextResponse.json({
        success: false,
        error: 'Channel not found. Please check the channel ID.'
      }, { status: 404 });
    }

    const channel = data.items[0];
    
    return NextResponse.json({
      success: true,
      channel_id: channelId,
      title: channel.snippet.title,
      description: channel.snippet.description,
      subscriber_count: parseInt(channel.statistics.subscriberCount || '0'),
      video_count: parseInt(channel.statistics.videoCount || '0'),
      thumbnail_url: channel.snippet.thumbnails.high?.url || 
                    channel.snippet.thumbnails.medium?.url || 
                    channel.snippet.thumbnails.default?.url,
      handle: channel.snippet.customUrl ? `@${channel.snippet.customUrl}` : undefined
    });

  } catch (error) {
    console.error('Error verifying channel:', error);
    return NextResponse.json(
      { error: 'Failed to verify channel' },
      { status: 500 }
    );
  }
}