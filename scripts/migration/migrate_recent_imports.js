/**
 * Quick migration for recent imports missing duration data
 */

import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config();

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function migrateRecentImports() {
  console.log('🚀 Migrating recent imports without duration data...');
  
  try {
    // Get recent videos that need migration
    const { data: videos, error: fetchError } = await supabase
      .from('videos')
      .select('id, metadata')
      .is('duration', null)
      .not('metadata', 'is', null)
      .gte('import_date', new Date(Date.now() - 10 * 60 * 1000).toISOString()); // Last 10 minutes
    
    if (fetchError) {
      console.error('❌ Error fetching videos:', fetchError);
      return;
    }
    
    if (!videos || videos.length === 0) {
      console.log('✅ No recent videos need migration');
      return;
    }
    
    console.log(`📊 Found ${videos.length} recent videos to migrate`);
    
    // Process each video
    const updates = videos
      .filter(video => video.metadata?.duration)
      .map(video => ({
        id: video.id,
        duration: video.metadata.duration
      }));
    
    console.log(`📊 ${updates.length} videos have duration data to migrate`);
    
    if (updates.length > 0) {
      // Update in parallel
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
      }
      
      console.log(`✅ Successfully migrated ${updates.length - errors.length} recent videos`);
    }
    
  } catch (error) {
    console.error('❌ Unexpected error:', error);
  }
}

// Run the migration
migrateRecentImports().catch(console.error);