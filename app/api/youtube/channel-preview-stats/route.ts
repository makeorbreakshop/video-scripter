import { NextRequest, NextResponse } from 'next/server';

export async function POST(request: NextRequest) {
  try {
    const { channelId, timePeriod, excludeShorts } = await request.json();

    if (!channelId) {
      return NextResponse.json(
        { error: 'Channel ID is required' },
        { status: 400 }
      );
    }

    const API_KEY = process.env.YOUTUBE_API_KEY;
    if (!API_KEY) {
      return NextResponse.json(
        { error: 'YouTube API key not configured' },
        { status: 500 }
      );
    }

    // Get channel details to find uploads playlist
    const channelResponse = await fetch(
      `https://www.googleapis.com/youtube/v3/channels?part=contentDetails,statistics&id=${channelId}&key=${API_KEY}`
    );

    if (!channelResponse.ok) {
      throw new Error('Failed to fetch channel details');
    }

    const channelData = await channelResponse.json();
    
    if (!channelData.items || channelData.items.length === 0) {
      return NextResponse.json(
        { error: 'Channel not found' },
        { status: 404 }
      );
    }

    const channel = channelData.items[0];
    const uploadsPlaylistId = channel.contentDetails.uploadsPlaylist;
    const totalVideos = parseInt(channel.statistics.videoCount || '0');

    // Calculate date filter for API calls
    let publishedAfter = '';
    if (timePeriod !== 'all') {
      const daysAgo = parseInt(timePeriod);
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - daysAgo);
      publishedAfter = cutoffDate.toISOString();
    }

    // Get a sample of videos to estimate shorts percentage if needed
    let estimatedImport = totalVideos;
    
    if (timePeriod !== 'all' || excludeShorts) {
      // Fetch first 50 videos to analyze
      let sampleUrl = `https://www.googleapis.com/youtube/v3/playlistItems?part=snippet&playlistId=${uploadsPlaylistId}&maxResults=50&key=${API_KEY}`;
      if (publishedAfter) {
        // Note: playlistItems doesn't support publishedAfter, so we'll need to fetch and filter
      }

      const sampleResponse = await fetch(sampleUrl);
      if (sampleResponse.ok) {
        const sampleData = await sampleResponse.json();
        let validVideos = sampleData.items || [];

        // Filter by date if needed
        if (publishedAfter) {
          const cutoffTime = new Date(publishedAfter).getTime();
          validVideos = validVideos.filter((item: any) => {
            const publishTime = new Date(item.snippet.publishedAt).getTime();
            return publishTime >= cutoffTime;
          });
        }

        // If we need to exclude shorts, fetch video details for duration
        if (excludeShorts && validVideos.length > 0) {
          const videoIds = validVideos.map((item: any) => item.snippet.resourceId.videoId).join(',');
          const detailsResponse = await fetch(
            `https://www.googleapis.com/youtube/v3/videos?part=contentDetails&id=${videoIds}&key=${API_KEY}`
          );
          
          if (detailsResponse.ok) {
            const detailsData = await detailsResponse.json();
            const longFormVideos = detailsData.items.filter((video: any) => {
              const duration = video.contentDetails.duration;
              // Parse ISO 8601 duration (PT1M30S = 1 minute 30 seconds)
              const match = duration.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
              if (!match) return true; // If we can't parse, assume it's not a short
              
              const hours = parseInt(match[1] || '0');
              const minutes = parseInt(match[2] || '0');
              const seconds = parseInt(match[3] || '0');
              const totalSeconds = hours * 3600 + minutes * 60 + seconds;
              
              return totalSeconds >= 60; // Exclude videos under 60 seconds
            });

            const shortsRatio = 1 - (longFormVideos.length / validVideos.length);
            
            // Apply filters to estimate total
            if (timePeriod !== 'all') {
              // Estimate based on time period
              const timeRatio = validVideos.length / Math.min(50, totalVideos);
              estimatedImport = Math.round(totalVideos * timeRatio);
            }
            
            if (excludeShorts) {
              estimatedImport = Math.round(estimatedImport * (1 - shortsRatio));
            }
          }
        } else if (timePeriod !== 'all') {
          // Just time filtering
          const timeRatio = validVideos.length / Math.min(50, totalVideos);
          estimatedImport = Math.round(totalVideos * timeRatio);
        }
      }
    }

    return NextResponse.json({
      videoCount: totalVideos,
      estimatedImport: Math.max(1, estimatedImport) // At least 1 video
    });

  } catch (error) {
    console.error('Channel preview stats error:', error);
    return NextResponse.json(
      { error: 'Failed to get channel preview stats' },
      { status: 500 }
    );
  }
}