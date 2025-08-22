/**
 * Refresh Competitor Channel API Route
 * Imports entire video backlog for an existing competitor channel (excludes shorts)
 */

import { NextRequest, NextResponse } from 'next/server';
import { getSupabase } from '@/lib/supabase-lazy';


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
  const supabase = getSupabase();
  try {
    const { channelName, youtubeChannelId, userId } = await request.json();

    if (!channelName || !youtubeChannelId || !userId) {
      return NextResponse.json(
        { error: 'Channel name, YouTube channel ID, and user ID are required' },
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
    
    console.log(`🔄 Refreshing competitor channel: ${channelName}`);
    console.log(`📅 Importing entire channel backlog (excluding shorts)`);

    // Step 1: Get channel details including statistics (1 unit)
    const channelDetailsUrl = `https://www.googleapis.com/youtube/v3/channels?part=contentDetails,statistics,snippet&id=${youtubeChannelId}&key=${apiKey}`;
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
        videos_imported: 0
      });
    }

    if (!channelDetailsData.items || channelDetailsData.items.length === 0) {
      return NextResponse.json({
        success: false,
        message: `Could not get channel details for "${channelName}"`,
        videos_imported: 0
      });
    }

    const uploadsPlaylistId = channelDetailsData.items[0].contentDetails.relatedPlaylists.uploads;
    const channelStats = channelDetailsData.items[0].statistics;
    const channelSnippet = channelDetailsData.items[0].snippet;
    
    console.log(`📂 Uploads playlist ID: ${uploadsPlaylistId}`);
    console.log(`👥 Channel subscribers: ${parseInt(channelStats.subscriberCount || '0').toLocaleString()}`);
    console.log(`📺 Total channel videos: ${parseInt(channelStats.videoCount || '0').toLocaleString()}`);

    // Step 2: Get videos from uploads playlist (1 unit per 50 videos)
    const allVideoIds: string[] = [];
    let nextPageToken: string | undefined;
    let totalFetched = 0;
    const maxVideosToFetch = 500; // Higher limit for refresh

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
        videos_imported: 0
      });
    }

    // Step 3: Get detailed video information (1 unit per 50 videos)
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
        videos_imported: 0
      });
    }

    // Step 4: Filter out shorts (videos under 60 seconds)
    const filteredVideos = allVideoData.filter(video => {
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

    console.log(`📊 After filtering: ${filteredVideos.length} videos (shorts excluded)`);

    // Step 5: Check which videos already exist in database
    const existingVideoIds = await supabase
      .from('videos')
      .select('id')
      .in('id', filteredVideos.map(v => v.id));

    const existingIds = new Set(existingVideoIds.data?.map(v => v.id) || []);
    const newVideos = filteredVideos.filter(video => !existingIds.has(video.id));
    const existingVideos = filteredVideos.filter(video => existingIds.has(video.id));
    
    console.log(`🔄 ${existingIds.size} videos already exist, ${newVideos.length} are new`);

    // Step 6: Calculate channel baseline for performance ratios
    const allViewCounts = filteredVideos.map(v => parseInt(v.statistics.viewCount) || 0);
    const channelAvgViews = allViewCounts.length > 0 
      ? allViewCounts.reduce((a, b) => a + b, 0) / allViewCounts.length 
      : 0;

    console.log(`📈 Channel average views: ${Math.round(channelAvgViews).toLocaleString()}`);

    // Calculate actual API calls used
    const playlistCalls = Math.ceil(totalFetched / 50); // 1 call per 50 videos fetched
    const videoCalls = Math.ceil(allVideoData.length / 50); // 1 call per 50 video details
    const totalApiCalls = 1 + playlistCalls + videoCalls; // channel details + playlist calls + video calls

    // Step 7: Prepare videos for database insertion
    const videosToInsert = newVideos.map(video => {
      const viewCount = parseInt(video.statistics.viewCount) || 0;
      const performanceRatio = channelAvgViews > 0 ? viewCount / channelAvgViews : 1;

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
        performance_ratio: performanceRatio,
        channel_avg_views: Math.round(channelAvgViews),
        data_source: 'competitor',
        is_competitor: true,
        imported_by: userId === 'test-user' ? '00000000-0000-0000-0000-000000000000' : userId,
        import_date: new Date().toISOString(),
        user_id: userId === 'test-user' ? '00000000-0000-0000-0000-000000000000' : userId,
        metadata: {
          tags: video.snippet.tags || [],
          categoryId: video.snippet.categoryId || '',
          channel_refresh: true,
          youtube_channel_id: video.snippet.channelId,
          channel_stats: {
            subscriber_count: parseInt(channelStats.subscriberCount || '0'),
            total_video_count: parseInt(channelStats.videoCount || '0'),
            total_view_count: parseInt(channelStats.viewCount || '0'),
            channel_thumbnail: channelSnippet.thumbnails?.default?.url || channelSnippet.thumbnails?.medium?.url,
            last_updated: new Date().toISOString()
          },
          refresh_settings: {
            exclude_shorts: true,
            search_method: 'youtube_uploads_playlist'
          }
        }
      };
    });

    // Step 8a: Insert new videos into database
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

    // Step 8b: Update existing videos with current metrics
    let updatedCount = 0;
    if (existingVideos.length > 0) {
      console.log(`🔄 Updating ${existingVideos.length} existing videos with current metrics...`);
      
      const updatePromises = existingVideos.map(async (video) => {
        const viewCount = parseInt(video.statistics.viewCount) || 0;
        const performanceRatio = channelAvgViews > 0 ? viewCount / channelAvgViews : 1;

        const { error } = await supabase
          .from('videos')
          .update({
            view_count: viewCount,
            like_count: parseInt(video.statistics.likeCount) || 0,
            comment_count: parseInt(video.statistics.commentCount) || 0,
            performance_ratio: performanceRatio,
            channel_avg_views: Math.round(channelAvgViews),
            updated_at: new Date().toISOString(),
            metadata: {
              ...video.metadata || {},
              tags: video.snippet.tags || [],
              categoryId: video.snippet.categoryId || '',
              last_refresh: new Date().toISOString(),
              youtube_channel_id: video.snippet.channelId,
              channel_stats: {
                subscriber_count: parseInt(channelStats.subscriberCount || '0'),
                total_video_count: parseInt(channelStats.videoCount || '0'),
                total_view_count: parseInt(channelStats.viewCount || '0'),
                channel_thumbnail: channelSnippet.thumbnails?.default?.url || channelSnippet.thumbnails?.medium?.url,
                last_updated: new Date().toISOString()
              },
              refresh_settings: {
                exclude_shorts: true,
                search_method: 'youtube_uploads_playlist'
              }
            }
          })
          .eq('id', video.id);

        if (error) {
          console.error(`Error updating video ${video.id}:`, error);
          return false;
        }
        return true;
      });

      const updateResults = await Promise.all(updatePromises);
      updatedCount = updateResults.filter(result => result === true).length;
      console.log(`✅ Successfully updated ${updatedCount} existing videos`);
    }

    // Step 9: Update channel import status with refresh timestamp using service role
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
        .update({
          last_refresh_date: new Date().toISOString(),
          total_videos_found: filteredVideos.length
        })
        .eq('channel_name', channelName);

      if (statusError) {
        console.error('Error updating channel refresh status:', statusError);
      } else {
        console.log(`✅ Updated last_refresh_date for ${channelName}`);
      }
    } catch (statusError) {
      console.error('Error updating channel refresh status:', statusError);
    }

    // Step 10: Return results
    return NextResponse.json({
      success: true,
      channel_name: channelName,
      videos_found: filteredVideos.length,
      videos_already_existed: existingIds.size,
      videos_imported: insertedCount,
      videos_updated: updatedCount,
      channel_avg_views: Math.round(channelAvgViews || 0),
      channel_subscribers: parseInt(channelStats.subscriberCount || '0'),
      api_calls_used: totalApiCalls,
      message: `Found ${filteredVideos.length} videos from ${channelName} (${parseInt(channelStats.subscriberCount || '0').toLocaleString()} subscribers), imported ${insertedCount} new videos, updated ${updatedCount} existing videos`
    });

  } catch (error) {
    console.error('Error refreshing competitor channel:', error);
    return NextResponse.json(
      { error: 'Failed to refresh competitor channel' },
      { status: 500 }
    );
  }
}