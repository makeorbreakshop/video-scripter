/**
 * Duration Data Migration Script
 * Migrates duration data from metadata JSONB to dedicated duration column
 * Processes in batches to avoid timeouts
 */

import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config();

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function migrateDurationData() {
  console.log('🚀 Starting duration data migration...');
  
  const batchSize = 1000; // Process 1000 videos at a time
  let totalMigrated = 0;
  let batchNumber = 1;
  
  while (true) {
    console.log(`📦 Processing batch ${batchNumber}...`);
    
    try {
      // Get batch of videos that need migration (always get the first batch since we're updating them)
      const { data: videos, error: fetchError } = await supabase
        .from('videos')
        .select('id, metadata')
        .is('duration', null)
        .not('metadata', 'is', null)
        .limit(batchSize);
      
      if (fetchError) {
        console.error('❌ Error fetching videos:', fetchError);
        break;
      }
      
      if (!videos || videos.length === 0) {
        console.log('✅ No more videos to migrate');
        break;
      }
      
      console.log(`📊 Found ${videos.length} videos to process in this batch`);
      
      // Process each video in the batch - filter and map
      const updates = videos
        .filter(video => video.metadata?.duration) // Only videos with duration in metadata
        .map(video => ({
          id: video.id,
          duration: video.metadata.duration
        }));
      
      console.log(`📊 ${updates.length} videos have duration data to migrate`);
      
      if (updates.length > 0) {
        // Use individual updates to only update duration column
        const updatePromises = updates.map(update => 
          supabase
            .from('videos')
            .update({ duration: update.duration })
            .eq('id', update.id)
        );
        
        const results = await Promise.allSettled(updatePromises);
        const errors = results.filter(r => r.status === 'rejected');
        
        if (errors.length > 0) {
          console.error(`❌ ${errors.length} updates failed:`, errors[0]);
          // Continue processing other batches
        }
        
        totalMigrated += updates.length;
        console.log(`✅ Migrated ${updates.length} videos (total: ${totalMigrated})`);
      }
      
      // If we got fewer videos than batch size, we're done
      if (videos.length < batchSize) {
        break;
      }
      
      batchNumber++;
      
      // Small delay to avoid overwhelming the database
      await new Promise(resolve => setTimeout(resolve, 100));
      
    } catch (error) {
      console.error('❌ Unexpected error:', error);
      break;
    }
  }
  
  console.log(`🎉 Migration complete! Migrated ${totalMigrated} videos total`);
  
  // Verify the migration
  const { data: verifyData, error: verifyError } = await supabase
    .from('videos')
    .select('count', { count: 'exact', head: true })
    .not('duration', 'is', null);
  
  if (!verifyError) {
    console.log(`📊 Total videos with duration data: ${verifyData.length || 'unknown'}`);
  }
}

// Run the migration
migrateDurationData().catch(console.error);