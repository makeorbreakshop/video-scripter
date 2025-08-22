import { NextRequest, NextResponse } from 'next/server';
import { getSupabase } from '@/lib/supabase-lazy';


interface CommentThread {
  id: string;
  snippet: {
    channelId: string;
    videoId: string;
    topLevelComment: {
      snippet: {
        textOriginal: string;
        authorDisplayName: string;
        authorChannelId?: {
          value: string;
        };
        likeCount: number;
        publishedAt: string;
        updatedAt: string;
      };
    };
    totalReplyCount: number;
  };
}

interface YouTubeCommentsResponse {
  items: CommentThread[];
  nextPageToken?: string;
  pageInfo: {
    totalResults: number;
    resultsPerPage: number;
  };
}

export async function POST(request: NextRequest) {
  const supabase = getSupabase();
  try {
    const { channelId, channelName, maxComments = 1000 } = await request.json();
    
    if (!channelId) {
      return NextResponse.json({ error: 'Channel ID is required' }, { status: 400 });
    }

    let allComments: any[] = [];
    let nextPageToken: string | undefined;
    let totalFetched = 0;
    const batchSize = 100; // YouTube API max

    console.log(`Starting comment import for channel: ${channelId}`);

    while (totalFetched < maxComments) {
      const remainingComments = maxComments - totalFetched;
      const currentBatchSize = Math.min(batchSize, remainingComments);
      
      // Build YouTube API URL
      const params = new URLSearchParams({
        part: 'snippet',
        allThreadsRelatedToChannelId: channelId,
        maxResults: currentBatchSize.toString(),
        order: 'time',
        key: process.env.YOUTUBE_API_KEY!,
      });

      if (nextPageToken) {
        params.append('pageToken', nextPageToken);
      }

      const url = `https://www.googleapis.com/youtube/v3/commentThreads?${params.toString()}`;
      
      console.log(`Fetching batch: ${currentBatchSize} comments (total: ${totalFetched})`);
      
      const response = await fetch(url);
      
      if (!response.ok) {
        const errorText = await response.text();
        console.error('YouTube API Error:', response.status, errorText);
        return NextResponse.json({ 
          error: `YouTube API error: ${response.status}`,
          details: errorText
        }, { status: response.status });
      }

      const data: YouTubeCommentsResponse = await response.json();
      
      // Transform YouTube API response to our database format
      const transformedComments = data.items.map(thread => {
        const comment = thread.snippet.topLevelComment.snippet;
        return {
          comment_id: thread.id,
          channel_id: channelId,
          channel_name: channelName || null,
          video_id: thread.snippet.videoId,
          comment_text: comment.textOriginal,
          author_name: comment.authorDisplayName,
          author_channel_id: comment.authorChannelId?.value || null,
          published_at: new Date(comment.publishedAt),
          updated_at: new Date(comment.updatedAt),
          like_count: comment.likeCount,
          reply_count: thread.snippet.totalReplyCount,
          is_reply: false,
          parent_comment_id: null,
        };
      });

      allComments.push(...transformedComments);
      totalFetched += data.items.length;
      
      console.log(`Fetched ${data.items.length} comments. Total: ${totalFetched}`);

      // Check if we have more pages and haven't reached our limit
      nextPageToken = data.nextPageToken;
      if (!nextPageToken || totalFetched >= maxComments) {
        break;
      }

      // Small delay to be respectful to the API
      await new Promise(resolve => setTimeout(resolve, 100));
    }

    console.log(`Inserting ${allComments.length} comments into database...`);

    // Insert comments into database using upsert to handle duplicates
    const { data: insertedComments, error: dbError } = await supabase
      .from('youtube_comments')
      .upsert(allComments, { 
        onConflict: 'comment_id',
        ignoreDuplicates: true 
      })
      .select('id');

    if (dbError) {
      console.error('Database error:', dbError);
      return NextResponse.json({ 
        error: 'Database insertion failed', 
        details: dbError.message 
      }, { status: 500 });
    }

    // Get video titles for the imported comments
    console.log('Fetching video titles...');
    const videoIds = [...new Set(allComments.map(c => c.video_id).filter(Boolean))];
    
    if (videoIds.length > 0) {
      try {
        await updateVideoTitles(videoIds);
      } catch (error) {
        console.warn('Failed to fetch video titles:', error);
        // Don't fail the whole import for this
      }
    }

    return NextResponse.json({
      success: true,
      imported: allComments.length,
      totalVideos: videoIds.length,
      channelId,
      channelName: channelName || 'Unknown'
    });

  } catch (error) {
    console.error('Error importing comments:', error);
    return NextResponse.json({ 
      error: 'Internal server error', 
      details: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 });
  }
}

async function updateVideoTitles(videoIds: string[]) {
  // Batch video IDs in groups of 50 (YouTube API limit)
  const batchSize = 50;
  const batches = [];
  
  for (let i = 0; i < videoIds.length; i += batchSize) {
    batches.push(videoIds.slice(i, i + batchSize));
  }

  for (const batch of batches) {
    const params = new URLSearchParams({
      part: 'snippet',
      id: batch.join(','),
      key: process.env.YOUTUBE_API_KEY!,
    });

    const url = `https://www.googleapis.com/youtube/v3/videos?${params.toString()}`;
    
    try {
      const response = await fetch(url);
      if (response.ok) {
        const data = await response.json();
        
        // Update video titles in our comments table
        for (const video of data.items) {
          await supabase
            .from('youtube_comments')
            .update({ video_title: video.snippet.title })
            .eq('video_id', video.id);
        }
      }
    } catch (error) {
      console.warn('Failed to fetch video titles for batch:', error);
    }
    
    // Small delay between batches
    await new Promise(resolve => setTimeout(resolve, 100));
  }
}