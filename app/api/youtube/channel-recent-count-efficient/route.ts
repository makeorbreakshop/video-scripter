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

    // Use fallback system if backup key exists
    let apiKey = process.env.YOUTUBE_API_KEY;
    if (process.env.YOUTUBE_API_KEY_BACKUP) {
      const { youtubeAPIWithFallback } = await import('@/lib/youtube-api-with-fallback');
      apiKey = youtubeAPIWithFallback.getCurrentKey();
      const status = youtubeAPIWithFallback.getStatus();
      if (status.usingBackup) {
        console.log('🔄 Using BACKUP key for recent count check');
      }
    }

    if (!apiKey) {
      return NextResponse.json(
        { error: 'YouTube API key not configured' },
        { status: 500 }
      );
    }

    console.log(`📊 Fetching recent count for channel ${channelId} using efficient method`);

    // Step 1: Get the uploads playlist ID (1 unit)
    const channelResponse = await fetch(
      `https://www.googleapis.com/youtube/v3/channels?` +
      `part=contentDetails&` +
      `id=${channelId}&` +
      `key=${apiKey}`
    );

    if (!channelResponse.ok) {
      const error = await channelResponse.text();
      console.error('Channel API error:', error);
      
      // If quota exceeded and we have backup, the fallback system will handle retry
      if (error.includes('quotaExceeded')) {
        console.log('⚠️ Quota exceeded, returning estimate');
        return NextResponse.json({
          pageInfo: {
            totalResults: -1, // Return estimate
            estimated: true
          }
        });
      }
      
      return NextResponse.json(
        { error: 'Failed to fetch channel info' },
        { status: channelResponse.status }
      );
    }

    const channelData = await channelResponse.json();
    
    // Track quota usage
    await quotaTracker.trackAPICall('channels.list', {
      description: `Get uploads playlist for ${channelId}`,
      count: 1
    });

    if (!channelData.items || channelData.items.length === 0) {
      return NextResponse.json({
        pageInfo: { totalResults: 0 }
      });
    }

    const uploadsPlaylistId = channelData.items[0].contentDetails?.relatedPlaylists?.uploads;
    if (!uploadsPlaylistId) {
      return NextResponse.json({
        pageInfo: { totalResults: 0 }
      });
    }

    // Step 2: Fetch recent videos from uploads playlist (1 unit per page)
    // We'll fetch up to 3 pages (150 videos) to count recent ones
    const publishedAfterDate = new Date(publishedAfter);
    let recentCount = 0;
    let nextPageToken = '';
    let pagesChecked = 0;
    const maxPages = 3; // Check up to 150 videos

    while (pagesChecked < maxPages) {
      const playlistUrl = `https://www.googleapis.com/youtube/v3/playlistItems?` +
        `part=snippet&` +
        `playlistId=${uploadsPlaylistId}&` +
        `maxResults=50&` +
        (nextPageToken ? `pageToken=${nextPageToken}&` : '') +
        `key=${apiKey}`;

      const playlistResponse = await fetch(playlistUrl);
      
      if (!playlistResponse.ok) {
        console.error('Playlist API error');
        break;
      }

      const playlistData = await playlistResponse.json();
      
      // Track quota usage
      await quotaTracker.trackAPICall('playlistItems.list', {
        description: `Get recent videos page ${pagesChecked + 1} for ${channelId}`,
        count: 1
      });

      // Count videos published after the date
      let foundOldVideo = false;
      for (const item of playlistData.items || []) {
        const publishedAt = new Date(item.snippet?.publishedAt || '');
        if (publishedAt >= publishedAfterDate) {
          recentCount++;
        } else {
          foundOldVideo = true;
          break; // Videos are in reverse chronological order
        }
      }

      pagesChecked++;
      
      // Stop if we found an old video or no more pages
      if (foundOldVideo || !playlistData.nextPageToken) {
        break;
      }
      
      nextPageToken = playlistData.nextPageToken;
    }

    console.log(`✅ Found ${recentCount} recent videos (checked ${pagesChecked} pages, cost: ${pagesChecked + 1} units)`);

    return NextResponse.json({
      pageInfo: {
        totalResults: recentCount,
        estimated: pagesChecked >= maxPages // If we hit the limit, it's an estimate
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