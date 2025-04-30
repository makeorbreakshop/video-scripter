/**
 * Script to update all video records with correct comment counts from the comments table
 * 
 * Run this script once to migrate from the old method of counting comments in chunks 
 * to the new method of counting from the dedicated comments table.
 */

import { supabaseAdmin } from '@/lib/supabase-admin';

async function updateAllVideoCommentCounts() {
  console.log('Starting update of all video comment counts...');
  
  // Get all videos
  const { data: videos, error: videosError } = await supabaseAdmin
    .from('videos')
    .select('id, title, comment_count');
    
  if (videosError) {
    console.error('Error fetching videos:', videosError);
    return;
  }
  
  console.log(`Found ${videos.length} videos to update`);
  
  let updatedCount = 0;
  let errorCount = 0;
  
  // Update each video's comment count
  for (const video of videos) {
    const { count, error: countError } = await supabaseAdmin
      .from('comments')
      .select('*', { count: 'exact', head: true })
      .eq('video_id', video.id);
      
    if (countError) {
      console.error(`Error getting comment count for video ${video.id}:`, countError);
      errorCount++;
      continue;
    }
    
    // Only update if the comment count differs from what's stored
    if (video.comment_count !== count) {
      // Update the video record
      const { error: updateError } = await supabaseAdmin
        .from('videos')
        .update({ comment_count: count || 0 })
        .eq('id', video.id);
        
      if (updateError) {
        console.error(`Error updating comment count for video ${video.id}:`, updateError);
        errorCount++;
      } else {
        console.log(`Updated comment count for video ${video.id} from ${video.comment_count || 0} to ${count || 0} comments`);
        updatedCount++;
      }
    } else {
      console.log(`Video ${video.id} already has correct comment count: ${count || 0}`);
    }
  }
  
  console.log(`
====== SUMMARY ======
Total videos processed: ${videos.length}
Updated videos: ${updatedCount}
Errors: ${errorCount}
====================
  `);
  
  console.log('Finished updating all video comment counts');
}

// Run the update script
updateAllVideoCommentCounts()
  .catch(error => {
    console.error('Error running script:', error);
    process.exit(1);
  }); 