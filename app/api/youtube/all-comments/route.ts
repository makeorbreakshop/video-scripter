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

// Simulate comments for fallback
function simulateComments(videoId: string): any[] {
  console.log(`🔄 Using simulated comments for video ID: ${videoId}`);
  
  // Create deterministic but varied content based on video ID
  const seed = videoId.charCodeAt(0) + videoId.charCodeAt(videoId.length - 1);
  
  // Names for simulated comments
  const names = [
    'YouTube Viewer', 'Regular Commenter', 'Fan Account', 'First Time Watcher',
    'Long Time Subscriber', 'Media Student', 'Thoughtful Observer', 'Random Passerby',
    'Content Creator', 'Industry Professional', 'Curious Mind', 'Avid Fan'
  ];
  
  // Comment text templates
  const commentTemplates = [
    'This is exactly what I needed to see today. Thanks for making this!',
    'I\'ve been following your content for years, and this might be your best work yet.',
    'I disagree with some points, but overall this was really informative.',
    'Could you do a follow-up on this topic? There\'s so much more to explore!',
    'The part at {timeCode} was really interesting - I never thought of it that way before.',
    'I\'ve shared this with my colleagues, really valuable insights here.',
    'First time watching your content and I\'m already a fan. Subscribed!',
    'The production quality keeps getting better with each video.',
    'I appreciate how thoroughly you covered this topic. No stone left unturned!',
    'This answered questions I didn\'t even know I had.',
    'I\'d love to see a collaboration with {otherCreator} on this topic!',
    'The editing in this video is next level!',
    'This content is so underrated, more people need to see this.',
    'I watch a lot of videos on this subject, and yours is by far the most helpful.',
    'Just discovered your channel through this video - where have you been all my life?'
  ];
  
  // Creators for mentions in comments
  const creators = [
    'MKBHD', 'Linus Tech Tips', 'Veritasium', 'Kurzgesagt', 
    'Babish', 'Tom Scott', 'The Slow Mo Guys', 'Simone Giertz'
  ];
  
  // Generate 15-30 comments based on video ID
  const commentCount = 15 + (seed % 16); // 15-30 comments
  const simulatedComments = [];
  
  for (let i = 0; i < commentCount; i++) {
    // Generate deterministic but varied data based on video ID and index
    const commentSeed = seed + i;
    const nameIndex = commentSeed % names.length;
    const templateIndex = (commentSeed * 3) % commentTemplates.length;
    const creatorIndex = (commentSeed * 7) % creators.length;
    const likeCount = (commentSeed % 500) + (i === 0 ? 1000 : 0); // First comment gets more likes
    
    // Generate a simulated timestamp
    const minutes = (commentSeed % 10) + 1;
    const seconds = (commentSeed % 60);
    const timeCode = `${minutes}:${seconds < 10 ? '0' + seconds : seconds}`;
    
    // Create comment text with variables replaced
    let commentText = commentTemplates[templateIndex]
      .replace('{timeCode}', timeCode)
      .replace('{otherCreator}', creators[creatorIndex]);
    
    // Date - random time in the last 30 days
    const daysAgo = commentSeed % 30;
    const date = new Date();
    date.setDate(date.getDate() - daysAgo);
    
    simulatedComments.push({
      authorDisplayName: names[nameIndex],
      authorProfileImageUrl: `https://i.pravatar.cc/150?u=${videoId}${i}`,
      textDisplay: commentText,
      likeCount: likeCount,
      publishedAt: date.toISOString()
    });
  }
  
  return simulatedComments;
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
    console.log(`🔑 YouTube API Key available: ${apiKey ? 'YES' : 'NO'}`);
    
    // If we have an API key, try to fetch all comments with pagination
    if (apiKey) {
      try {
        console.log(`🔑 Fetching all comments with API key for video ID: ${videoId}`);
        
        let allComments: any[] = [];
        let nextPageToken: string | null = null;
        let page = 1;
        
        do {
          console.log(`📃 Fetching comments page ${page} for ${videoId} with API key...`);
          
          // Construct URL with page token if available
          let apiUrl = `https://www.googleapis.com/youtube/v3/commentThreads?part=snippet&videoId=${videoId}&maxResults=100&order=relevance&key=${apiKey}`;
          if (nextPageToken) {
            apiUrl += `&pageToken=${nextPageToken}`;
          }
          
          console.log(`🔗 API URL: ${apiUrl.replace(apiKey, 'API_KEY_HIDDEN')}`);
          
          const response = await fetch(apiUrl);
          
          console.log(`📥 Response status for page ${page}: ${response.status} ${response.statusText}`);
          
          if (!response.ok) {
            const errorText = await response.text();
            console.error(`🚨 Failed to fetch comments with API key: ${response.status}`, errorText);
            // If we've fetched some comments already, return them; otherwise fall back to simulated comments
            if (allComments.length > 0) {
              return NextResponse.json({ 
                comments: allComments,
                simulated: false,
                partial: true,
                totalFetched: allComments.length
              });
            }
            console.log(`⚠️ Falling back to simulated comments for ${videoId}`);
            return NextResponse.json({ 
              comments: simulateComments(videoId),
              simulated: true,
              error: `API error: ${response.status} ${response.statusText}`
            });
          }
          
          const data = await response.json();
          
          // Extract and transform comments
          if (data.items && data.items.length > 0) {
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
            
            // Add comments to our collection
            allComments = [...allComments, ...comments];
            console.log(`✅ Got ${comments.length} comments (total: ${allComments.length})`);
          }
          
          // Check if there are more pages
          nextPageToken = data.nextPageToken || null;
          page++;
          
          // Safety check to avoid infinite loops or excessive API usage
          if (page > 30) {
            console.warn('⚠️ Reached maximum 30 pages of comments, stopping pagination');
            break;
          }
        } while (nextPageToken);
        
        console.log(`✅ Returning ${allComments.length} total comments for video ${videoId}`);
        
        return NextResponse.json({ 
          comments: allComments,
          simulated: false,
          totalFetched: allComments.length
        });
      } catch (error) {
        console.error('🚨 Error fetching comments with API key:', error);
        // Fall back to simulated comments
        return NextResponse.json({ 
          comments: simulateComments(videoId),
          simulated: true,
          error: error instanceof Error ? error.message : 'Unknown error'
        });
      }
    }
    
    // If no API key available, return simulated comments
    console.log(`🔄 Using simulated comments for video ID: ${videoId} (no API key)`);
    return NextResponse.json({ 
      comments: simulateComments(videoId),
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