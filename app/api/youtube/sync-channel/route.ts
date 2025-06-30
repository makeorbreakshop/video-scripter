import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

/**
 * Channel Sync API
 * Fetches all videos from a YouTube channel and imports missing ones to the database
 */
export async function POST(request: NextRequest) {
  try {
    const { accessToken, channelId = 'Make or Break Shop' } = await request.json();

    if (!accessToken) {
      return NextResponse.json({ error: 'Access token required' }, { status: 400 });
    }

    console.log(`🔄 Starting channel sync for: ${channelId}`);

    // Step 1: Get all videos from YouTube channel
    const channelVideos = await fetchAllChannelVideos(accessToken, channelId);
    console.log(`📺 Found ${channelVideos.length} videos on YouTube channel`);

    // Step 2: Get all videos currently in our database
    const { data: dbVideos, error: dbError } = await supabase
      .from('videos')
      .select('id, title, view_count')
      .eq('channel_id', channelId);

    if (dbError) {
      console.error('Database error:', dbError);
      return NextResponse.json({ error: 'Failed to fetch database videos' }, { status: 500 });
    }

    const dbVideoIds = new Set(dbVideos?.map(v => v.id) || []);
    console.log(`💾 Found ${dbVideoIds.size} videos in database`);

    // Step 3: Find missing videos
    const missingVideos = channelVideos.filter(video => !dbVideoIds.has(video.id));
    console.log(`🔍 Found ${missingVideos.length} missing videos to import`);

    if (missingVideos.length === 0) {
      return NextResponse.json({ 
        success: true, 
        message: 'No new videos to import',
        stats: {
          channelVideos: channelVideos.length,
          databaseVideos: dbVideoIds.size,
          newVideos: 0
        }
      });
    }

    // Step 4: Import missing videos in batches
    const batchSize = 10;
    const importResults = [];
    
    for (let i = 0; i < missingVideos.length; i += batchSize) {
      const batch = missingVideos.slice(i, i + batchSize);
      console.log(`📥 Importing batch ${Math.floor(i/batchSize) + 1}: ${batch.length} videos`);
      
      const batchResult = await importVideosBatch(batch, channelId);
      importResults.push(...batchResult);
      
      // Small delay between batches to avoid overwhelming the system
      if (i + batchSize < missingVideos.length) {
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }

    const successful = importResults.filter(r => r.success).length;
    const failed = importResults.filter(r => !r.success).length;

    console.log(`✅ Import complete: ${successful} successful, ${failed} failed`);

    return NextResponse.json({
      success: true,
      message: `Imported ${successful} new videos`,
      stats: {
        channelVideos: channelVideos.length,
        databaseVideos: dbVideoIds.size,
        newVideos: successful,
        failedImports: failed
      },
      newVideos: missingVideos.slice(0, 10).map(v => ({ // Return first 10 for preview
        id: v.id,
        title: v.title,
        publishedAt: v.publishedAt
      }))
    });

  } catch (error) {
    console.error('Channel sync error:', error);
    return NextResponse.json(
      { error: 'Internal server error during channel sync' }, 
      { status: 500 }
    );
  }
}

/**
 * Fetch all videos from a YouTube channel using the API
 */
async function fetchAllChannelVideos(accessToken: string, channelId: string) {
  const videos = [];
  let nextPageToken = null;
  let page = 1;

  try {
    // First, get the channel's upload playlist ID
    const channelResponse = await fetch(
      `https://www.googleapis.com/youtube/v3/channels?part=contentDetails&forUsername=${channelId}`,
      {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json'
        }
      }
    );

    let uploadsPlaylistId;
    
    if (!channelResponse.ok) {
      // Try with channel ID instead of username
      const channelByIdResponse = await fetch(
        `https://www.googleapis.com/youtube/v3/search?part=snippet&channelId=${channelId}&type=video&maxResults=50&order=date`,
        {
          headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Content-Type': 'application/json'
          }
        }
      );
      
      if (!channelByIdResponse.ok) {
        // If both fail, search for channel by name
        const searchResponse = await fetch(
          `https://www.googleapis.com/youtube/v3/search?part=snippet&q=${encodeURIComponent(channelId)}&type=channel&maxResults=1`,
          {
            headers: {
              'Authorization': `Bearer ${accessToken}`,
              'Content-Type': 'application/json'
            }
          }
        );
        
        if (searchResponse.ok) {
          const searchData = await searchResponse.json();
          if (searchData.items && searchData.items.length > 0) {
            const actualChannelId = searchData.items[0].snippet.channelId;
            return await fetchVideosByChannelId(accessToken, actualChannelId);
          }
        }
        throw new Error('Could not find channel');
      }
      
      return await fetchVideosBySearch(accessToken, channelId);
    } else {
      const channelData = await channelResponse.json();
      uploadsPlaylistId = channelData.items[0]?.contentDetails?.relatedPlaylists?.uploads;
      
      if (!uploadsPlaylistId) {
        throw new Error('Could not find uploads playlist');
      }
      
      return await fetchVideosByPlaylist(accessToken, uploadsPlaylistId);
    }
  } catch (error) {
    console.error('Error fetching channel videos:', error);
    return [];
  }
}

/**
 * Fetch videos by playlist (uploads playlist)
 */
async function fetchVideosByPlaylist(accessToken: string, playlistId: string) {
  const videos = [];
  let nextPageToken = null;
  let page = 1;

  do {
    console.log(`📄 Fetching playlist page ${page}...`);
    
    let apiUrl = `https://www.googleapis.com/youtube/v3/playlistItems?part=snippet&playlistId=${playlistId}&maxResults=50`;
    if (nextPageToken) {
      apiUrl += `&pageToken=${nextPageToken}`;
    }

    const response = await fetch(apiUrl, {
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      }
    });

    if (!response.ok) {
      console.error(`API error on page ${page}:`, await response.text());
      break;
    }

    const data = await response.json();
    
    if (data.items && data.items.length > 0) {
      // Get detailed video information
      const videoIds = data.items.map(item => item.snippet.resourceId.videoId).join(',');
      const detailsResponse = await fetch(
        `https://www.googleapis.com/youtube/v3/videos?part=snippet,statistics&id=${videoIds}`,
        {
          headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Content-Type': 'application/json'
          }
        }
      );

      if (detailsResponse.ok) {
        const detailsData = await detailsResponse.json();
        detailsData.items.forEach(video => {
          videos.push({
            id: video.id,
            title: video.snippet.title,
            description: video.snippet.description,
            publishedAt: video.snippet.publishedAt,
            channelTitle: video.snippet.channelTitle,
            viewCount: parseInt(video.statistics.viewCount || '0'),
            likeCount: parseInt(video.statistics.likeCount || '0'),
            commentCount: parseInt(video.statistics.commentCount || '0'),
            thumbnailUrl: video.snippet.thumbnails?.maxresdefault?.url || 
                         video.snippet.thumbnails?.high?.url ||
                         video.snippet.thumbnails?.medium?.url ||
                         video.snippet.thumbnails?.default?.url
          });
        });
      }
    }

    nextPageToken = data.nextPageToken;
    page++;

    // Safety check
    if (page > 100) {
      console.warn('Reached maximum 100 pages, stopping');
      break;
    }

    // Small delay between requests
    await new Promise(resolve => setTimeout(resolve, 100));

  } while (nextPageToken);

  return videos;
}

/**
 * Fetch videos by channel ID using search
 */
async function fetchVideosByChannelId(accessToken: string, channelId: string) {
  const videos = [];
  let nextPageToken = null;
  let page = 1;

  do {
    console.log(`📄 Fetching channel videos page ${page}...`);
    
    let apiUrl = `https://www.googleapis.com/youtube/v3/search?part=snippet&channelId=${channelId}&type=video&maxResults=50&order=date`;
    if (nextPageToken) {
      apiUrl += `&pageToken=${nextPageToken}`;
    }

    const response = await fetch(apiUrl, {
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      }
    });

    if (!response.ok) {
      console.error(`API error on page ${page}:`, await response.text());
      break;
    }

    const data = await response.json();
    
    if (data.items && data.items.length > 0) {
      // Get detailed video information
      const videoIds = data.items.map(item => item.id.videoId).join(',');
      const detailsResponse = await fetch(
        `https://www.googleapis.com/youtube/v3/videos?part=snippet,statistics&id=${videoIds}`,
        {
          headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Content-Type': 'application/json'
          }
        }
      );

      if (detailsResponse.ok) {
        const detailsData = await detailsResponse.json();
        detailsData.items.forEach(video => {
          videos.push({
            id: video.id,
            title: video.snippet.title,
            description: video.snippet.description,
            publishedAt: video.snippet.publishedAt,
            channelTitle: video.snippet.channelTitle,
            viewCount: parseInt(video.statistics.viewCount || '0'),
            likeCount: parseInt(video.statistics.likeCount || '0'),
            commentCount: parseInt(video.statistics.commentCount || '0'),
            thumbnailUrl: video.snippet.thumbnails?.maxresdefault?.url || 
                         video.snippet.thumbnails?.high?.url ||
                         video.snippet.thumbnails?.medium?.url ||
                         video.snippet.thumbnails?.default?.url
          });
        });
      }
    }

    nextPageToken = data.nextPageToken;
    page++;

    // Safety check
    if (page > 100) {
      console.warn('Reached maximum 100 pages, stopping');
      break;
    }

    // Small delay between requests
    await new Promise(resolve => setTimeout(resolve, 100));

  } while (nextPageToken);

  return videos;
}

/**
 * Fallback: Fetch videos by search
 */
async function fetchVideosBySearch(accessToken: string, channelName: string) {
  // This is a fallback method - less reliable but works when channel ID lookup fails
  const response = await fetch(
    `https://www.googleapis.com/youtube/v3/search?part=snippet&q=channel:${encodeURIComponent(channelName)}&type=video&maxResults=50&order=date`,
    {
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      }
    }
  );

  if (!response.ok) {
    return [];
  }

  const data = await response.json();
  return data.items?.map(item => ({
    id: item.id.videoId,
    title: item.snippet.title,
    description: item.snippet.description,
    publishedAt: item.snippet.publishedAt,
    channelTitle: item.snippet.channelTitle,
    thumbnailUrl: item.snippet.thumbnails?.high?.url || item.snippet.thumbnails?.default?.url
  })) || [];
}

/**
 * Import a batch of videos to the database
 */
async function importVideosBatch(videos: any[], channelId: string) {
  const results = [];

  for (const video of videos) {
    try {
      // Insert into videos table
      const { error: videoError } = await supabase
        .from('videos')
        .insert({
          id: video.id,
          title: video.title,
          description: video.description || '',
          published_at: video.publishedAt,
          channel_id: channelId,
          channel_title: video.channelTitle || channelId,
          view_count: video.viewCount || 0,
          like_count: video.likeCount || 0,
          comment_count: video.commentCount || 0,
          thumbnail_url: video.thumbnailUrl,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        });

      if (videoError) {
        console.error(`Failed to import video ${video.id}:`, videoError);
        results.push({ 
          id: video.id, 
          title: video.title, 
          success: false, 
          error: videoError.message 
        });
        continue;
      }

      // Create baseline analytics record with current view count
      const { error: baselineError } = await supabase
        .from('baseline_analytics')
        .insert({
          video_id: video.id,
          views: video.viewCount || 0,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        });

      if (baselineError) {
        console.warn(`Failed to create baseline for video ${video.id}:`, baselineError);
        // Don't fail the whole import for baseline issues
      }

      results.push({ 
        id: video.id, 
        title: video.title, 
        success: true 
      });

      console.log(`✅ Imported: ${video.title}`);

    } catch (error) {
      console.error(`Error importing video ${video.id}:`, error);
      results.push({ 
        id: video.id, 
        title: video.title, 
        success: false, 
        error: error.message 
      });
    }
  }

  return results;
}