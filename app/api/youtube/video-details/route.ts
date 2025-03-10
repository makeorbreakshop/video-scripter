import { NextResponse } from 'next/server';

// Function to extract YouTube video ID from URL
function extractYouTubeId(url: string): string | null {
  const regExp = /^.*(youtu.be\/|v\/|u\/\w\/|embed\/|watch\?v=|&v=)([^#&?]*).*/;
  const match = url.match(regExp);
  return match && match[2].length === 11 ? match[2] : null;
}

// Get YouTube API key from environment or localStorage
function getYouTubeApiKey(): string | null {
  return process.env.YOUTUBE_API_KEY || process.env.NEXT_PUBLIC_YOUTUBE_API_KEY || null;
}

// Generate simulated video details when API key is not available
function simulateVideoDetails(videoId: string): any {
  // Create random but realistic-looking stats
  const randomViewCount = Math.floor(Math.random() * 2000000) + 50000;
  const randomLikeCount = Math.floor(randomViewCount * (Math.random() * 0.1 + 0.02));
  const randomCommentCount = Math.floor(randomViewCount * (Math.random() * 0.01 + 0.005));
  
  // Random publish date within the last 3 years
  const daysAgo = Math.floor(Math.random() * 1095); // Up to 3 years
  const publishDate = new Date();
  publishDate.setDate(publishDate.getDate() - daysAgo);
  
  // Random duration between 3 and 20 minutes
  const durationSeconds = Math.floor((Math.random() * 17 * 60) + 180);
  const minutes = Math.floor(durationSeconds / 60);
  const seconds = durationSeconds % 60;
  const duration = `PT${minutes}M${seconds}S`;
  
  return {
    id: videoId,
    snippet: {
      publishedAt: publishDate.toISOString(),
      title: `Sample Video Title for ${videoId}`,
      description: 'This is a simulated video description. The actual description would be fetched from YouTube using their API if an API key is available.',
      channelTitle: 'Example Channel',
      tags: ['sample', 'simulation', 'youtube'],
      categoryId: "22",
    },
    statistics: {
      viewCount: randomViewCount.toString(),
      likeCount: randomLikeCount.toString(),
      favoriteCount: "0",
      commentCount: randomCommentCount.toString(),
    },
    contentDetails: {
      duration: duration,
    },
    // Simplified format for easy consumption
    title: `Sample Video Title for ${videoId}`,
    description: 'This is a simulated video description. The actual description would be fetched from YouTube using their API if an API key is available.',
    channelTitle: 'Example Channel',
    publishedAt: publishDate.toISOString(),
    viewCount: randomViewCount.toString(),
    likeCount: randomLikeCount.toString(),
    commentCount: randomCommentCount.toString(),
    duration: duration,
    simulated: true
  };
}

export async function POST(request: Request) {
  try {
    const { videoUrl } = await request.json();
    
    if (!videoUrl) {
      return NextResponse.json(
        { error: 'No video URL provided' },
        { status: 400 }
      );
    }
    
    const videoId = extractYouTubeId(videoUrl);
    if (!videoId) {
      return NextResponse.json(
        { error: 'Invalid YouTube URL' },
        { status: 400 }
      );
    }
    
    const apiKey = getYouTubeApiKey();
    
    // If we have an API key, try to fetch real video details
    if (apiKey) {
      try {
        console.log(`🔑 Fetching video details with API key for video ID: ${videoId}`);
        
        const response = await fetch(
          `https://www.googleapis.com/youtube/v3/videos?part=snippet,statistics,contentDetails&id=${videoId}&key=${apiKey}`
        );
        
        if (!response.ok) {
          console.error(`🚨 Failed to fetch video details with API key: ${response.status}`);
          // Fall back to simulated video details
          return NextResponse.json(simulateVideoDetails(videoId));
        }
        
        const data = await response.json();
        
        if (!data.items || data.items.length === 0) {
          console.log('⚠️ No video details found for this video ID');
          return NextResponse.json(simulateVideoDetails(videoId));
        }
        
        const videoData = data.items[0];
        
        // Format the response in a simplified, easy-to-use format
        return NextResponse.json({
          ...videoData,
          // Add simplified fields for easy access
          title: videoData.snippet.title,
          description: videoData.snippet.description,
          channelTitle: videoData.snippet.channelTitle,
          publishedAt: videoData.snippet.publishedAt,
          viewCount: videoData.statistics.viewCount,
          likeCount: videoData.statistics.likeCount,
          commentCount: videoData.statistics.commentCount,
          duration: videoData.contentDetails.duration,
          simulated: false
        });
      } catch (error) {
        console.error('🚨 Error fetching video details with API key:', error);
        // Fall back to simulated video details
        return NextResponse.json(simulateVideoDetails(videoId));
      }
    }
    
    // If no API key, return simulated video details
    console.log(`🔄 Using simulated video details for video ID: ${videoId}`);
    return NextResponse.json(simulateVideoDetails(videoId));
    
  } catch (error) {
    console.error('🚨 Error in video details API route:', error);
    return NextResponse.json(
      { error: `Failed to fetch video details: ${error instanceof Error ? error.message : 'Unknown error'}` },
      { status: 500 }
    );
  }
} 