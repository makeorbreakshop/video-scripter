#!/usr/bin/env node
import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';

dotenv.config();

const MAKE_OR_BREAK_SHOP_CHANNEL_ID = 'UCjWkNxpp3UHdEavpM_19--Q';
const YOUTUBE_API_KEY = process.env.YOUTUBE_API_KEY;
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!YOUTUBE_API_KEY || !SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error('❌ Missing environment variables. Check your .env file.');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

async function importAllComments() {
  console.log('🚀 Starting full comment import for Make or Break Shop...');
  console.log(`📋 Channel ID: ${MAKE_OR_BREAK_SHOP_CHANNEL_ID}`);
  
  let allComments = [];
  let nextPageToken;
  let totalFetched = 0;
  let apiCalls = 0;
  const batchSize = 100;

  try {
    while (true) {
      // Build YouTube API URL
      const params = new URLSearchParams({
        part: 'snippet',
        allThreadsRelatedToChannelId: MAKE_OR_BREAK_SHOP_CHANNEL_ID,
        maxResults: batchSize.toString(),
        order: 'time',
        key: YOUTUBE_API_KEY,
      });

      if (nextPageToken) {
        params.append('pageToken', nextPageToken);
      }

      const url = `https://www.googleapis.com/youtube/v3/commentThreads?${params.toString()}`;
      
      console.log(`📥 Fetching batch ${apiCalls + 1} (${batchSize} comments max)...`);
      
      const response = await fetch(url);
      apiCalls++;
      
      if (!response.ok) {
        const errorText = await response.text();
        console.error('❌ YouTube API Error:', response.status, errorText);
        break;
      }

      const data = await response.json();
      
      if (!data.items || data.items.length === 0) {
        console.log('✅ No more comments to fetch');
        break;
      }
      
      // Transform comments to database format
      const transformedComments = data.items.map(thread => {
        const comment = thread.snippet.topLevelComment.snippet;
        return {
          comment_id: thread.id,
          channel_id: MAKE_OR_BREAK_SHOP_CHANNEL_ID,
          channel_name: 'Make or Break Shop',
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
      
      console.log(`   ✓ Fetched ${data.items.length} comments (Total: ${totalFetched})`);

      // Check for next page
      nextPageToken = data.nextPageToken;
      if (!nextPageToken) {
        console.log('✅ Reached end of comments');
        break;
      }

      // Small delay to be respectful
      await new Promise(resolve => setTimeout(resolve, 100));
    }

    console.log(`\n📊 FETCH COMPLETE:`);
    console.log(`   💬 Total comments: ${totalFetched}`);
    console.log(`   🔗 API calls made: ${apiCalls}`);
    console.log(`   📈 Quota used: ${apiCalls} units`);

    if (allComments.length === 0) {
      console.log('⚠️  No comments to insert');
      return;
    }

    // Insert into database
    console.log(`\n💾 Inserting ${allComments.length} comments into database...`);
    
    const { data: insertedComments, error: dbError } = await supabase
      .from('youtube_comments')
      .upsert(allComments, { 
        onConflict: 'comment_id',
        ignoreDuplicates: true 
      })
      .select('id');

    if (dbError) {
      console.error('❌ Database error:', dbError.message);
      return;
    }

    console.log(`✅ Database insert complete`);

    // Fetch video titles
    console.log(`\n🎥 Updating video titles...`);
    const videoIds = [...new Set(allComments.map(c => c.video_id).filter(Boolean))];
    
    if (videoIds.length > 0) {
      await updateVideoTitles(videoIds);
    }

    // Final stats
    console.log(`\n🎉 IMPORT COMPLETE!`);
    console.log(`   💬 Comments imported: ${allComments.length}`);
    console.log(`   🎥 Videos covered: ${videoIds.length}`);
    console.log(`   🔗 Total API calls: ${apiCalls}`);
    console.log(`   📊 Quota used: ${apiCalls}/${10000} (${(apiCalls/10000*100).toFixed(1)}%)`);

  } catch (error) {
    console.error('❌ Import failed:', error.message);
  }
}

async function updateVideoTitles(videoIds) {
  const batchSize = 50;
  const batches = [];
  
  for (let i = 0; i < videoIds.length; i += batchSize) {
    batches.push(videoIds.slice(i, i + batchSize));
  }

  let titlesFetched = 0;

  for (const batch of batches) {
    try {
      const params = new URLSearchParams({
        part: 'snippet',
        id: batch.join(','),
        key: YOUTUBE_API_KEY,
      });

      const url = `https://www.googleapis.com/youtube/v3/videos?${params.toString()}`;
      const response = await fetch(url);
      
      if (response.ok) {
        const data = await response.json();
        
        for (const video of data.items) {
          await supabase
            .from('youtube_comments')
            .update({ video_title: video.snippet.title })
            .eq('video_id', video.id);
          
          titlesFetched++;
        }
        
        console.log(`   ✓ Updated ${data.items.length} video titles (${titlesFetched}/${videoIds.length})`);
      }
    } catch (error) {
      console.warn('⚠️  Failed to fetch titles for batch:', error.message);
    }
    
    await new Promise(resolve => setTimeout(resolve, 100));
  }
}

// Run the import
importAllComments().then(() => {
  console.log('✨ Script finished');
  process.exit(0);
}).catch(error => {
  console.error('💥 Script failed:', error);
  process.exit(1);
});