import { NextRequest, NextResponse } from 'next/server';
import { quotaTracker } from '@/lib/youtube-quota-tracker';

export async function POST(request: NextRequest) {
  try {
    const { channelId, publishedAfter } = await request.json();
    
    if (!channelId || !publishedAfter) {
      return NextResponse.json(
        { error: 'channelId and publishedAfter are required' },
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

    // DISABLED: search.list costs 100 quota units! 
    // Instead, return an estimate or fetch during actual import
    console.log(`⚠️ Skipping expensive search.list call for channel ${channelId}`);
    console.log(`   Would have cost 100 quota units just to count videos`);
    
    // Return estimate instead of making expensive API call
    // The actual count will be determined during import
    return NextResponse.json({
      pageInfo: {
        totalResults: -1, // -1 indicates "unknown, will calculate during import"
        estimated: true
      }
    });

    if (!response.ok) {
      const error = await response.text();
      console.error('YouTube API error:', error);
      return NextResponse.json(
        { error: 'Failed to fetch video count' },
        { status: response.status }
      );
    }

    const data = await response.json();
    
    // Return the same format as YouTube API for compatibility
    return NextResponse.json({
      pageInfo: {
        totalResults: data.pageInfo?.totalResults || 0
      }
    });

  } catch (error) {
    console.error('Error fetching recent video count:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}