import { NextRequest, NextResponse } from 'next/server';
import { getSupabase } from '@/lib/supabase-lazy';


/**
 * Unified Channel Analytics Refresh API
 * 
 * Combines two operations:
 * 1. Import new videos from YouTube channel that aren't in database
 * 2. Update baseline analytics for all videos in the channel
 * 
 * Uses actual YouTube channel ID for reliable operation
 */
export async function POST(request: NextRequest) {
  const supabase = getSupabase();
  try {
    // Get access token from request header
    const authHeader = request.headers.get('authorization');
    const accessToken = authHeader?.replace('Bearer ', '');
    
    if (!accessToken) {
      return NextResponse.json({
        success: false,
        error: 'No access token provided'
      }, { status: 401 });
    }

    // Get channel ID from request body
    const { channelId } = await request.json();
    
    if (!channelId) {
      return NextResponse.json({
        success: false,
        error: 'Channel ID is required'
      }, { status: 400 });
    }

    console.log(`🔄 Starting unified channel analytics refresh for: ${channelId}`);

    // Step 1: Import new videos from channel
    console.log('📥 Step 1: Importing new videos from channel...');
    const importResult = await importNewVideos(accessToken, channelId);
    
    // Step 2: Update baseline analytics for all channel videos
    console.log('📊 Step 2: Updating baseline analytics...');
    const baselineResult = await updateBaselineAnalytics(accessToken, channelId);

    const stats = {
      totalChannelVideos: importResult.totalChannelVideos,
      newVideos: importResult.newVideos,
      updatedBaselines: baselineResult.updatedBaselines,
      errors: [...importResult.errors, ...baselineResult.errors]
    };

    console.log(`✅ Channel analytics refresh complete:`);
    console.log(`   - Found ${stats.totalChannelVideos} videos on YouTube channel`);
    console.log(`   - Imported ${stats.newVideos} new videos`);
    console.log(`   - Updated ${stats.updatedBaselines} baseline analytics`);
    console.log(`   - ${stats.errors.length} errors encountered`);

    return NextResponse.json({
      success: true,
      message: `Channel analytics refreshed successfully`,
      stats,
      details: {
        import: importResult,
        baseline: baselineResult
      }
    });

  } catch (error) {
    console.error('Channel analytics refresh error:', error);
    return NextResponse.json(
      { 
        success: false, 
        error: error instanceof Error ? error.message : 'Internal server error' 
      }, 
      { status: 500 }
    );
  }
}

/**
 * Step 1: Import new videos from YouTube channel
 */
async function importNewVideos(accessToken: string, channelId: string) {
  try {
    // Get all videos from YouTube channel
    const channelVideos = await fetchChannelVideos(accessToken, channelId);
    console.log(`📺 Found ${channelVideos.length} videos on YouTube channel`);

    // Get existing videos in database for this channel
    const { data: dbVideos, error: dbError } = await supabase
      .from('videos')
      .select('id, title')
      .eq('channel_id', 'Make or Break Shop'); // Database uses display name

    if (dbError) {
      throw new Error(`Database error: ${dbError.message}`);
    }

    const dbVideoIds = new Set(dbVideos?.map(v => v.id) || []);
    console.log(`💾 Found ${dbVideoIds.size} videos in database`);

    // Find videos that need to be imported
    const missingVideos = channelVideos.filter(video => !dbVideoIds.has(video.id));
    console.log(`🔍 Found ${missingVideos.length} new videos to import`);
    
    // Debug: Show the most recent videos from YouTube vs database
    console.log('\n📺 Most recent 5 videos from YouTube:');
    channelVideos.slice(0, 5).forEach((video, i) => {
      const inDb = dbVideoIds.has(video.id) ? '✅ In DB' : '❌ Missing';
      console.log(`${i + 1}. ${video.title} (${video.publishedAt}) ${inDb}`);
    });
    
    if (missingVideos.length > 0) {
      console.log('\n🔍 Videos to import:');
      missingVideos.slice(0, 10).forEach((video, i) => {
        console.log(`${i + 1}. ${video.title} (${video.publishedAt})`);
      });
    }

    const errors = [];
    let successfulImports = 0;

    // Import missing videos with baseline analytics
    for (const video of missingVideos) {
      try {
        console.log(`📥 Importing: ${video.title} (${video.id})`);
        
        // Insert video record
        const { error: videoError } = await supabase
          .from('videos')
          .insert({
            id: video.id,
            title: video.title,
            description: video.description || '',
            published_at: video.publishedAt,
            channel_id: 'Make or Break Shop', // Use display name for database consistency
            view_count: video.viewCount || 0,
            like_count: video.likeCount || 0,
            comment_count: video.commentCount || 0,
            duration: video.duration,
            thumbnail_url: video.thumbnailUrl,
            user_id: '00000000-0000-0000-0000-000000000000', // Match existing videos
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
          });

        if (videoError) {
          console.error(`❌ Video import failed for ${video.id}:`, videoError);
          errors.push(`Failed to import video ${video.id}: ${videoError.message}`);
          continue;
        }

        // Create baseline analytics record
        const { error: baselineError } = await supabase
          .from('baseline_analytics')
          .insert({
            video_id: video.id,
            views: video.viewCount || 0,
            baseline_date: new Date().toISOString().split('T')[0],
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
          });

        if (baselineError) {
          console.warn(`Failed to create baseline for ${video.id}:`, baselineError);
          // Don't treat this as a failure since video was imported
        }

        successfulImports++;
        console.log(`✅ Imported: ${video.title}`);

      } catch (error) {
        const errorMsg = `Error importing video ${video.id}: ${error instanceof Error ? error.message : 'Unknown error'}`;
        console.error(errorMsg);
        errors.push(errorMsg);
      }
    }

    console.log(`\n📊 Import Summary:`);
    console.log(`   - ${channelVideos.length} total videos on YouTube`);
    console.log(`   - ${missingVideos.length} videos identified as missing`);
    console.log(`   - ${successfulImports} videos successfully imported`);
    console.log(`   - ${errors.length} import errors`);
    
    if (errors.length > 0) {
      console.log(`\n❌ Import Errors:`);
      errors.forEach((error, i) => {
        console.log(`   ${i + 1}. ${error}`);
      });
    }

    return {
      totalChannelVideos: channelVideos.length,
      newVideos: successfulImports,
      errors
    };

  } catch (error) {
    console.error('Import new videos error:', error);
    return {
      totalChannelVideos: 0,
      newVideos: 0,
      errors: [error instanceof Error ? error.message : 'Unknown import error']
    };
  }
}

/**
 * Step 2: Update baseline analytics for all channel videos
 */
async function updateBaselineAnalytics(accessToken: string, channelId: string) {
  try {
    // Get existing videos for the channel from database
    const { data: dbVideos, error: dbError } = await supabase
      .from('videos')
      .select('id, title')
      .eq('channel_id', 'Make or Break Shop'); // Database uses display name

    if (dbError) {
      throw new Error(`Database error: ${dbError.message}`);
    }

    console.log(`📊 Updating baseline analytics for ${dbVideos?.length || 0} videos`);
    console.log(`⏱️  This will take approximately ${Math.ceil((dbVideos?.length || 0) * 2 / 60)} minutes...`);

    const errors = [];
    let successfulUpdates = 0;

    // Use the existing baseline analytics service
    const { youtubeAnalyticsBaseline } = await import('@/lib/youtube-analytics-baseline');

    // Update baseline analytics for all videos
    const videoIds = dbVideos?.map(v => v.id) || [];
    if (videoIds.length > 0) {
      console.log(`🚀 Starting baseline analytics collection for ${videoIds.length} videos...`);
      const results = await youtubeAnalyticsBaseline.collectAllBaselines(
        accessToken,
        (progress) => {
          // More frequent progress updates for better visibility
          if (progress.processedVideos === 1 || progress.processedVideos % 10 === 0 || progress.processedVideos === progress.totalVideos) {
            console.log(`📈 Baseline progress: ${progress.processedVideos}/${progress.totalVideos} videos (${progress.successfulVideos} successful, ${progress.failedVideos} failed)`);
            console.log(`   Current: ${progress.currentVideo}`);
            
            // Show estimated time remaining
            if (progress.estimatedTimeRemaining) {
              console.log(`   ETA: ${progress.estimatedTimeRemaining}`);
            }
          }
        },
        videoIds // Only update existing videos
      );

      // Save the updated baselines
      if (results.length > 0) {
        await youtubeAnalyticsBaseline.saveBaselines(results);
        successfulUpdates = results.length;
        console.log(`💾 Updated ${successfulUpdates} baseline analytics records`);
      }
    }

    return {
      updatedBaselines: successfulUpdates,
      errors
    };

  } catch (error) {
    console.error('Update baseline analytics error:', error);
    return {
      updatedBaselines: 0,
      errors: [error instanceof Error ? error.message : 'Unknown baseline update error']
    };
  }
}

/**
 * Fetch all videos from YouTube channel using channel ID
 */
async function fetchChannelVideos(accessToken: string, channelId: string) {
  try {
    // First get the uploads playlist ID for the channel
    const channelResponse = await fetch(
      `https://www.googleapis.com/youtube/v3/channels?part=contentDetails&id=${channelId}`,
      {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json'
        }
      }
    );

    if (!channelResponse.ok) {
      throw new Error(`Channel lookup failed: ${channelResponse.status}`);
    }

    const channelData = await channelResponse.json();
    const uploadsPlaylistId = channelData.items?.[0]?.contentDetails?.relatedPlaylists?.uploads;

    if (!uploadsPlaylistId) {
      throw new Error('Could not find uploads playlist for channel');
    }

    console.log(`📋 Found uploads playlist: ${uploadsPlaylistId}`);

    // Fetch all videos from the uploads playlist
    const videos = [];
    let nextPageToken = null;
    let page = 1;

    do {
      console.log(`📄 Fetching page ${page} of channel videos...`);
      
      let apiUrl = `https://www.googleapis.com/youtube/v3/playlistItems?part=snippet&playlistId=${uploadsPlaylistId}&maxResults=50`;
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
          `https://www.googleapis.com/youtube/v3/videos?part=snippet,statistics,contentDetails&id=${videoIds}`,
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
              duration: video.contentDetails?.duration,
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

    console.log(`📺 Retrieved ${videos.length} total videos from channel`);
    return videos;

  } catch (error) {
    console.error('Error fetching channel videos:', error);
    throw error;
  }
}