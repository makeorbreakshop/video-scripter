/**
 * Research Channel Expansion API Route
 * Imports last year's worth of videos for research channels to create proper baselines
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

interface YouTubeSearchResponse {
  items: Array<{
    id: {
      kind: string;
      videoId: string;
    };
    snippet: {
      title: string;
      channelId: string;
      channelTitle: string;
      publishedAt: string;
    };
  }>;
  nextPageToken?: string;
  pageInfo: {
    totalResults: number;
  };
}

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
}

export async function POST(request: NextRequest) {
  try {
    const { channelName, manualChannelId, excludeShorts = true, userId, previewOnly = false } = await request.json();

    if (!channelName || !userId) {
      return NextResponse.json(
        { error: 'Channel name and user ID are required' },
        { status: 400 }
      );
    }

    if (!process.env.YOUTUBE_API_KEY) {
      return NextResponse.json(
        { error: 'YouTube API key not configured' },
        { status: 500 }
      );
    }

    const apiKey = process.env.YOUTUBE_API_KEY;
    
    console.log(`🔍 Expanding research channel: ${channelName}`);
    console.log(`📅 Importing entire channel backlog`);

    // Step 1: Get YouTube channel ID from manual override, existing data, or search
    let channelId: string | null = null;
    let usedManualId = false;
    let usedChannelSearch = false;
    
    if (manualChannelId) {
      channelId = manualChannelId;
      usedManualId = true;
      console.log(`✅ Using manual channel ID: ${channelName} (${channelId})`);
    } else {
      const { data: existingVideo } = await supabase
        .from('videos')
        .select('metadata')
        .eq('channel_id', channelName)
        .limit(1)
        .single();

      if (existingVideo?.metadata?.youtube_channel_id) {
        channelId = existingVideo.metadata.youtube_channel_id;
        console.log(`✅ Found channel ID from existing data: ${channelName} (${channelId})`);
      } else {
        // Fallback: Search for channel using YouTube API (costs 100 units)
        console.log(`🔍 No existing channel ID found, searching YouTube for: ${channelName}`);
        usedChannelSearch = true;
        
        const searchUrl = `https://www.googleapis.com/youtube/v3/search?part=snippet&type=channel&q=${encodeURIComponent(channelName)}&maxResults=1&key=${apiKey}`;
        const searchResponse = await fetch(searchUrl);
        const searchData = await searchResponse.json();

        if (!searchData.items || searchData.items.length === 0) {
          return NextResponse.json({
            success: false,
            message: `No YouTube channel found for "${channelName}"`,
            videos_found: 0
          });
        }

        channelId = searchData.items[0].id.channelId;
        console.log(`✅ Found channel ID from search: ${channelName} (${channelId})`);
      }
    }

    // Step 2: Get channel details to find uploads playlist (1 unit)
    const channelDetailsUrl = `https://www.googleapis.com/youtube/v3/channels?part=contentDetails&id=${channelId}&key=${apiKey}`;
    console.log(`🔗 Channel details URL: ${channelDetailsUrl}`);
    const channelDetailsResponse = await fetch(channelDetailsUrl);
    const channelDetailsData = await channelDetailsResponse.json();

    console.log(`📊 Channel details response:`, {
      status: channelDetailsResponse.status,
      ok: channelDetailsResponse.ok,
      itemsCount: channelDetailsData.items?.length || 0,
      error: channelDetailsData.error
    });

    if (!channelDetailsResponse.ok) {
      console.error(`❌ Channel details API error:`, channelDetailsData);
      return NextResponse.json({
        success: false,
        message: `YouTube API error: ${channelDetailsData.error?.message || 'Failed to get channel details'}`,
        videos_found: 0
      });
    }

    if (!channelDetailsData.items || channelDetailsData.items.length === 0) {
      return NextResponse.json({
        success: false,
        message: `Could not get channel details for "${channelName}"`,
        videos_found: 0
      });
    }

    const uploadsPlaylistId = channelDetailsData.items[0].contentDetails.relatedPlaylists.uploads;
    console.log(`📂 Uploads playlist ID: ${uploadsPlaylistId}`);

    // Step 3: Get videos from uploads playlist (1 unit per 50 videos)
    const allVideoIds: string[] = [];
    let nextPageToken: string | undefined;
    let totalFetched = 0;
    const maxVideosToFetch = 200; // Reasonable limit

    do {
      const playlistUrl = `https://www.googleapis.com/youtube/v3/playlistItems?part=snippet&playlistId=${uploadsPlaylistId}&maxResults=50${nextPageToken ? `&pageToken=${nextPageToken}` : ''}&key=${apiKey}`;
      
      console.log(`📡 Fetching playlist page (${totalFetched} videos so far)...`);
      
      const playlistResponse = await fetch(playlistUrl);
      const playlistData = await playlistResponse.json();

      if (!playlistData.items) break;

      // Extract all video IDs (no date filtering)
      const videoIds = playlistData.items.map((item: any) => item.snippet.resourceId.videoId);
      allVideoIds.push(...videoIds);
      
      totalFetched += playlistData.items.length;
      nextPageToken = playlistData.nextPageToken;
      
      console.log(`📊 Found ${playlistData.items.length} videos from this page`);
      
      // Stop if we have enough videos
      if (!nextPageToken || totalFetched >= maxVideosToFetch) break;
      
    } while (nextPageToken);

    console.log(`✅ Found ${allVideoIds.length} videos from ${channelName}`);

    if (allVideoIds.length === 0) {
      return NextResponse.json({
        success: false,
        message: `No videos found from "${channelName}"`,
        videos_found: 0
      });
    }

    // Step 4: Get detailed video information (1 unit per 50 videos)
    const allVideoData: any[] = [];
    
    for (let i = 0; i < allVideoIds.length; i += 50) {
      const batchVideoIds = allVideoIds.slice(i, i + 50).join(',');
      const videoResponse = await fetch(
        `https://www.googleapis.com/youtube/v3/videos?part=snippet,statistics,contentDetails&id=${batchVideoIds}&key=${apiKey}`
      );
      const videoData: YouTubeVideoResponse = await videoResponse.json();
      
      if (videoData.items) {
        allVideoData.push(...videoData.items);
      }
    }

    console.log(`📊 Got detailed data for ${allVideoData.length} videos`);

    if (allVideoData.length === 0) {
      return NextResponse.json({
        success: false,
        message: 'Failed to fetch detailed video information',
        videos_found: 0
      });
    }

    // Step 5: Filter videos if needed (exclude shorts)
    let filteredVideos = allVideoData;
    
    if (excludeShorts) {
      filteredVideos = allVideoData.filter(video => {
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
    }

    console.log(`📊 After filtering: ${filteredVideos.length} videos (shorts excluded: ${excludeShorts})`);

    // Step 6: Check which videos already exist in database
    const existingVideoIds = await supabase
      .from('videos')
      .select('id')
      .in('id', filteredVideos.map(v => v.id));

    const existingIds = new Set(existingVideoIds.data?.map(v => v.id) || []);
    const newVideos = filteredVideos.filter(video => !existingIds.has(video.id));
    
    console.log(`🔄 ${existingIds.size} videos already exist, ${newVideos.length} are new`);

    // Step 7: Calculate channel baseline for performance ratios
    const allViewCounts = filteredVideos.map(v => parseInt(v.statistics.viewCount) || 0);
    const channelAvgViews = allViewCounts.length > 0 
      ? allViewCounts.reduce((a, b) => a + b, 0) / allViewCounts.length 
      : 0;

    console.log(`📈 Channel average views: ${Math.round(channelAvgViews).toLocaleString()}`);

    // Calculate actual API calls used
    const channelSearchCalls = usedChannelSearch ? 100 : 0; // 100 units for channel search if needed
    const playlistCalls = Math.ceil(totalFetched / 50); // 1 call per 50 videos fetched
    const videoCalls = Math.ceil(allVideoData.length / 50); // 1 call per 50 video details
    const totalApiCalls = channelSearchCalls + 1 + playlistCalls + videoCalls; // channel search + channel details + playlist calls + video calls

    // If preview mode, return preview data without inserting
    if (previewOnly) {
      return NextResponse.json({
        success: true,
        channel_name: channelName,
        videos_found: filteredVideos.length,
        videos_already_existed: existingIds.size,
        videos_to_import: newVideos.length,
        channel_avg_views: Math.round(channelAvgViews || 0),
        api_calls_needed: totalApiCalls,
        message: `Preview: Found ${filteredVideos.length} videos from ${channelName}, ${newVideos.length} would be imported`
      });
    }

    // Step 8: Prepare videos for database insertion (no static performance ratios - calculated dynamically)
    const videosToInsert = newVideos.map(video => {
      const viewCount = parseInt(video.statistics.viewCount) || 0;

      return {
        id: video.id,
        title: video.snippet.title,
        description: video.snippet.description,
        channel_id: video.snippet.channelTitle,
        published_at: video.snippet.publishedAt,
        duration: video.contentDetails.duration,
        view_count: viewCount,
        like_count: parseInt(video.statistics.likeCount) || 0,
        comment_count: parseInt(video.statistics.commentCount) || 0,
        thumbnail_url: video.snippet.thumbnails.maxres?.url || 
                      video.snippet.thumbnails.high?.url || 
                      video.snippet.thumbnails.medium?.url,
        data_source: 'competitor',
        is_competitor: true,
        imported_by: userId === 'test-user' ? '00000000-0000-0000-0000-000000000000' : userId,
        import_date: new Date().toISOString(),
        user_id: userId === 'test-user' ? '00000000-0000-0000-0000-000000000000' : userId,
        metadata: {
          tags: video.snippet.tags || [],
          categoryId: video.snippet.categoryId || '',
          research_expansion: true,
          youtube_channel_id: video.snippet.channelId,
          expansion_settings: {
            time_period: 'all',
            exclude_shorts: excludeShorts,
            search_method: 'youtube_search_api'
          }
        }
      };
    });

    // Step 9: Insert new videos into database
    let insertedCount = 0;
    if (videosToInsert.length > 0) {
      const { data: insertedVideos, error: insertError } = await supabase
        .from('videos')
        .insert(videosToInsert)
        .select('id, title, view_count, performance_ratio');

      if (insertError) {
        console.error('Error inserting videos:', insertError);
        throw insertError;
      }

      insertedCount = insertedVideos?.length || 0;
      console.log(`✅ Successfully inserted ${insertedCount} new videos`);
    }

    // Note: Performance ratios are now calculated dynamically, so no need to store static values

    // Step 10: Update channel import status using service role
    // Research expansion means we've processed the entire channel backlog, so mark as fully imported
    const isFullyImported = true;
    
    try {
      const supabaseAdmin = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY!,
        {
          auth: {
            autoRefreshToken: false,
            persistSession: false
          }
        }
      );

      const { error: statusError } = await supabaseAdmin
        .from('channel_import_status')
        .upsert({
          channel_name: channelName,
          channel_id: channelId,
          first_import_date: new Date().toISOString(), // Always set first_import_date for research expansion
          last_refresh_date: new Date().toISOString(),
          total_videos_found: filteredVideos.length,
          is_fully_imported: isFullyImported
        });

      if (statusError) {
        console.error('Error updating channel import status:', statusError);
      } else {
        console.log(`✅ Updated import status for ${channelName} (fully_imported: ${isFullyImported}, imported: ${newVideos.length} videos)`);
      }
    } catch (statusError) {
      console.error('Error updating channel import status:', statusError);
    }

    // Step 11: Return results
    return NextResponse.json({
      success: true,
      channel_name: channelName,
      videos_found: filteredVideos.length,
      videos_already_existed: existingIds.size,
      videos_imported: insertedCount,
      channel_avg_views: Math.round(channelAvgViews || 0),
      api_calls_used: totalApiCalls,
      message: `Found ${filteredVideos.length} videos from ${channelName}, imported ${insertedCount} new videos${isFullyImported ? ' (channel fully imported)' : ''}`
    });

  } catch (error) {
    console.error('Error expanding research channel:', error);
    return NextResponse.json(
      { error: 'Failed to expand research channel' },
      { status: 500 }
    );
  }
}