import { NextRequest, NextResponse } from 'next/server';

interface CommentData {
  id: string;
  author: string;
  authorChannelId?: string;
  text: string;
  likeCount: number;
  publishedAt: string;
  updatedAt: string;
  replyCount: number;
  isAuthorReply?: boolean;
}

export async function POST(request: NextRequest) {
  try {
    const { videoId, maxComments = 1000 } = await request.json();

    if (!videoId) {
      return NextResponse.json(
        { error: 'Video ID is required' },
        { status: 400 }
      );
    }

    console.log(`💬 Fetching comments for video: ${videoId}`);
    console.log(`📊 Max comments limit: ${maxComments}`);

    const youtubeApiKey = process.env.YOUTUBE_API_KEY;
    if (!youtubeApiKey) {
      return NextResponse.json(
        { error: 'YouTube API key not configured' },
        { status: 500 }
      );
    }

    // First, get video details to include in response
    const videoResponse = await fetch(
      `https://www.googleapis.com/youtube/v3/videos?part=snippet,statistics&id=${videoId}&key=${youtubeApiKey}`
    );

    if (!videoResponse.ok) {
      throw new Error('Failed to fetch video details');
    }

    const videoData = await videoResponse.json();
    
    if (!videoData.items || videoData.items.length === 0) {
      return NextResponse.json(
        { error: 'Video not found' },
        { status: 404 }
      );
    }

    const video = videoData.items[0];
    const totalCommentCount = parseInt(video.statistics.commentCount || '0');
    
    // Check if comments are disabled
    if (totalCommentCount === 0) {
      return NextResponse.json({
        metadata: {
          videoId,
          title: video.snippet.title,
          channel: video.snippet.channelTitle,
          totalComments: 0
        },
        comments: [],
        message: 'Comments are disabled for this video'
      });
    }

    // Fetch comments
    const comments: CommentData[] = [];
    let nextPageToken: string | undefined;
    let apiCalls = 0;
    const maxApiCalls = Math.ceil(maxComments / 100); // 100 comments per API call

    while (comments.length < maxComments && apiCalls < maxApiCalls) {
      const params = new URLSearchParams({
        part: 'snippet',
        videoId: videoId,
        maxResults: '100',
        order: 'relevance', // Get most relevant comments first
        key: youtubeApiKey,
        ...(nextPageToken && { pageToken: nextPageToken })
      });

      const response = await fetch(
        `https://www.googleapis.com/youtube/v3/commentThreads?${params}`
      );

      if (!response.ok) {
        const errorText = await response.text();
        console.error('YouTube API error:', errorText);
        
        // Handle specific error cases
        if (response.status === 403) {
          return NextResponse.json(
            { error: 'Comments are disabled or private for this video' },
            { status: 403 }
          );
        }
        throw new Error(`YouTube API returned ${response.status}`);
      }

      const data = await response.json();
      apiCalls++;

      // Process comment threads
      if (data.items && data.items.length > 0) {
        for (const item of data.items) {
          if (comments.length >= maxComments) break;
          
          const topComment = item.snippet.topLevelComment.snippet;
          const comment: CommentData = {
            id: item.id,
            author: topComment.authorDisplayName,
            authorChannelId: topComment.authorChannelId?.value,
            text: topComment.textDisplay,
            likeCount: topComment.likeCount || 0,
            publishedAt: topComment.publishedAt,
            updatedAt: topComment.updatedAt,
            replyCount: item.snippet.totalReplyCount || 0,
            isAuthorReply: topComment.authorChannelId?.value === video.snippet.channelId
          };
          
          comments.push(comment);
        }
      }

      console.log(`📥 API call ${apiCalls}: Fetched ${data.items?.length || 0} comments (Total: ${comments.length})`);

      // Check if there are more pages
      nextPageToken = data.nextPageToken;
      if (!nextPageToken || comments.length >= maxComments) {
        break;
      }
    }

    console.log(`✅ Successfully fetched ${comments.length} comments in ${apiCalls} API calls`);

    // Prepare response
    const response = {
      metadata: {
        videoId,
        title: video.snippet.title,
        channel: video.snippet.channelTitle,
        totalComments: totalCommentCount,
        fetchedComments: comments.length,
        apiCallsUsed: apiCalls
      },
      comments
    };

    return NextResponse.json(response);

  } catch (error) {
    console.error('Error fetching comments:', error);
    
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to fetch comments' },
      { status: 500 }
    );
  }
}