import { NextResponse } from 'next/server';

// Helper function to get the YouTube API key
const getYouTubeApiKey = (): string | null => {
  // Try environment variable first (server-side)
  if (process.env.YOUTUBE_API_KEY) {
    return process.env.YOUTUBE_API_KEY;
  }
  
  // Try public environment variable (client-side)
  if (process.env.NEXT_PUBLIC_YOUTUBE_API_KEY) {
    return process.env.NEXT_PUBLIC_YOUTUBE_API_KEY;
  }
  
  return null;
};

export async function POST(request: Request) {
  try {
    const { query, maxResults = 10 } = await request.json();
    
    if (!query) {
      return NextResponse.json(
        { error: 'Search query is required' },
        { status: 400 }
      );
    }
    
    const apiKey = getYouTubeApiKey();
    if (!apiKey) {
      return NextResponse.json(
        { error: 'YouTube API key not configured' },
        { status: 500 }
      );
    }

    console.log(`🔍 Searching YouTube for: "${query}"`);
    
    // Make the request to YouTube Data API
    const response = await fetch(
      `https://www.googleapis.com/youtube/v3/search?part=snippet&q=${encodeURIComponent(query)}&type=video&maxResults=${maxResults}&key=${apiKey}`,
      { method: 'GET' }
    );

    if (!response.ok) {
      const errorData = await response.json();
      console.error('YouTube API error:', errorData);
      return NextResponse.json(
        { error: 'Failed to search YouTube', details: errorData },
        { status: response.status }
      );
    }

    const data = await response.json();
    
    // Extract and format the relevant information from each video
    const videos = data.items.map((item: any) => ({
      id: item.id.videoId,
      title: item.snippet.title,
      channelTitle: item.snippet.channelTitle,
      publishedAt: item.snippet.publishedAt,
      thumbnailUrl: item.snippet.thumbnails.medium.url,
      description: item.snippet.description
    }));

    // Get video details (view count, like count, etc.) for each video
    const videoDetails = await Promise.all(
      videos.map(async (video: any) => {
        try {
          const detailsResponse = await fetch(
            `https://www.googleapis.com/youtube/v3/videos?part=statistics&id=${video.id}&key=${apiKey}`,
            { method: 'GET' }
          );

          if (!detailsResponse.ok) {
            return video;
          }

          const detailsData = await detailsResponse.json();
          const statistics = detailsData.items[0]?.statistics || {};

          return {
            ...video,
            viewCount: statistics.viewCount,
            likeCount: statistics.likeCount,
            commentCount: statistics.commentCount
          };
        } catch (error) {
          console.error(`Error fetching details for video ${video.id}:`, error);
          return video;
        }
      })
    );

    return NextResponse.json({ 
      videos: videoDetails,
      totalResults: data.pageInfo?.totalResults || videos.length,
      resultsPerPage: data.pageInfo?.resultsPerPage || maxResults
    });
  } catch (error) {
    console.error('Error searching YouTube:', error);
    return NextResponse.json(
      { error: 'Failed to search YouTube' },
      { status: 500 }
    );
  }
} 