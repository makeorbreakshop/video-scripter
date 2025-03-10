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

// Generate simulated comments when API key is not available
function simulateComments(videoId: string, count: number = 10): any[] {
  const comments = [];
  const commentTemplates = [
    "This video was really helpful, thanks for sharing!",
    "I've been looking for content like this for a long time. Great job!",
    "Could someone explain the part at 3:45? I didn't quite get it.",
    "I disagree with some points but overall it's well presented.",
    "This changed my perspective on the topic. Thanks!",
    "First time watching your channel and I'm already subscribed!",
    "The quality of this content is amazing. Keep it up!",
    "I've shared this with all my friends. Very insightful.",
    "Any recommendations for more videos like this?",
    "This answered so many questions I had. Thank you!",
    "Watching this video for the third time and still learning new things.",
    "The editing in this video is top-notch!",
    "I appreciate how you broke down complex concepts so clearly.",
    "This is the kind of educational content we need more of.",
    "Who else is watching this in 2023?",
  ];
  
  for (let i = 0; i < count; i++) {
    const randomIndex = Math.floor(Math.random() * commentTemplates.length);
    const randomLikes = Math.floor(Math.random() * 1000);
    const daysAgo = Math.floor(Math.random() * 60);
    const date = new Date();
    date.setDate(date.getDate() - daysAgo);
    
    comments.push({
      authorDisplayName: `User${Math.floor(Math.random() * 10000)}`,
      authorProfileImageUrl: `https://i.pravatar.cc/150?u=${videoId}${i}`,
      textDisplay: commentTemplates[randomIndex],
      likeCount: randomLikes,
      publishedAt: date.toISOString(),
    });
  }
  
  return comments;
}

export async function POST(request: Request) {
  try {
    const { videoUrl, maxResults = 10 } = await request.json();
    
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
    
    // If we have an API key, try to fetch real comments
    if (apiKey) {
      try {
        console.log(`🔑 Fetching comments with API key for video ID: ${videoId}`);
        
        const response = await fetch(
          `https://www.googleapis.com/youtube/v3/commentThreads?part=snippet&videoId=${videoId}&maxResults=${maxResults}&order=relevance&key=${apiKey}`
        );
        
        if (!response.ok) {
          console.error(`🚨 Failed to fetch comments with API key: ${response.status}`);
          // Fall back to simulated comments
          return NextResponse.json({ 
            comments: simulateComments(videoId, maxResults),
            simulated: true
          });
        }
        
        const data = await response.json();
        
        if (!data.items || data.items.length === 0) {
          console.log('⚠️ No comments found for this video');
          return NextResponse.json({ comments: [] });
        }
        
        const comments = data.items.map((item: any) => {
          const comment = item.snippet.topLevelComment.snippet;
          return {
            authorDisplayName: comment.authorDisplayName,
            authorProfileImageUrl: comment.authorProfileImageUrl,
            textDisplay: comment.textDisplay,
            likeCount: comment.likeCount,
            publishedAt: comment.publishedAt
          };
        });
        
        return NextResponse.json({ 
          comments,
          simulated: false
        });
      } catch (error) {
        console.error('🚨 Error fetching comments with API key:', error);
        // Fall back to simulated comments
      }
    }
    
    // If no API key or API request failed, return simulated comments
    console.log(`🔄 Using simulated comments for video ID: ${videoId}`);
    return NextResponse.json({ 
      comments: simulateComments(videoId, maxResults),
      simulated: true
    });
    
  } catch (error) {
    console.error('🚨 Error in comments API route:', error);
    return NextResponse.json(
      { error: `Failed to fetch comments: ${error instanceof Error ? error.message : 'Unknown error'}` },
      { status: 500 }
    );
  }
} 