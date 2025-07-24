import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { Database } from '@/types/database';

export async function POST(request: NextRequest) {
  try {
    console.log('\n========== VIEW TRACKING DEBUG START ==========');
    
    const supabase = createClient<Database>(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    // Check if another tracking job is already running
    const { data: activeJobs } = await supabase
      .from('jobs')
      .select('id')
      .eq('type', 'view_tracking')
      .eq('status', 'processing')
      .limit(1);

    if (activeJobs && activeJobs.length > 0) {
      console.log('❌ Another view tracking job is already running');
      return NextResponse.json({ 
        error: 'View tracking is already running' 
      }, { status: 409 });
    }

    // Get a small sample of videos to debug
    console.log('\n📊 Fetching sample videos for debugging...');
    const { data: videos, error: fetchError } = await supabase
      .from('videos')
      .select(`
        id,
        channel_id,
        channel_name,
        title,
        published_at,
        view_count,
        like_count,
        comment_count,
        created_at,
        updated_at
      `)
      .limit(5)
      .order('created_at', { ascending: false });

    if (fetchError) {
      console.error('❌ Error fetching videos:', fetchError);
      return NextResponse.json({ error: 'Failed to fetch videos' }, { status: 500 });
    }

    console.log(`\n✅ Found ${videos?.length || 0} videos to debug:`);
    videos?.forEach((video, i) => {
      console.log(`\n📹 Video ${i + 1}:`);
      console.log(`  - ID: ${video.id}`);
      console.log(`  - Title: ${video.title || 'NULL'}`);
      console.log(`  - Channel ID: ${video.channel_id || 'NULL ⚠️'}`);
      console.log(`  - Channel Name: ${video.channel_name || 'NULL'}`);
      console.log(`  - Published: ${video.published_at || 'NULL'}`);
      console.log(`  - Views: ${video.view_count || 0}`);
      console.log(`  - Created: ${video.created_at}`);
    });

    // Check for videos with null channel_id
    console.log('\n🔍 Checking for videos with NULL channel_id...');
    const { count: nullChannelCount } = await supabase
      .from('videos')
      .select('*', { count: 'exact', head: true })
      .is('channel_id', null);

    console.log(`\n⚠️  Found ${nullChannelCount || 0} videos with NULL channel_id`);

    // Try to fetch YouTube data for one video
    if (videos && videos.length > 0) {
      const testVideo = videos[0];
      console.log(`\n🔄 Testing YouTube API call for video: ${testVideo.id}`);
      
      const youtubeApiKey = process.env.YOUTUBE_API_KEY;
      if (!youtubeApiKey) {
        console.error('❌ YouTube API key not found!');
        return NextResponse.json({ error: 'YouTube API key not configured' }, { status: 500 });
      }

      try {
        const response = await fetch(
          `https://www.googleapis.com/youtube/v3/videos?` +
          `part=statistics,snippet&` +
          `id=${testVideo.id}&` +
          `key=${youtubeApiKey}`
        );

        if (!response.ok) {
          console.error('❌ YouTube API error:', response.statusText);
          const errorData = await response.json();
          console.error('Error details:', errorData);
        } else {
          const data = await response.json();
          console.log('\n✅ YouTube API Response:');
          
          if (data.items && data.items.length > 0) {
            const item = data.items[0];
            console.log(`  - Video ID: ${item.id}`);
            console.log(`  - Title: ${item.snippet.title}`);
            console.log(`  - Channel ID: ${item.snippet.channelId}`);
            console.log(`  - Channel Title: ${item.snippet.channelTitle}`);
            console.log(`  - View Count: ${item.statistics.viewCount}`);
            console.log(`  - Like Count: ${item.statistics.likeCount}`);
            console.log(`  - Comment Count: ${item.statistics.commentCount}`);

            // Show what would be updated
            console.log('\n📝 What would be updated:');
            console.log(`  - Current channel_id: ${testVideo.channel_id || 'NULL'}`);
            console.log(`  - YouTube channel_id: ${item.snippet.channelId}`);
            console.log(`  - Match: ${testVideo.channel_id === item.snippet.channelId ? '✅' : '❌'}`);
          } else {
            console.log('❌ No video data returned from YouTube');
          }
        }
      } catch (apiError) {
        console.error('❌ Error calling YouTube API:', apiError);
      }
    }

    // Check view_snapshots table
    console.log('\n📊 Checking view_snapshots table...');
    const { data: recentSnapshots, count: snapshotCount } = await supabase
      .from('view_snapshots')
      .select('*', { count: 'exact' })
      .order('snapshot_date', { ascending: false })
      .limit(5);

    console.log(`\n📸 Found ${snapshotCount || 0} total snapshots`);
    console.log('Recent snapshots:');
    recentSnapshots?.forEach((snapshot, i) => {
      console.log(`  ${i + 1}. Video: ${snapshot.video_id}, Date: ${snapshot.snapshot_date}, Views: ${snapshot.view_count}`);
    });

    // Check the structure of videos table
    console.log('\n🏗️  Checking videos table structure...');
    const { data: tableInfo } = await supabase
      .from('videos')
      .select('*')
      .limit(0);

    // TEST THE ACTUAL VIEW TRACKING PROCESS
    console.log('\n🧪 TESTING VIEW TRACKING PROCESS...');
    
    if (videos && videos.length > 0) {
      const testVideo = videos[0];
      console.log(`\n📹 Testing with video: ${testVideo.id} (${testVideo.title})`);
      
      // 1. Check current video record
      console.log('\n1️⃣ Current video record:');
      console.log(`  - ID: ${testVideo.id}`);
      console.log(`  - Channel ID: ${testVideo.channel_id}`);
      console.log(`  - Current views: ${testVideo.view_count}`);
      
      // 2. Check if snapshot exists for today
      const today = new Date().toISOString().split('T')[0];
      const { data: todaySnapshot } = await supabase
        .from('view_snapshots')
        .select('*')
        .eq('video_id', testVideo.id)
        .eq('snapshot_date', today)
        .single();
      
      console.log(`\n2️⃣ Today's snapshot exists: ${todaySnapshot ? 'YES' : 'NO'}`);
      if (todaySnapshot) {
        console.log(`  - Snapshot views: ${todaySnapshot.view_count}`);
      }
      
      // 3. Simulate what would happen
      console.log('\n3️⃣ Simulating view tracking update...');
      
      // Get YouTube data
      const response = await fetch(
        `https://www.googleapis.com/youtube/v3/videos?` +
        `part=statistics&` +
        `id=${testVideo.id}&` +
        `key=${process.env.YOUTUBE_API_KEY}`
      );
      
      if (response.ok) {
        const data = await response.json();
        if (data.items && data.items.length > 0) {
          const ytVideo = data.items[0];
          const newViewCount = parseInt(ytVideo.statistics.viewCount);
          
          console.log(`  - YouTube view count: ${newViewCount}`);
          console.log(`  - Current DB view count: ${testVideo.view_count}`);
          console.log(`  - Difference: ${newViewCount - (testVideo.view_count || 0)}`);
          
          console.log('\n4️⃣ What WOULD happen:');
          console.log(`  - Create/update view_snapshot for ${today}`);
          console.log(`  - Update videos table view_count to ${newViewCount}`);
          
          // Check if this would cause issues
          console.log('\n5️⃣ Potential issues check:');
          console.log(`  - Video exists in DB: YES`);
          console.log(`  - Has channel_id: ${testVideo.channel_id ? 'YES ✅' : 'NO ❌'}`);
          console.log(`  - Would create new video: NO (using UPDATE not UPSERT)`);
        }
      }
    }
    
    console.log('\n========== VIEW TRACKING DEBUG END ==========\n');

    return NextResponse.json({
      message: 'Debug information logged to console',
      stats: {
        totalVideos: videos?.length || 0,
        videosWithNullChannelId: nullChannelCount || 0,
        totalSnapshots: snapshotCount || 0
      }
    });

  } catch (error) {
    console.error('❌ Debug error:', error);
    return NextResponse.json({ 
      error: 'Internal server error during debug' 
    }, { status: 500 });
  }
}