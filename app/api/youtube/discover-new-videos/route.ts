/**
 * YouTube Video Discovery API Route
 * Discovers and imports new videos from the authenticated user's channel
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

interface YouTubeVideoResponse {
  items: Array<{
    id: string;
    snippet: {
      title: string;
      description: string;
      publishedAt: string;
      thumbnails: {
        default: { url: string };
        medium: { url: string };
        high: { url: string };
        maxres?: { url: string };
      };
      channelId: string;
      channelTitle: string;
      tags?: string[];
      categoryId: string;
    };
    statistics: {
      viewCount: string;
      likeCount: string;
      commentCount: string;
    };
    contentDetails: {
      duration: string;
    };
  }>;
  nextPageToken?: string;
}

export async function POST(request: NextRequest) {
  try {
    const { accessToken, maxResults = 50, publishedAfter } = await request.json();

    if (!accessToken) {
      return NextResponse.json(
        { error: 'Access token is required' },
        { status: 400 }
      );
    }

    if (!process.env.YOUTUBE_API_KEY) {
      return NextResponse.json(
        { error: 'YouTube API key not configured' },
        { status: 500 }
      );
    }

    // Get the latest video date from database to avoid importing duplicates
    const { data: latestVideo } = await supabase
      .from('videos')
      .select('published_at')
      .eq('is_competitor', false)
      .not('id', 'eq', 'CHANNEL_TOTAL')
      .order('published_at', { ascending: false })
      .limit(1);

    // For mine=true, use ONLY OAuth authentication (no API key needed)
    let searchParams = `part=snippet&mine=true&type=video&order=date&maxResults=${maxResults}`;
    
    // Use publishedAfter parameter or latest video date to get only new videos
    const afterDate = publishedAfter || (latestVideo?.[0]?.published_at ? new Date(latestVideo[0].published_at).toISOString() : undefined);
    if (afterDate) {
      searchParams += `&publishedAfter=${afterDate}`;
    }

    console.log(`🔍 Discovering videos published after: ${afterDate || 'all time'}`);

    // Search for videos on the user's channel (OAuth only, no API key)
    console.log(`🔍 Making YouTube API call with search params: ${searchParams}`);
    const searchResponse = await fetch(
      `https://www.googleapis.com/youtube/v3/search?${searchParams}`,
      {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
        },
      }
    );

    if (!searchResponse.ok) {
      const errorData = await searchResponse.text();
      console.error('YouTube search API error:', errorData);
      
      // Parse the error response for better error messages
      try {
        const errorJson = JSON.parse(errorData);
        if (errorJson.error?.code === 401) {
          return NextResponse.json(
            { error: 'YouTube authentication expired. Please re-authenticate in YouTube Tools.' },
            { status: 401 }
          );
        }
        if (errorJson.error?.code === 403) {
          return NextResponse.json(
            { error: 'YouTube API quota exceeded or access denied. Please try again later.' },
            { status: 403 }
          );
        }
      } catch (parseError) {
        // Fallback to original error
      }
      
      return NextResponse.json(
        { error: 'Failed to search for videos', details: errorData },
        { status: 500 }
      );
    }

    const searchData = await searchResponse.json();
    
    if (!searchData.items || searchData.items.length === 0) {
      return NextResponse.json({
        success: true,
        message: 'No new videos found',
        newVideos: 0,
        imported: 0
      });
    }

    const videoIds = searchData.items.map((item: any) => item.id.videoId).join(',');
    
    // Get detailed video information including statistics (OAuth only)
    const videoResponse = await fetch(
      `https://www.googleapis.com/youtube/v3/videos?part=snippet,statistics,contentDetails&id=${videoIds}`,
      {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
        },
      }
    );

    if (!videoResponse.ok) {
      const errorData = await videoResponse.text();
      console.error('YouTube videos API error:', errorData);
      return NextResponse.json(
        { error: 'Failed to fetch video details', details: errorData },
        { status: 500 }
      );
    }

    const videoData: YouTubeVideoResponse = await videoResponse.json();

    if (!videoData.items || videoData.items.length === 0) {
      return NextResponse.json({
        success: true,
        message: 'No video details found',
        newVideos: 0,
        imported: 0
      });
    }

    // Use unified video import system for processing
    const videoIds = videoData.items.map(video => video.id);
    
    console.log(`🎯 Using unified video import for ${videoIds.length} discovered videos`);
    
    try {
      // Call unified video import endpoint
      const unifiedResponse = await fetch(`${request.nextUrl.origin}/api/video-import/unified`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          source: 'owner',
          videoIds: videoIds,
          options: {
            batchSize: 50,
            skipEmbeddings: false,
            skipExports: false
          }
        })
      });

      if (unifiedResponse.ok) {
        const unifiedResult = await unifiedResponse.json();
        
        if (unifiedResult.success) {
          console.log('✅ Unified video import successful for video discovery');
          
          return NextResponse.json({
            success: true,
            message: `Successfully imported ${unifiedResult.videosProcessed} new videos using unified system`,
            videosProcessed: unifiedResult.videosProcessed,
            totalVideos: videoData.items.length,
            newVideos: unifiedResult.videosProcessed,
            imported: unifiedResult.videosProcessed,
            embeddingsGenerated: unifiedResult.embeddingsGenerated,
            exportFiles: unifiedResult.exportFiles,
            unifiedSystemUsed: true
          });
        }
      }
      
      console.log('⚠️ Unified system failed, falling back to original method');
    } catch (error) {
      console.error('❌ Unified system error, falling back to original method:', error);
    }

    // Fallback: Prepare videos for database insertion
    const videosToInsert = videoData.items.map(video => {
      const viewCount = parseInt(video.statistics.viewCount) || 0;
      
      return {
        id: video.id,
        title: video.snippet.title,
        description: video.snippet.description || '',
        channel_id: 'Make or Break Shop', // Your channel name for consistency
        published_at: video.snippet.publishedAt,
        duration: video.contentDetails.duration,
        view_count: viewCount,
        like_count: parseInt(video.statistics.likeCount) || 0,
        comment_count: parseInt(video.statistics.commentCount) || 0,
        thumbnail_url: video.snippet.thumbnails.maxres?.url || 
                      video.snippet.thumbnails.high?.url || 
                      video.snippet.thumbnails.medium?.url,
        performance_ratio: 1.0, // Will be calculated by packaging function
        channel_avg_views: 0, // Will be calculated by packaging function
        data_source: 'owner',
        is_competitor: false,
        imported_by: '00000000-0000-0000-0000-000000000000', // Default user ID
        import_date: new Date().toISOString(),
        user_id: '00000000-0000-0000-0000-000000000000',
        pinecone_embedded: false,
        metadata: {
          auto_discovered: true,
          discovery_date: new Date().toISOString(),
          youtube_channel_id: video.snippet.channelId,
          tags: video.snippet.tags || [],
          categoryId: video.snippet.categoryId || '',
          channel_title: video.snippet.channelTitle
        }
      };
    });

    // Insert new videos into database
    const { data: insertedVideos, error: insertError } = await supabase
      .from('videos')
      .upsert(videosToInsert, { 
        onConflict: 'id',
        ignoreDuplicates: false 
      })
      .select('id, title, published_at');

    if (insertError) {
      console.error('Database insert error:', insertError);
      return NextResponse.json(
        { error: 'Failed to insert videos into database', details: insertError.message },
        { status: 500 }
      );
    }

    const importedCount = insertedVideos?.length || 0;
    
    console.log(`✅ Successfully imported ${importedCount} new videos`);

    // Trigger vectorization for new videos
    if (importedCount > 0) {
      try {
        const videoIds = insertedVideos?.map(v => v.id) || [];
        await fetch(`${request.nextUrl.origin}/api/embeddings/titles/batch`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            video_ids: videoIds,
            force_re_embed: false
          })
        });
        console.log(`🔄 Triggered vectorization for ${videoIds.length} new videos`);
      } catch (vectorizationError) {
        console.warn('Vectorization failed for new videos:', vectorizationError);
      }
    }

    return NextResponse.json({
      success: true,
      message: `Successfully discovered and imported ${importedCount} new videos`,
      newVideos: videoData.items.length,
      imported: importedCount,
      videos: insertedVideos?.map(v => ({
        id: v.id,
        title: v.title,
        published_at: v.published_at
      })) || []
    });

  } catch (error) {
    console.error('Error in video discovery:', error);
    return NextResponse.json(
      { 
        error: 'Failed to discover new videos',
        details: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  }
}

export async function GET(request: NextRequest) {
  try {
    // Get info about current video count and discovery status
    const { data: videoStats, error } = await supabase
      .from('videos')
      .select('published_at, created_at', { count: 'exact' })
      .eq('is_competitor', false)
      .not('id', 'eq', 'CHANNEL_TOTAL')
      .order('published_at', { ascending: false })
      .limit(1);

    if (error) {
      return NextResponse.json(
        { error: 'Failed to get video discovery status' },
        { status: 500 }
      );
    }

    const latestVideo = videoStats?.[0];
    const daysSinceLatest = latestVideo ? 
      Math.floor((Date.now() - new Date(latestVideo.published_at).getTime()) / (1000 * 60 * 60 * 24)) : 
      null;

    return NextResponse.json({
      videoDiscoveryService: 'YouTube Data API v3',
      currentVideoCount: videoStats?.length || 0,
      latestVideoDate: latestVideo?.published_at || null,
      daysSinceLatestVideo: daysSinceLatest,
      needsDiscovery: daysSinceLatest ? daysSinceLatest > 1 : true,
      endpoints: {
        discover: '/api/youtube/discover-new-videos',
        analytics: '/api/youtube/analytics/daily-import'
      },
      workflow: [
        '1. Discover new videos (this endpoint)',
        '2. Import analytics data (/api/youtube/analytics/daily-import)',
        '3. Videos appear in packaging interface'
      ]
    });

  } catch (error) {
    console.error('Error checking video discovery status:', error);
    return NextResponse.json(
      { error: 'Failed to check video discovery status' },
      { status: 500 }
    );
  }
}